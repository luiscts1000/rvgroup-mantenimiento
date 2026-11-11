import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { WorkBook } from 'xlsx';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileSpreadsheet,
  Upload,
  Download,
  Pencil,
  Copy,
  Database,
  EyeOff,
  Eye,
  Loader2,
} from 'lucide-react';
import { Badge, Button, Field, Modal, PageHeader } from '@/components/ui';
import { supabase, friendlyError } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { STATUS_LABELS } from '@/lib/constants';
import { useCategories } from './api';
import { fetchExistingKeys } from './api';
import {
  IMPORT_FIELDS,
  autoMap,
  downloadTemplate,
  extractValues,
  readSheet,
  readWorkbook,
  toPayload,
  validateRows,
  type ColumnMapping,
  type ExistingKeys,
  type ImportRow,
  type ParsedSheet,
  type RawValues,
} from './importLogic';

const STEPS = ['Archivo', 'Vista previa', 'Columnas', 'Validación', 'Confirmación'];
const MAPPING_STORAGE = 'rv-import-mapping-v1';
type RowFilter = 'todas' | 'validas' | 'advertencias' | 'errores' | 'excluidas';

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-5 flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1">
          <span
            className={cn(
              'flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium',
              i === step
                ? 'bg-brand-700 text-white'
                : i < step
                  ? 'bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
            )}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold">
              {i < step ? '✓' : i + 1}
            </span>
            {s}
          </span>
          {i < STEPS.length - 1 && <span className="h-px w-4 bg-slate-300 dark:bg-slate-700" />}
        </li>
      ))}
    </ol>
  );
}

