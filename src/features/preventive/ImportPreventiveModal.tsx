import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { CheckCircle2, Download, FileSpreadsheet, PlusCircle, Upload } from 'lucide-react';
import { Badge, Button, Modal } from '@/components/ui';
import { normalizePatente } from '@/lib/patente';
import { supabase } from '@/lib/supabase';
import { formatNumber } from '@/lib/utils';
import type { Vehicle } from '@/types/db';
import { formatShortModelLabel, getBrandGroup, getPresetByBrand, getServiceKmStatus } from './api';

interface ParsedRow {
  patente: string;
  interno: string | null;
  modelo: string | null;
  km_actual: number | null;
  next_service_km: number | null;
  km_cubiertas: number | null;
  km_correas: number | null;
  km_amortiguadores_del: number | null;
  km_amortiguadores_tras: number | null;
  km_cintas: number | null;
  km_pastillas_del: number | null;
  km_pastillas_tras: number | null;
  km_discos_tras: number | null;
  km_discos_del: number | null;
  km_fluidos: number | null;
  exists: boolean;
  existingId?: string;
}

function parseIntCell(val: unknown): number | null {
  if (val === null || val === undefined || val === '' || val === '-') return null;
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
  const clean = String(val).replace(/\./g, '').replace(/,/g, '').replace(/[^\d-]/g, '').trim();
  if (!clean || clean === '-') return null;
  const n = parseInt(clean, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function ImportPreventiveModal({
  open,
  onClose,
  vehicles,
}: {
  open: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
}) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);

  const existingByPatente = new Map<string, Vehicle>();
  for (const v of vehicles) {
    existingByPatente.set(normalizePatente(v.patente), v);
  }

  const downloadTemplate = () => {
    const templateRows = vehicles
      .filter((v) => v.status !== 'baja')
      .map((v) => {
        const svc = getServiceKmStatus(v);
        return {
          Modelo: formatShortModelLabel(v),
          Interno: v.nro_interno ?? '',
          Patente: v.patente,
          Km: v.km_actual ?? '',
          'Proximo Servi': svc.nextKm ?? '',
          Cubiertas: v.km_cubiertas ?? '',
          Correas: v.km_correas ?? '',
          'Amortiguadores Del': v.km_amortiguadores_del ?? '',
          'Amortiguadores Tras': v.km_amortiguadores_tras ?? '',
          Cintas: v.km_cintas ?? '',
          'Pastillas Del': v.km_pastillas_del ?? '',
          'Pastillas Tras': v.km_pastillas_tras ?? '',
          'Discos de Freno Tr': v.km_discos_tras ?? '',
          'Discos de Freno De': v.km_discos_del ?? '',
          Fluidos: v.km_fluidos ?? '',
        };
      });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      templateRows.length
        ? templateRows
        : [
            {
              Modelo: 'Toyota Hilux',
              Interno: '58',
              Patente: 'AH326PF',
              Km: 161310,
              'Proximo Servi': 170000,
              Cubiertas: 152000,
              Correas: 150000,
              'Amortiguadores Del': 150000,
              'Amortiguadores Tras': 120000,
              Cintas: 140000,
              'Pastillas Del': 130000,
              'Pastillas Tras': '',
              'Discos de Freno Tr': '',
              'Discos de Freno De': '',
              Fluidos: 80000,
            },
          ],
    );
    XLSX.utils.book_append_sheet(wb, ws, 'Unidades y Km');
    XLSX.writeFile(wb, 'Plantilla_Unidades_y_Km_RVGroup.xlsx');
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawGrid = XLSX.utils.sheet_to_json< unknown[] >(ws, { header: 1, defval: '' });

      // Buscar la fila de encabezados donde aparezca "Patente" o "Dominio"
      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(rawGrid.length, 15); i++) {
        const line = (rawGrid[i] ?? []).map((c) => normHeader(String(c)));
        if (line.some((h) => h.includes('patente') || h.includes('dominio'))) {
          headerRowIdx = i;
          break;
        }
      }

      const headers = (rawGrid[headerRowIdx] ?? []).map((c) => normHeader(String(c)));
      const findCol = (pred: (h: string) => boolean) => headers.findIndex(pred);

      const idxPatente = findCol((h) => h.includes('patente') || h.includes('dominio'));
      const idxInterno = findCol((h) => h.includes('interno') || h === 'int');
      const idxModelo = findCol((h) => h.includes('modelo') || h.includes('unidad') || h.includes('vehiculo') || h.includes('marca'));
      const idxKm = findCol((h) => h === 'km' || h === 'kilometraje' || h === 'kmactual' || h === 'kilometros');
      const idxProx = findCol((h) => h.includes('proximo') || h.includes('proxserv'));
      const idxCub = findCol((h) => h.includes('cubierta') || h.includes('neumatic'));
      const idxCor = findCol((h) => h.includes('correa') || h.includes('distribuc'));
      const idxAmDel = findCol((h) => h.includes('amortiguadoresdel') || h.includes('amortdel'));
      const idxAmTras = findCol((h) => h.includes('amortiguadorestras') || h.includes('amorttras'));
      const idxCintas = findCol((h) => h.includes('cinta'));
      const idxPastDel = findCol((h) => h.includes('pastillasdel') || h.includes('pastdel'));
      const idxPastTras = findCol((h) => h.includes('pastillastras') || h.includes('pasttras'));
      const idxDiscTras = findCol((h) => h.includes('discosdefrenotr') || h.includes('discostras'));
      const idxDiscDel = findCol((h) => h.includes('discosdefrenode') || h.includes('discosdel'));
      const idxFluidos = findCol((h) => h.includes('fluido'));

      if (idxPatente === -1) {
        toast.error('No se encontró la columna «Patente» en el archivo Excel');
        return;
      }

      const parsed: ParsedRow[] = [];
      const seen = new Set<string>();

      for (let r = headerRowIdx + 1; r < rawGrid.length; r++) {
        const line = rawGrid[r] ?? [];
        const rawPat = String(line[idxPatente] ?? '').trim();
        const pat = normalizePatente(rawPat);
        if (pat.length < 5 || seen.has(pat)) continue;
        seen.add(pat);

        const existing = existingByPatente.get(pat);
        parsed.push({
          patente: pat,
          interno: idxInterno >= 0 ? String(line[idxInterno] ?? '').trim() || null : null,
          modelo: idxModelo >= 0 ? String(line[idxModelo] ?? '').trim() || null : null,
          km_actual: idxKm >= 0 ? parseIntCell(line[idxKm]) : null,
          next_service_km: idxProx >= 0 ? parseIntCell(line[idxProx]) : null,
          km_cubiertas: idxCub >= 0 ? parseIntCell(line[idxCub]) : null,
          km_correas: idxCor >= 0 ? parseIntCell(line[idxCor]) : null,
          km_amortiguadores_del: idxAmDel >= 0 ? parseIntCell(line[idxAmDel]) : null,
          km_amortiguadores_tras: idxAmTras >= 0 ? parseIntCell(line[idxAmTras]) : null,
          km_cintas: idxCintas >= 0 ? parseIntCell(line[idxCintas]) : null,
          km_pastillas_del: idxPastDel >= 0 ? parseIntCell(line[idxPastDel]) : null,
          km_pastillas_tras: idxPastTras >= 0 ? parseIntCell(line[idxPastTras]) : null,
          km_discos_tras: idxDiscTras >= 0 ? parseIntCell(line[idxDiscTras]) : null,
          km_discos_del: idxDiscDel >= 0 ? parseIntCell(line[idxDiscDel]) : null,
          km_fluidos: idxFluidos >= 0 ? parseIntCell(line[idxFluidos]) : null,
          exists: Boolean(existing),
          existingId: existing?.id,
        });
      }

      setRows(parsed);
      if (!parsed.length) {
        toast.warning('No se encontraron filas con patentes válidas');
      } else {
        toast.success(`${parsed.length} unidades leídas desde el Excel`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al leer el archivo Excel');
    }
  };

  const handleConfirmImport = async () => {
    if (!rows.length) return;
    setBusy(true);
    let updated = 0;
    let created = 0;

    try {
      for (const row of rows) {
        if (row.exists && row.existingId) {
          const patch: Record<string, unknown> = {};
          if (row.km_actual !== null) patch.km_actual = row.km_actual;
          if (row.interno && row.interno !== '-') patch.nro_interno = row.interno;
          if (row.next_service_km !== null) patch.next_service_km = row.next_service_km;
          if (row.km_cubiertas !== null) patch.km_cubiertas = row.km_cubiertas;
          if (row.km_correas !== null) patch.km_correas = row.km_correas;
          if (row.km_amortiguadores_del !== null) patch.km_amortiguadores_del = row.km_amortiguadores_del;
          if (row.km_amortiguadores_tras !== null) patch.km_amortiguadores_tras = row.km_amortiguadores_tras;
          if (row.km_cintas !== null) patch.km_cintas = row.km_cintas;
          if (row.km_pastillas_del !== null) patch.km_pastillas_del = row.km_pastillas_del;
          if (row.km_pastillas_tras !== null) patch.km_pastillas_tras = row.km_pastillas_tras;
          if (row.km_discos_tras !== null) patch.km_discos_tras = row.km_discos_tras;
          if (row.km_discos_del !== null) patch.km_discos_del = row.km_discos_del;
          if (row.km_fluidos !== null) patch.km_fluidos = row.km_fluidos;

          if (Object.keys(patch).length > 0) {
            const { error } = await supabase.from('vehicles').update(patch).eq('id', row.existingId);
            if (error) throw error;
            updated++;
          }
        } else {
          // Es una unidad nueva: deducir marca/modelo y precargar estándar si no vino en el Excel
          const fakeVeh = { marca: row.modelo, modelo: row.modelo } as Vehicle;
          const preset = getPresetByBrand(getBrandGroup(fakeVeh));
          const { error } = await supabase.from('vehicles').insert({
            patente: row.patente,
            nro_interno: row.interno && row.interno !== '-' ? row.interno : null,
            marca: row.modelo?.split(' ')[0] ?? null,
            modelo: row.modelo ?? null,
            km_actual: row.km_actual,
            next_service_km: row.next_service_km ?? (row.km_actual != null ? row.km_actual + 10000 : 10000),
            km_cubiertas: row.km_cubiertas ?? preset.km_cubiertas,
            km_correas: row.km_correas ?? preset.km_correas,
            km_amortiguadores_del: row.km_amortiguadores_del ?? preset.km_amortiguadores_del,
            km_amortiguadores_tras: row.km_amortiguadores_tras ?? preset.km_amortiguadores_tras,
            km_cintas: row.km_cintas ?? preset.km_cintas,
            km_pastillas_del: row.km_pastillas_del ?? preset.km_pastillas_del,
            km_pastillas_tras: row.km_pastillas_tras ?? preset.km_pastillas_tras,
            km_discos_tras: row.km_discos_tras ?? preset.km_discos_tras,
            km_discos_del: row.km_discos_del ?? preset.km_discos_del,
            km_fluidos: row.km_fluidos ?? preset.km_fluidos,
            status: 'operativo',
          });
          if (error) throw error;
          created++;
        }
      }

      await qc.invalidateQueries({ queryKey: ['vehicles'] });
      await qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      toast.success(
        `Importación completada: ${updated} unidades actualizadas y ${created} unidades nuevas creadas.`,
      );
      setRows([]);
      setFileName('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al importar datos');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar Unidades y Kilómetros Actuales (Excel)"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            icon={<Upload className="h-4 w-4" />}
            disabled={!rows.length}
            loading={busy}
            onClick={() => void handleConfirmImport()}
          >
            Confirmar e Importar ({rows.length})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm dark:border-brand-900 dark:bg-brand-950/30">
          <div className="space-y-1">
            <p className="font-semibold text-brand-900 dark:text-brand-200">
              Actualice los kilómetros actuales de la flota o agregue unidades nuevas desde su Excel
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Reconoce automáticamente las columnas <b>Patente</b>, <b>Interno</b>, <b>Modelo</b>, <b>Km</b>, <b>Próximo Servi</b> y los 10 componentes preventivos. Si la patente ya existe actualiza sus kilómetros; si no existe, da de alta la unidad automáticamente.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="h-4 w-4" />}
            onClick={downloadTemplate}
          >
            Descargar plantilla con flota actual
          </Button>
        </div>

        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-300 bg-slate-50/70 p-6 text-center transition hover:border-rvgreen-500 hover:bg-brand-50/30 dark:border-slate-700 dark:bg-slate-800/40">
          <FileSpreadsheet className="h-9 w-9 text-brand-700 dark:text-rvgreen-400" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {fileName ? `Archivo cargado: ${fileName}` : 'Seleccionar archivo Excel (.xlsx, .xls, .csv)'}
          </span>
          <span className="text-xs text-slate-500">Haga clic aquí para buscar la planilla en su computadora</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void handleFile(e)} />
        </label>

        {rows.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Vista previa ({rows.length} filas detectadas):
              </span>
              <div className="flex gap-2">
                <Badge className="bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {rows.filter((r) => r.exists).length} a actualizar Km
                </Badge>
                <Badge className="bg-brand-100 text-brand-800">
                  <PlusCircle className="mr-1 h-3 w-3" />
                  {rows.filter((r) => !r.exists).length} unidades nuevas
                </Badge>
              </div>
            </div>

            <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <tr>
                    <th className="px-3 py-2">Acción</th>
                    <th className="px-3 py-2">Patente</th>
                    <th className="px-3 py-2">Interno</th>
                    <th className="px-3 py-2">Modelo</th>
                    <th className="px-3 py-2 text-right">Km Actual</th>
                    <th className="px-3 py-2 text-right">Próximo Servi</th>
                    <th className="px-3 py-2 text-right">Restante</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((r) => {
                    const rest =
                      r.km_actual != null && r.next_service_km != null
                        ? r.next_service_km - r.km_actual
                        : null;
                    return (
                      <tr key={r.patente}>
                        <td className="px-3 py-1.5">
                          {r.exists ? (
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              Actualizar Km
                            </span>
                          ) : (
                            <span className="font-semibold text-brand-700 dark:text-brand-300">
                              Alta nueva + Km
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono font-bold">{r.patente}</td>
                        <td className="px-3 py-1.5">{r.interno || '—'}</td>
                        <td className="px-3 py-1.5">{r.modelo || '—'}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">
                          {r.km_actual != null ? formatNumber(r.km_actual) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {r.next_service_km != null ? formatNumber(r.next_service_km) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-bold">
                          {rest != null ? formatNumber(rest) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
