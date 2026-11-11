import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Upload,
  Download,
  Search,
  FilterX,
  Package,
  AlertTriangle,
  ArrowDownUp,
  ArrowUpRight,
  Pencil,
  History,
  FileSpreadsheet,
} from 'lucide-react';
import { Badge, Button, EmptyState, Field, Modal, PageHeader, Spinner, StatCard } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories } from '@/features/vehicles/api';
import { friendlyError, supabase } from '@/lib/supabase';
import { PART_CATEGORY_LABELS, PART_UNIT_SUGGESTIONS, STOCK_MOVEMENT_LABELS } from '@/lib/constants';
import { cn, formatDate, formatNumber, slug } from '@/lib/utils';
import type { Part, PartCategory, StockMovementType } from '@/types/db';
import { QuickDispatchModal } from './QuickDispatchModal';
import {
  downloadPartsTemplate,
  exportPartsToExcel,
  parsePartsExcelFile,
  useParts,
  useRecordStockMovement,
  useSavePart,
  useStockMovements,
} from './api';

export function InventoryPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: parts = [], isLoading } = useParts();
  const { data: movements = [], isLoading: movLoading } = useStockMovements();

  const [tab, setTab] = useState<'catalogo' | 'movimientos'>('catalogo');
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'' | PartCategory>('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Part | null>(null);
  const [movPart, setMovPart] = useState<Part | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [quickDispatchOpen, setQuickDispatchOpen] = useState(false);
  const [quickDispatchPart, setQuickDispatchPart] = useState<Part | null>(null);

  const lowStockParts = useMemo(
    () => parts.filter((p) => p.active && Number(p.quantity) <= Number(p.min_stock)),
    [parts],
  );

  const totalValuation = useMemo(
    () =>
      parts.reduce(
        (acc, p) => acc + (p.purchase_price != null && Number(p.quantity) > 0 ? Number(p.quantity) * Number(p.purchase_price) : 0),
        0,
      ),
    [parts],
  );

  const filtered = useMemo(() => {
    const term = slug(q);
    return parts.filter((p) => {
      if (!p.active) return false;
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (onlyLowStock && Number(p.quantity) > Number(p.min_stock)) return false;
      if (term) {
        const hay = slug(
          [p.internal_code, p.original_code, p.description, p.brand, p.compatibility_notes, p.supplier, p.location].join(' '),
        );
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [parts, q, categoryFilter, onlyLowStock]);

  const hasFilters = q || categoryFilter || onlyLowStock;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventario y repuestos"
        subtitle={`${formatNumber(filtered.length)} de ${formatNumber(parts.length)} repuestos registrados`}
        actions={
          <>
            {can('inventory', 'export') && (
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                disabled={!filtered.length}
                onClick={() => exportPartsToExcel(filtered)}
              >
                Exportar Excel
              </Button>
            )}
            {(can('inventory', 'create') || can('inventory', 'edit')) && (
              <Button
                variant="secondary"
                icon={<ArrowUpRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
                onClick={() => {
                  setQuickDispatchPart(null);
                  setQuickDispatchOpen(true);
                }}
                className="font-semibold text-slate-800 dark:text-slate-100"
              >
                Salida / Entrega de repuesto
              </Button>
            )}
            {can('inventory', 'create') && (
              <>
                <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
                  Importar Excel
                </Button>
                <Button
                  icon={<Plus className="h-4 w-4" />}
                  onClick={() => {
                    setEditing(null);
                    setFormOpen(true);
                  }}
                >
                  Nuevo repuesto
                </Button>
              </>
            )}
          </>
        }
      />

      {/* Indicadores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Repuestos en catálogo"
          value={formatNumber(parts.filter((p) => p.active).length)}
          icon={<Package className="h-5 w-5" />}
          tone="brand"
          onClick={() => {
            setOnlyLowStock(false);
            setTab('catalogo');
          }}
        />
        <StatCard
          label="Con stock bajo / agotado"
          value={formatNumber(lowStockParts.length)}
          hint={lowStockParts.length ? 'Haga clic para filtrarlos' : 'Sin alertas de stock mínimo'}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={lowStockParts.length ? 'red' : 'green'}
          onClick={() => {
            setOnlyLowStock((v) => !v);
            setTab('catalogo');
          }}
        />
        <StatCard
          label="Valorización de stock"
          value={totalValuation > 0 ? `$ ${formatNumber(Math.round(totalValuation))}` : '—'}
          hint="Según precio de compra cargado"
          icon={<ArrowDownUp className="h-5 w-5" />}
          tone="amber"
        />
      </div>

      {lowStockParts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              <b>Alerta de stock mínimo:</b> hay <b>{lowStockParts.length}</b> repuestos en o por debajo de su stock mínimo (
              {lowStockParts
                .slice(0, 4)
                .map((p) => p.internal_code)
                .join(', ')}
              {lowStockParts.length > 4 ? '…' : ''}).
            </span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => setOnlyLowStock((v) => !v)}>
            {onlyLowStock ? 'Ver todos' : 'Ver solo stock bajo'}
          </Button>
        </div>
      )}

      {/* Pestañas */}
      <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
        <button
          onClick={() => setTab('catalogo')}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
            tab === 'catalogo'
              ? 'bg-brand-700 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          <Package className="h-4 w-4" /> Catálogo y existencias
        </button>
        <button
          onClick={() => setTab('movimientos')}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
            tab === 'movimientos'
              ? 'bg-brand-700 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          <History className="h-4 w-4" /> Movimientos de stock
        </button>
      </div>

      {tab === 'catalogo' ? (
        <>
          <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-4">
            <div className="relative sm:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="Buscar por código interno/original, descripción, marca, vehículo…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as '' | PartCategory)}>
              <option value="">Todas las categorías</option>
              {(Object.keys(PART_CATEGORY_LABELS) as PartCategory[]).map((c) => (
                <option key={c} value={c}>
                  {PART_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyLowStock}
                  onChange={(e) => setOnlyLowStock(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Solo stock bajo
              </label>
              {hasFilters && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setQ('');
                    setCategoryFilter('');
                    setOnlyLowStock(false);
                  }}
                  title="Limpiar filtros"
                >
                  <FilterX className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          <div className="card overflow-hidden">
            {isLoading ? (
              <Spinner />
            ) : !filtered.length ? (
              <EmptyState
                title={parts.length ? 'No hay repuestos que coincidan con los filtros' : 'El inventario aún no tiene repuestos cargados'}
                description="Agregue repuestos individualmente o importe su catálogo desde Excel."
                action={
                  can('inventory', 'create') && (
                    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                      Cargar primer repuesto
                    </Button>
                  )
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Código int.</th>
                      <th>Cód. original</th>
                      <th>Descripción</th>
                      <th>Categoría</th>
                      <th>Marca</th>
                      <th>Compatibilidad</th>
                      <th className="text-right">Disponible</th>
                      <th className="text-right">Mín.</th>
                      <th className="text-right">Precio</th>
                      <th>Ubicación</th>
                      <th className="text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filtered.map((p) => {
                      const low = Number(p.quantity) <= Number(p.min_stock);
                      return (
                        <tr key={p.id} className={cn(low && 'bg-red-50/40 dark:bg-red-950/15')}>
                          <td className="font-mono font-bold text-slate-900 dark:text-white">{p.internal_code}</td>
                          <td className="font-mono text-xs">{p.original_code || '—'}</td>
                          <td className="max-w-[240px] truncate font-medium">{p.description}</td>
                          <td>
                            <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {PART_CATEGORY_LABELS[p.category]}
                            </Badge>
                          </td>
                          <td>{p.brand || '—'}</td>
                          <td className="max-w-[180px] truncate text-xs text-slate-500">{p.compatibility_notes || '—'}</td>
                          <td className="text-right">
                            <span className={cn('font-bold', low ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400')}>
                              {formatNumber(Number(p.quantity))} {p.unit}
                            </span>
                          </td>
                          <td className="text-right text-xs text-slate-500">{formatNumber(Number(p.min_stock))}</td>
                          <td className="text-right">{p.purchase_price != null ? `$ ${formatNumber(Number(p.purchase_price))}` : '—'}</td>
                          <td>{p.location || '—'}</td>
                          <td className="text-right">
                            <div className="flex justify-end gap-1">
                              {(can('inventory', 'edit') || can('inventory', 'create')) && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    title="Registrar salida o entrega directa de este repuesto"
                                    onClick={() => {
                                      setQuickDispatchPart(p);
                                      setQuickDispatchOpen(true);
                                    }}
                                  >
                                    <ArrowUpRight className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> Salida
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    title="Registrar ingreso, devolución o ajuste de saldo"
                                    onClick={() => setMovPart(p)}
                                  >
                                    <ArrowDownUp className="h-3.5 w-3.5" /> Stock
                                  </Button>
                                </>
                              )}
                              {can('inventory', 'edit') && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  title="Editar ficha"
                                  onClick={() => {
                                    setEditing(p);
                                    setFormOpen(true);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="card overflow-hidden">
          {movLoading ? (
            <Spinner />
          ) : !movements.length ? (
            <EmptyState title="Aún no hay movimientos de stock registrados" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Repuesto</th>
                    <th>Tipo</th>
                    <th className="text-right">Variación</th>
                    <th className="text-right">Saldo</th>
                    <th>Motivo / OR</th>
                    <th>Usuario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td>{formatDate(m.created_at, true)}</td>
                      <td>
                        <span className="font-mono font-semibold">{m.parts?.internal_code}</span>{' '}
                        <span className="text-slate-500">{m.parts?.description}</span>
                      </td>
                      <td>
                        <Badge
                          className={
                            Number(m.quantity_delta) > 0
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          }
                        >
                          {STOCK_MOVEMENT_LABELS[m.movement_type]}
                        </Badge>
                      </td>
                      <td className={cn('text-right font-mono font-bold', Number(m.quantity_delta) > 0 ? 'text-emerald-600' : 'text-red-600')}>
                        {Number(m.quantity_delta) > 0 ? `+${m.quantity_delta}` : m.quantity_delta} {m.parts?.unit}
                      </td>
                      <td className="text-right font-mono">{m.resulting_quantity}</td>
                      <td className="max-w-xs truncate text-xs text-slate-600 dark:text-slate-300">{m.reason || '—'}</td>
                      <td className="text-xs text-slate-500">{m.user_email || 'Sistema'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <PartFormModal open={formOpen} onClose={() => setFormOpen(false)} part={editing} />
      <StockMovementModal part={movPart} onClose={() => setMovPart(null)} />
      <QuickDispatchModal
        open={quickDispatchOpen}
        onClose={() => {
          setQuickDispatchOpen(false);
          setQuickDispatchPart(null);
        }}
        initialPart={quickDispatchPart}
      />
      <ImportPartsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['parts'] });
          qc.invalidateQueries({ queryKey: ['stock-movements'] });
          qc.invalidateQueries({ queryKey: ['fleet-stats'] });
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
function PartFormModal({ open, onClose, part }: { open: boolean; onClose: () => void; part: Part | null }) {
  const { data: categories = [] } = useCategories();
  const save = useSavePart();

  const [internalCode, setInternalCode] = useState('');
  const [originalCode, setOriginalCode] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<PartCategory>('filtros');
  const [brand, setBrand] = useState('');
  const [compatibilityNotes, setCompatibilityNotes] = useState('');
  const [initialQty, setInitialQty] = useState('0');
  const [minStock, setMinStock] = useState('1');
  const [unit, setUnit] = useState('un.');
  const [price, setPrice] = useState('');
  const [supplier, setSupplier] = useState('');
  const [location, setLocation] = useState('');
  const [catIds, setCatIds] = useState<string[]>([]);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const key = open ? (part?.id ?? 'new') : null;
  if (key && key !== lastKey) {
    setLastKey(key);
    setInternalCode(part?.internal_code ?? '');
    setOriginalCode(part?.original_code ?? '');
    setDescription(part?.description ?? '');
    setCategory(part?.category ?? 'filtros');
    setBrand(part?.brand ?? '');
    setCompatibilityNotes(part?.compatibility_notes ?? '');
    setInitialQty('0');
    setMinStock(String(part?.min_stock ?? 1));
    setUnit(part?.unit ?? 'un.');
    setPrice(part?.purchase_price != null ? String(part.purchase_price) : '');
    setSupplier(part?.supplier ?? '');
    setLocation(part?.location ?? '');
    setCatIds(part?.part_category_compatibility?.map((c) => c.category_id) ?? []);
  }
  if (!key && lastKey) setLastKey(null);

  const toggleCat = (id: string) =>
    setCatIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!internalCode.trim() || !description.trim()) {
      return toast.error('El código interno y la descripción son obligatorios');
    }
    const num = (s: string) => {
      const t = s.trim().replace(',', '.');
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    try {
      await save.mutateAsync({
        id: part?.id,
        values: {
          internal_code: internalCode.trim().toUpperCase(),
          original_code: originalCode.trim() || null,
          description: description.trim(),
          category,
          brand: brand.trim() || null,
          compatibility_notes: compatibilityNotes.trim() || null,
          initial_quantity: !part ? (num(initialQty) ?? 0) : undefined,
          min_stock: num(minStock) ?? 0,
          unit: unit.trim() || 'un.',
          purchase_price: num(price),
          supplier: supplier.trim() || null,
          location: location.trim() || null,
          active: true,
          category_ids: catIds,
        },
      });
      toast.success(part ? 'Repuesto actualizado' : 'Repuesto registrado');
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={part ? `Editar repuesto ${part.internal_code}` : 'Nuevo repuesto / insumo'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Código interno" required>
            <input
              className="input font-mono uppercase"
              value={internalCode}
              onChange={(e) => setInternalCode(e.target.value)}
              placeholder="Ej.: FIL-ACE-R22"
              required
            />
          </Field>
          <Field label="Código original / fabricante">
            <input className="input font-mono uppercase" value={originalCode} onChange={(e) => setOriginalCode(e.target.value)} />
          </Field>
          <Field label="Categoría" required>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as PartCategory)}>
              {(Object.keys(PART_CATEGORY_LABELS) as PartCategory[]).map((c) => (
                <option key={c} value={c}>
                  {PART_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Descripción" required className="sm:col-span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} required />
          </Field>
          <Field label="Marca">
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Mann, Bosch, YPF…" />
          </Field>
          {!part && (
            <Field label="Cantidad inicial en stock">
              <input className="input" inputMode="decimal" value={initialQty} onChange={(e) => setInitialQty(e.target.value)} />
            </Field>
          )}
          <Field label="Stock mínimo (alerta)" required>
            <input className="input" inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </Field>
          <Field label="Unidad de medida" required>
            <input className="input" list="part-units" value={unit} onChange={(e) => setUnit(e.target.value)} />
            <datalist id="part-units">
              {PART_UNIT_SUGGESTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
          <Field label="Precio de compra ($)">
            <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Proveedor">
            <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="Ubicación en pañol / depósito">
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Estante A-2" />
          </Field>
        </div>

        <Field label="Compatibilidad con modelos de RV Group">
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            {categories.map((c) => {
              const active = catIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCat(c.id)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition',
                    active
                      ? 'bg-brand-700 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300',
                  )}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Notas de compatibilidad / equivalencias">
          <input
            className="input"
            value={compatibilityNotes}
            onChange={(e) => setCompatibilityNotes(e.target.value)}
            placeholder="Ej.: Ranger 2.2 TDCi 2016-2023 / Sprinter OM651…"
          />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
function StockMovementModal({ part, onClose }: { part: Part | null; onClose: () => void }) {
  const move = useRecordStockMovement();
  const [type, setType] = useState<'ingreso' | 'egreso_or' | 'devolucion' | 'ajuste'>('ingreso');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!part) return;
    const n = Number(qty.replace(',', '.'));
    if (!Number.isFinite(n) || (type !== 'ajuste' && n <= 0) || (type === 'ajuste' && n < 0)) {
      return toast.error('Ingrese una cantidad válida');
    }
    const c = cost.trim() === '' ? null : Number(cost.replace(',', '.'));
    try {
      const next = await move.mutateAsync({
        partId: part.id,
        type: type as StockMovementType,
        quantity: n,
        unitCost: c,
        reason: reason.trim() || undefined,
      });
      toast.success(`Stock actualizado: ${next} ${part.unit}`);
      setQty('');
      setCost('');
      setReason('');
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  return (
    <Modal
      open={!!part}
      onClose={onClose}
      size="sm"
      title={`Movimiento de stock · ${part?.internal_code ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={move.isPending}>
            Confirmar movimiento
          </Button>
        </>
      }
    >
      {part && (
        <form onSubmit={submit} className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800">
            <p className="font-medium">{part.description}</p>
            <p className="mt-0.5 text-slate-500">
              Stock actual: <b>{part.quantity} {part.unit}</b> (mínimo: {part.min_stock})
            </p>
          </div>
          <Field label="Tipo de operación" required>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="ingreso">Ingreso por compra / recepción (+)</option>
              <option value="egreso_or">Salida / Entrega de pañol (-)</option>
              <option value="devolucion">Devolución al pañol (+)</option>
              <option value="ajuste">Ajuste por recuento físico (= fija nuevo saldo)</option>
            </select>
          </Field>
          <Field
            label={
              type === 'ajuste'
                ? `Nuevo stock físico real (${part.unit})`
                : type === 'egreso_or'
                  ? `Cantidad que sale / se entrega (${part.unit})`
                  : `Cantidad que ingresa (${part.unit})`
            }
            required
          >
            <input className="input" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value)} required />
          </Field>
          {type === 'ingreso' && (
            <Field label="Precio unitario de compra ($)">
              <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
          )}
          <Field label={type === 'egreso_or' ? 'Entregado a / Chofer / Unidad / Motivo' : 'Motivo / remito / factura'}>
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={type === 'egreso_or' ? 'Ej.: Chofer Pérez · Ranger Int. 08 · Lámpara quemada' : 'Ej.: Factura A 0001-00012345'}
            />
          </Field>
          <button type="submit" className="hidden" />
        </form>
      )}
    </Modal>
  );
}

// -----------------------------------------------------------------------------
function ImportPartsModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof parsePartsExcelFile>>>([]);
  const [busy, setBusy] = useState(false);

  const handleFile = async (f: File) => {
    try {
      const parsed = await parsePartsExcelFile(f);
      if (!parsed.length) return toast.error('No se encontraron filas con Código interno y Descripción');
      setRows(parsed);
    } catch (err) {
      toast.error(`No se pudo leer el archivo: ${(err as Error).message}`);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('import_parts', { p_rows: rows });
      if (error) throw error;
      const res = data as { inserted: number; skipped: number };
      toast.success(`Importados ${res.inserted} repuestos (${res.skipped} ya existían).`);
      setRows([]);
      onDone();
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        setRows([]);
        onClose();
      }}
      size="lg"
      title="Importación masiva de repuestos desde Excel"
      footer={
        <>
          <Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={downloadPartsTemplate}>
            Descargar plantilla modelo
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!rows.length} loading={busy} onClick={() => void confirm()}>
            Importar {rows.length} repuestos
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div
          onClick={() => fileRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-brand-400 dark:border-slate-700"
        >
          <FileSpreadsheet className="h-9 w-9 text-brand-500" />
          <p className="text-sm font-medium">Seleccione un archivo Excel (.xlsx / .csv) con el listado de repuestos</p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
          />
        </div>
        {rows.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Categoría</th>
                  <th>Marca</th>
                  <th className="text-right">Cant.</th>
                  <th className="text-right">Mín.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td className="font-mono font-semibold">{r.internal_code}</td>
                    <td>{r.description}</td>
                    <td>{PART_CATEGORY_LABELS[r.category]}</td>
                    <td>{r.brand || '—'}</td>
                    <td className="text-right">{r.quantity}</td>
                    <td className="text-right">{r.min_stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