export function ImportWizardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: categories = [] } = useCategories();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [existing, setExisting] = useState<ExistingKeys | null>(null);
  const [filter, setFilter] = useState<RowFilter>('todas');
  const [editing, setEditing] = useState<ImportRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<{ inserted: number; skipped: number; skipped_patentes: string[] } | null>(null);

  // ---------------------------------------------------------------- Paso 1
  const loadSheet = useCallback((wb: WorkBook, name: string, hdr: number) => {
    const parsed = readSheet(wb, name, hdr);
    setSheet(parsed);
    // Reutiliza el último mapeo si los encabezados coinciden; si no, autodetección
    let map = autoMap(parsed.headers);
    try {
      const saved = JSON.parse(localStorage.getItem(MAPPING_STORAGE) ?? 'null') as Record<string, string> | null;
      if (saved) {
        const fromSaved: ColumnMapping = {};
        for (const [field, header] of Object.entries(saved)) {
          const idx = parsed.headers.indexOf(header);
          if (idx >= 0) fromSaved[field as keyof ColumnMapping] = idx;
        }
        if (Object.keys(fromSaved).length >= Object.keys(map).length) map = fromSaved;
      }
    } catch {
      /* ignorar */
    }
    setMapping(map);
  }, []);

  async function handleFile(file: File) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return toast.error('Formato no soportado. Use .xlsx, .xls o .csv');
    if (file.size > 10 * 1024 * 1024) return toast.error('El archivo supera los 10 MB');
    setBusy(true);
    try {
      const wb = await readWorkbook(file);
      const first = wb.SheetNames[0];
      if (!first) throw new Error('El archivo no contiene hojas');
      setWorkbook(wb);
      setFileName(file.name);
      setSheetName(first);
      setHeaderRow(0);
      loadSheet(wb, first, 0);
      setStep(1);
    } catch (err) {
      toast.error(`No se pudo leer el archivo: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  };

  // ---------------------------------------------------------------- Paso 3 → 4
  async function runValidation() {
    if (!sheet) return;
    if (mapping.patente === undefined || mapping.patente === null) return toast.error('Debe relacionar la columna "Patente".');
    setBusy(true);
    try {
      const keys = await fetchExistingKeys();
      setExisting(keys);
      const base: ImportRow[] = sheet.rows.map((r, i) => ({
        rowNumber: headerRow + i + 2,
        values: extractValues(r, mapping),
        excluded: false,
        errors: [],
        warnings: [],
        dupInFile: false,
        existsInDb: false,
        categoryId: null,
        status: null,
      }));
      setRows(validateRows(base, keys, categories));
      // Recordar el mapeo por nombre de encabezado
      const toSave: Record<string, string> = {};
      Object.entries(mapping).forEach(([k, idx]) => {
        if (idx !== null && idx !== undefined) toSave[k] = sheet.headers[idx];
      });
      localStorage.setItem(MAPPING_STORAGE, JSON.stringify(toSave));
      setFilter('todas');
      setStep(3);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const revalidate = (next: ImportRow[]) => existing && setRows(validateRows(next, existing, categories));

  const stats = useMemo(() => {
    const active = rows.filter((r) => !r.excluded);
    return {
      total: rows.length,
      excluded: rows.length - active.length,
      valid: active.filter((r) => !r.errors.length).length,
      warnings: active.filter((r) => !r.errors.length && r.warnings.length).length,
      errors: active.filter((r) => r.errors.length).length,
      dupFile: active.filter((r) => r.dupInFile).length,
      existsDb: rows.filter((r) => r.existsInDb).length,
    };
  }, [rows]);

  const visibleRows = useMemo(() => {
    switch (filter) {
      case 'validas':
        return rows.filter((r) => !r.excluded && !r.errors.length);
      case 'advertencias':
        return rows.filter((r) => !r.excluded && !r.errors.length && r.warnings.length);
      case 'errores':
        return rows.filter((r) => !r.excluded && r.errors.length);
      case 'excluidas':
        return rows.filter((r) => r.excluded);
      default:
        return rows;
    }
  }, [rows, filter]);

  const toggleExclude = (rowNumber: number) =>
    revalidate(rows.map((r) => (r.rowNumber === rowNumber ? { ...r, excluded: !r.excluded } : r)));
  const excludeErrors = () => revalidate(rows.map((r) => (r.errors.length ? { ...r, excluded: true } : r)));

  // ---------------------------------------------------------------- Paso 5
  async function confirmImport() {
    const toImport = rows.filter((r) => !r.excluded && !r.errors.length);
    if (!toImport.length) return;
    setBusy(true);
    try {
      const mapNames: Record<string, string> = {};
      Object.entries(mapping).forEach(([k, idx]) => {
        if (idx !== null && idx !== undefined && sheet) mapNames[k] = sheet.headers[idx];
      });
      const { data, error } = await supabase.rpc('import_vehicles', {
        p_file_name: fileName,
        p_mapping: mapNames,
        p_rows: toImport.map(toPayload),
        p_is_demo: false,
      });
      if (error) throw error;
      setResult(data as { inserted: number; skipped: number; skipped_patentes: string[] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      qc.invalidateQueries({ queryKey: ['import-batches'] });
      toast.success(`Importación finalizada: ${(data as { inserted: number }).inserted} unidades registradas`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const reset = () => {
    setStep(0);
    setWorkbook(null);
    setSheet(null);
    setRows([]);
    setResult(null);
    setFileName('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name;
  const mappedFields = IMPORT_FIELDS.filter((f) => mapping[f.key] !== undefined && mapping[f.key] !== null);

  return (
    <div>
      <PageHeader
        title="Importación masiva de unidades"
        subtitle="Carga de la flota desde Excel (.xlsx, .xls) o CSV"
        actions={
          <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate('/unidades')}>
            Volver a unidades
          </Button>
        }
      />
      <Stepper step={result ? 5 : step} />

      {/* ------------------------------------------------ PASO 1: ARCHIVO */}
      {step === 0 && (
        <div className="card p-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInput.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition',
              dragOver ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-300 hover:border-brand-400 dark:border-slate-700',
            )}
          >
            {busy ? <Loader2 className="h-12 w-12 animate-spin text-brand-500" /> : <FileSpreadsheet className="h-12 w-12 text-brand-500" />}
            <div>
              <p className="font-semibold">Arrastre el archivo aquí o haga clic para seleccionarlo</p>
              <p className="text-sm text-slate-500">Formatos aceptados: .xlsx, .xls, .csv (máx. 10 MB)</p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
            />
          </div>
          <div className="mt-4 flex flex-col items-start gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p>Las columnas pueden tener cualquier nombre: en el paso 3 se relacionan con los campos del sistema.</p>
            <Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={downloadTemplate}>
              Descargar planilla modelo
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ PASO 2: VISTA PREVIA */}
      {step === 1 && sheet && workbook && (
        <div className="card p-4 sm:p-5">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Archivo">
              <p className="truncate py-2 text-sm font-medium">{fileName}</p>
            </Field>
            <Field label="Hoja">
              <select
                className="input"
                value={sheetName}
                onChange={(e) => {
                  setSheetName(e.target.value);
                  loadSheet(workbook, e.target.value, headerRow);
                }}
              >
                {workbook.SheetNames.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Fila de encabezados" hint="Cambiar si la planilla tiene títulos arriba de las columnas">
              <select
                className="input"
                value={headerRow}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  setHeaderRow(h);
                  loadSheet(workbook, sheetName, h);
                }}
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i} value={i}>
                    Fila {i + 1}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="mb-2 text-sm text-slate-500">
            Se detectaron <b>{sheet.rows.length}</b> registros y <b>{sheet.headers.length}</b> columnas. Primeros 10 registros:
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="table-base">
              <thead>
                <tr>
                  <th>#</th>
                  {sheet.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sheet.rows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td className="text-slate-400">{headerRow + i + 2}</td>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 flex justify-between">
            <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={reset}>
              Otro archivo
            </Button>
            <Button disabled={!sheet.rows.length} onClick={() => setStep(2)}>
              Continuar <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ PASO 3: COLUMNAS */}
      {step === 2 && sheet && (
        <div className="card p-4 sm:p-5">
          <p className="mb-4 text-sm text-slate-500">
            Relacione cada campo del sistema con una columna del Excel. Se realizó una detección automática: verifíquela.
            Solo la <b>Patente</b> es obligatoria. La <b>categoría</b> se deduce de marca/modelo/versión si no hay columna.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {IMPORT_FIELDS.map((f) => {
              const idx = mapping[f.key];
              const sample = idx !== null && idx !== undefined ? sheet.rows.find((r) => r[idx])?.[idx] : undefined;
              return (
                <div key={f.key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="w-40 shrink-0">
                    <p className="text-sm font-medium">
                      {f.label} {f.required && <span className="text-red-500">*</span>}
                    </p>
                    {sample && <p className="truncate text-xs text-slate-400">Ej.: {sample}</p>}
                  </div>
                  <select
                    className={cn('input', idx !== undefined && idx !== null && 'border-brand-400 bg-brand-50/50 dark:bg-brand-900/20')}
                    value={idx ?? ''}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))
                    }
                  >
                    <option value="">— No importar —</option>
                    {sheet.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex justify-between">
            <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(1)}>
              Atrás
            </Button>
            <Button loading={busy} onClick={() => void runValidation()}>
              Validar datos <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ PASO 4: VALIDACIÓN */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { k: 'todas', label: 'Registros', value: stats.total, icon: FileSpreadsheet, tone: 'text-slate-600' },
              { k: 'validas', label: 'Listos', value: stats.valid, icon: CheckCircle2, tone: 'text-emerald-600' },
              { k: 'advertencias', label: 'Con advertencias', value: stats.warnings, icon: AlertTriangle, tone: 'text-amber-600' },
              { k: 'errores', label: 'Con errores', value: stats.errors, icon: XCircle, tone: 'text-red-600' },
              { k: 'errores', label: 'Ya existen', value: stats.existsDb, icon: Database, tone: 'text-purple-600' },
              { k: 'excluidas', label: 'Excluidos', value: stats.excluded, icon: EyeOff, tone: 'text-slate-500' },
            ].map((s, i) => (
              <button
                key={i}
                onClick={() => setFilter(s.k as RowFilter)}
                className={cn('card flex items-center gap-3 p-3 text-left transition hover:border-brand-400', filter === s.k && i !== 4 && 'ring-2 ring-brand-500')}
              >
                <s.icon className={cn('h-6 w-6 shrink-0', s.tone)} />
                <div>
                  <p className="text-xl font-bold">{s.value}</p>
                  <p className="text-xs text-slate-500">{s.label}</p>
                </div>
              </button>
            ))}
          </div>

          {stats.dupFile > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
              <Copy className="h-4 w-4" /> Hay {stats.dupFile} filas con patente repetida dentro del archivo. Excluya las copias o corríjalas.
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
              <p className="text-sm text-slate-500">
                Mostrando {visibleRows.length} filas · Haga clic en <Pencil className="inline h-3 w-3" /> para corregir un registro
              </p>
              {stats.errors > 0 && (
                <Button size="sm" variant="secondary" icon={<EyeOff className="h-4 w-4" />} onClick={excludeErrors}>
                  Excluir todas las filas con errores ({stats.errors})
                </Button>
              )}
            </div>
            <div className="max-h-[60vh] overflow-auto">
              <table className="table-base">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th>Fila</th>
                    <th>Estado</th>
                    <th>Patente</th>
                    <th>Interno</th>
                    <th>Marca / Modelo</th>
                    <th>Categoría</th>
                    <th>Año</th>
                    <th>Km</th>
                    <th>Estado op.</th>
                    <th>Observaciones de validación</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleRows.map((r) => (
                    <tr
                      key={r.rowNumber}
                      className={cn(
                        r.excluded && 'opacity-50',
                        !r.excluded && r.errors.length > 0 && 'bg-red-50/60 dark:bg-red-950/20',
                        !r.excluded && !r.errors.length && r.warnings.length > 0 && 'bg-amber-50/50 dark:bg-amber-950/10',
                      )}
                    >
                      <td className="text-slate-400">{r.rowNumber}</td>
                      <td>
                        {r.excluded ? (
                          <Badge className="bg-slate-200 text-slate-600">Excluida</Badge>
                        ) : r.errors.length ? (
                          <Badge className="bg-red-100 text-red-700">Error</Badge>
                        ) : r.warnings.length ? (
                          <Badge className="bg-amber-100 text-amber-700">Advertencia</Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-700">Válida</Badge>
                        )}
                      </td>
                      <td className="font-mono font-semibold">{r.values.patente || <span className="text-red-500">(vacía)</span>}</td>
                      <td>{r.values.nro_interno || '—'}</td>
                      <td>{[r.values.marca, r.values.modelo, r.values.version].filter(Boolean).join(' ') || '—'}</td>
                      <td>{categoryName(r.categoryId) ?? <span className="text-slate-400">—</span>}</td>
                      <td>{r.values.anio || '—'}</td>
                      <td>{r.values.km_actual || '—'}</td>
                      <td>{r.status ? STATUS_LABELS[r.status] : r.values.status || 'Operativo'}</td>
                      <td className="min-w-[260px] whitespace-normal text-xs">
                        {r.errors.map((e) => (
                          <p key={e} className="text-red-600 dark:text-red-400">• {e}</p>
                        ))}
                        {r.warnings.map((w) => (
                          <p key={w} className="text-amber-700 dark:text-amber-400">• {w}</p>
                        ))}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Corregir" onClick={() => setEditing(r)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title={r.excluded ? 'Incluir' : 'Excluir'}
                            onClick={() => toggleExclude(r.rowNumber)}
                          >
                            {r.excluded ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(2)}>
              Atrás (columnas)
            </Button>
            <div className="flex flex-col items-end gap-1">
              <Button disabled={stats.errors > 0 || stats.valid === 0} onClick={() => setStep(4)}>
                Continuar con {stats.valid} registros <ArrowRight className="h-4 w-4" />
              </Button>
              {stats.errors > 0 && (
                <p className="text-xs text-red-600">Corrija o excluya las {stats.errors} filas con errores para continuar.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ PASO 5: CONFIRMACIÓN */}
      {step === 4 && (
        <div className="card mx-auto max-w-2xl p-6">
          {!result ? (
            <>
              <h2 className="mb-1 text-lg font-semibold">Confirmar importación</h2>
              <p className="mb-5 text-sm text-slate-500">Revise el resumen antes de guardar en la base de datos.</p>
              <dl className="mb-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                  <dt className="text-slate-500">Archivo</dt>
                  <dd className="truncate font-medium">{fileName}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                  <dt className="text-slate-500">Hoja</dt>
                  <dd className="font-medium">{sheetName}</dd>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-900/30">
                  <dt className="text-emerald-700 dark:text-emerald-300">Unidades a registrar</dt>
                  <dd className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">{stats.valid}</dd>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                  <dt className="text-slate-500">Excluidas</dt>
                  <dd className="text-2xl font-bold">{stats.excluded}</dd>
                </div>
              </dl>
              <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Campos que se importarán</p>
              <div className="mb-5 flex flex-wrap gap-1.5">
                {mappedFields.map((f) => (
                  <Badge key={f.key} className="bg-brand-100 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
                    {f.label}
                  </Badge>
                ))}
              </div>
              <div className="mb-5 rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
                La operación es segura: si otro usuario registra alguna de estas patentes mientras tanto, esa fila se omitirá
                automáticamente y nunca se duplicará.
              </div>
              <div className="flex justify-between">
                <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => setStep(3)} disabled={busy}>
                  Atrás
                </Button>
                <Button variant="success" loading={busy} icon={<Upload className="h-4 w-4" />} onClick={() => void confirmImport()}>
                  Confirmar importación
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-3 h-14 w-14 text-emerald-500" />
              <h2 className="text-xl font-bold">Importación finalizada</h2>
              <p className="mt-1 text-slate-500">
                Se registraron <b className="text-emerald-700">{result.inserted}</b> unidades nuevas.
              </p>
              {result.skipped > 0 && (
                <div className="mt-4 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  <p className="font-medium">{result.skipped} registros omitidos por ya existir en el sistema:</p>
                  <p className="mt-1 font-mono text-xs">{result.skipped_patentes.join(', ')}</p>
                </div>
              )}
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={reset}>
                  Importar otro archivo
                </Button>
                <Button onClick={() => navigate('/unidades')}>Ver unidades</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <RowEditModal
        row={editing}
        onClose={() => setEditing(null)}
        onSave={(values) => {
          if (!editing) return;
          revalidate(rows.map((r) => (r.rowNumber === editing.rowNumber ? { ...r, values } : r)));
          setEditing(null);
        }}
      />
    </div>
  );
}

function RowEditModal({
  row,
  onClose,
  onSave,
}: {
  row: ImportRow | null;
  onClose: () => void;
  onSave: (v: RawValues) => void;
}) {
  const [values, setValues] = useState<RawValues | null>(null);
  const [lastRow, setLastRow] = useState<number | null>(null);
  if (row && row.rowNumber !== lastRow) {
    setLastRow(row.rowNumber);
    setValues({ ...row.values });
  }
  if (!row && lastRow !== null) setLastRow(null);

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      size="lg"
      title={`Corregir fila ${row?.rowNumber ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => values && onSave(values)}>Aplicar y revalidar</Button>
        </>
      }
    >
      {row && values && (
        <>
          {row.errors.length > 0 && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {row.errors.map((e) => (
                <p key={e}>• {e}</p>
              ))}
            </div>
          )}
          <p className="mb-3 text-xs text-slate-500">Los cambios se aplican solo a esta importación (el archivo original no se modifica).</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} required={f.required}>
                <input
                  className={cn('input', (f.key === 'patente' || f.key === 'chasis' || f.key === 'motor') && 'font-mono uppercase')}
                  value={values[f.key]}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  placeholder={f.key === 'status' ? 'Operativo / Fuera de servicio / En taller / Baja' : undefined}
                />
              </Field>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
