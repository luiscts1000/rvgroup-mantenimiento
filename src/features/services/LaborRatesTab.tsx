import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  DollarSign,
  TrendingUp,
  Clock,
  Plus,
  Pencil,
  Trash2,
  Search,
  FileSpreadsheet,
  Check,
  Percent,
  Wrench,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button, ConfirmDialog, EmptyState, Field, Modal, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { formatNumber, formatDate, getUserDisplayName } from '@/lib/utils';
import { LABOR_CATEGORIES, type LaborRate } from '@/types/laborRates';
import {
  useLaborRates,
  useLaborSettings,
  useSaveLaborRate,
  useDeleteLaborRate,
  useApplyPercentageIncrease,
  useUpdateHourlyRate,
} from './laborRatesApi';

const CATEGORY_COLORS: Record<string, string> = {
  'Service y Motor': 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  Frenos: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
  'Suspensión y Dirección': 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  'Transmisión y Embrague': 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300',
  'Neumáticos y Alineación': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  'Electricidad e Iluminación': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300',
  'Aire Acondicionado y Calefacción': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300',
  'Revisión y Diagnóstico': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300',
  General: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
};

export function LaborRatesTab() {
  const { session, profile, can } = useAuth();
  const userName = getUserDisplayName(profile, session?.user?.email);
  const canEdit = can('services', 'edit') || can('services', 'create') || profile?.role === 'admin' || profile?.role === 'gerencia';

  const { data: rates = [], isLoading: ratesLoading } = useLaborRates();
  const { data: settings } = useLaborSettings();

  const saveRate = useSaveLaborRate();
  const deleteRate = useDeleteLaborRate();
  const applyIncrease = useApplyPercentageIncrease();
  const updateHourly = useUpdateHourlyRate();

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('todas');

  // Modales
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<LaborRate | null>(null);

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkPercentage, setBulkPercentage] = useState('15');
  const [bulkCategory, setBulkCategory] = useState('todas');
  const [bulkRounding, setBulkRounding] = useState('500');

  const [hourlyModalOpen, setHourlyModalOpen] = useState(false);
  const [hourlyInput, setHourlyInput] = useState('');
  const [recalcOption, setRecalcOption] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<LaborRate | null>(null);

  // Formulario de edición rápida en línea de precio
  const [inlineEditingId, setInlineEditingId] = useState<string | null>(null);
  const [inlinePriceInput, setInlinePriceInput] = useState('');

  // Filtrado
  const filteredRates = useMemo(() => {
    return rates.filter((r) => {
      const matchCat = selectedCategory === 'todas' || r.category === selectedCategory;
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        (r.notes && r.notes.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [rates, selectedCategory, search]);

  // Métricas
  const metrics = useMemo(() => {
    const totalCount = rates.length;
    const avgPrice = totalCount > 0 ? Math.round(rates.reduce((acc, r) => acc + r.price, 0) / totalCount) : 0;
    const latestDate = rates.reduce((latest, r) => {
      if (!latest) return r.updated_at;
      return new Date(r.updated_at) > new Date(latest) ? r.updated_at : latest;
    }, '');
    return {
      totalCount,
      avgPrice,
      latestDate: latestDate || settings?.last_updated,
    };
  }, [rates, settings]);

  // Exportar Excel
  const handleExportExcel = () => {
    try {
      const data = filteredRates.map((r) => ({
        Rubro: r.category,
        'Trabajo / Mano de Obra': r.name,
        'Tiempo Estándar (Hs)': r.estimated_hours,
        'Precio de Mano de Obra ($)': r.price,
        Observaciones: r.notes || '',
        'Última Modificación': formatDate(r.updated_at, true),
      }));

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Tarifario Mano de Obra');
      XLSX.writeFile(wb, `Tarifario_Mano_Obra_RVGroup_${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success('Tarifario exportado a Excel');
    } catch {
      toast.error('Error al exportar a Excel');
    }
  };

  // Guardar edición rápida de precio
  const handleInlineSave = async (rate: LaborRate) => {
    const num = parseInt(inlinePriceInput.replace(/\./g, '').trim(), 10);
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Ingrese un precio válido');
      return;
    }
    try {
      await saveRate.mutateAsync({
        ...rate,
        price: num,
        updated_by_name: userName,
      });
      toast.success(`Precio de «${rate.name.slice(0, 30)}...» actualizado a $ ${formatNumber(num)}`);
      setInlineEditingId(null);
    } catch {
      toast.error('Error al actualizar el precio');
    }
  };

  // Guardar aumento masivo
  const handleBulkSubmit = async () => {
    const p = parseFloat(bulkPercentage.replace(',', '.'));
    if (!Number.isFinite(p) || p === 0) {
      toast.error('Ingrese un porcentaje de ajuste válido');
      return;
    }
    const roundTo = parseInt(bulkRounding, 10) || 0;
    try {
      const res = await applyIncrease.mutateAsync({
        percentage: p,
        category: bulkCategory === 'todas' ? undefined : bulkCategory,
        roundTo,
        userName,
      });
      toast.success(
        `¡Ajuste aplicado! Se actualizaron ${res.count} precios de mano de obra con un ${p > 0 ? '+' : ''}${p}%`,
      );
      setBulkModalOpen(false);
    } catch {
      toast.error('Error al aplicar el aumento masivo');
    }
  };

  // Guardar valor hora
  const handleHourlySubmit = async () => {
    const val = parseInt(hourlyInput.replace(/\./g, '').trim(), 10);
    if (!Number.isFinite(val) || val <= 0) {
      toast.error('Ingrese un valor hora válido');
      return;
    }
    try {
      await updateHourly.mutateAsync({
        hourlyRate: val,
        recalculatePrices: recalcOption,
        userName,
      });
      toast.success(
        recalcOption
          ? `Valor hora actualizado a $ ${formatNumber(val)} y precios recalculados según horas estimadas`
          : `Valor hora de taller actualizado a $ ${formatNumber(val)} / hora`,
      );
      setHourlyModalOpen(false);
    } catch {
      toast.error('Error al actualizar el valor hora');
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Tarjetas de métricas y controles superiores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Valor Hora Taller */}
        <div className="card relative overflow-hidden border-2 border-brand-500/20 bg-gradient-to-br from-brand-50/50 via-white to-white p-4 dark:from-brand-950/20 dark:via-slate-900 dark:to-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
              Valor Hora de Taller
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-black text-slate-900 dark:text-white">
              $ {formatNumber(settings?.hourly_rate ?? 28000)}
            </span>
            <span className="text-xs font-semibold text-slate-500">/ hora base</span>
          </div>
          {canEdit && (
            <button
              onClick={() => {
                setHourlyInput(String(settings?.hourly_rate ?? 28000));
                setRecalcOption(false);
                setHourlyModalOpen(true);
              }}
              className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline dark:text-brand-400"
            >
              <Pencil className="h-3 w-3" /> Modificar valor hora
            </button>
          )}
        </div>

        {/* Total de trabajos tarifados */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Tareas Tarifadas
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <Wrench className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-2xl font-black text-slate-900 dark:text-white">
            {metrics.totalCount} trabajos
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Listos para cotizar y aplicar en las OR
          </p>
        </div>

        {/* Precio promedio de mano de obra */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Precio Promedio M.O.
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 font-mono text-2xl font-black text-slate-900 dark:text-white">
            $ {formatNumber(metrics.avgPrice)}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Costo medio por intervención en taller
          </p>
        </div>

        {/* Última actualización */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Última Actualización
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-sm font-extrabold text-slate-900 dark:text-white">
            {metrics.latestDate ? formatDate(metrics.latestDate, true) : 'Hoy'}
          </div>
          <p className="mt-2 text-xs text-slate-500 truncate">
            Por: {settings?.updated_by_name || 'Coordinación'}
          </p>
        </div>
      </div>

      {/* 2. Barra de acciones rápidas */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900 dark:text-white">
            Tarifario Oficial de Mano de Obra · RV GROUP
          </h3>
          <p className="text-xs text-slate-500">
            Actualice precios individualmente o aplique incrementos porcentuales masivos por inflación.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <Button
                variant="primary"
                icon={<Percent className="h-4 w-4" />}
                onClick={() => setBulkModalOpen(true)}
                className="bg-brand-600 shadow-sm"
              >
                Ajuste masivo por inflación (% aumento)
              </Button>
              <Button
                variant="secondary"
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditingRate(null);
                  setRateModalOpen(true);
                }}
              >
                Nueva tarea de M.O.
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            icon={<FileSpreadsheet className="h-4 w-4" />}
            onClick={handleExportExcel}
            title="Exportar tarifario a Excel"
          >
            Exportar Excel
          </Button>
        </div>
      </div>

      {/* 3. Filtros y Búsqueda */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar trabajo por nombre, rubro o detalle (ej: pastillas, aceite, distribución)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
          <span className="text-xs font-semibold text-slate-500">
            Mostrando {filteredRates.length} de {rates.length} trabajos tarifados
          </span>
        </div>

        {/* Píldoras de Categorías */}
        <div className="flex flex-wrap items-center gap-1.5 pb-1">
          <button
            type="button"
            onClick={() => setSelectedCategory('todas')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              selectedCategory === 'todas'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300'
            }`}
          >
            Todas ({rates.length})
          </button>
          {LABOR_CATEGORIES.map((cat) => {
            const count = rates.filter((r) => r.category === cat).length;
            if (count === 0 && selectedCategory !== cat) return null;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  selectedCategory === cat
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-300'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Tabla de Tarifas de Mano de Obra */}
      {ratesLoading ? (
        <Spinner />
      ) : filteredRates.length === 0 ? (
        <div className="card p-8">
          <EmptyState
            title="No se encontraron trabajos de mano de obra"
            description="Intente con otro término de búsqueda o seleccione otro rubro."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setSelectedCategory('todas');
                }}
              >
                Limpiar filtros
              </Button>
            }
          />
        </div>
      ) : (
        <div className="card overflow-hidden border border-slate-200 dark:border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-extrabold text-slate-700 uppercase tracking-wider dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Trabajo / Tarea de Mano de Obra</th>
                  <th className="px-4 py-3">Rubro</th>
                  <th className="px-4 py-3 text-center">Tiempo Estándar</th>
                  <th className="px-4 py-3 text-right">Precio Mano de Obra ($)</th>
                  <th className="px-4 py-3 text-center">Última Modificación</th>
                  {canEdit && <th className="px-4 py-3 text-center">Acciones</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredRates.map((r, idx) => {
                  const isInlineEditing = inlineEditingId === r.id;
                  return (
                    <tr
                      key={r.id}
                      className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      {/* Nombre y notas */}
                      <td className="px-4 py-3 font-medium">
                        <div className="flex items-start gap-2">
                          <span className="font-mono text-xs font-bold text-slate-400">
                            {idx + 1}.
                          </span>
                          <div>
                            <div className="font-bold text-slate-900 dark:text-white">
                              {r.name}
                            </div>
                            {r.notes && (
                              <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                                {r.notes}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Rubro */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-extrabold ${
                            CATEGORY_COLORS[r.category] || CATEGORY_COLORS.General
                          }`}
                        >
                          {r.category}
                        </span>
                      </td>

                      {/* Horas estimadas */}
                      <td className="px-4 py-3 text-center font-mono font-semibold whitespace-nowrap text-slate-600 dark:text-slate-300">
                        {r.estimated_hours} Hs
                      </td>

                      {/* Precio de mano de obra */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isInlineEditing ? (
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <input
                              type="number"
                              inputMode="numeric"
                              className="input w-28 py-1 px-2 text-right font-mono font-black text-sm"
                              value={inlinePriceInput}
                              onChange={(e) => setInlinePriceInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleInlineSave(r);
                                if (e.key === 'Escape') setInlineEditingId(null);
                              }}
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => void handleInlineSave(r)}
                              className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 shadow-sm"
                              title="Guardar precio"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            <span className="font-mono text-base font-black text-brand-700 dark:text-brand-300">
                              $ {formatNumber(r.price)}
                            </span>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => {
                                  setInlineEditingId(r.id);
                                  setInlinePriceInput(String(r.price));
                                }}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                title="Editar precio rápidamente"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Fecha de modificación */}
                      <td className="px-4 py-3 text-center whitespace-nowrap text-xs text-slate-500">
                        <div>{formatDate(r.updated_at)}</div>
                        {r.updated_by_name && (
                          <div className="text-[10px] text-slate-400">{r.updated_by_name}</div>
                        )}
                      </td>

                      {/* Acciones */}
                      {canEdit && (
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRate(r);
                                setRateModalOpen(true);
                              }}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-950"
                              title="Editar tarea completa"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(r)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                              title="Eliminar del tarifario"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: Crear / Editar Tarea Individual */}
      <LaborRateFormModal
        open={rateModalOpen}
        onClose={() => setRateModalOpen(false)}
        rate={editingRate}
        userName={userName}
      />

      {/* MODAL: Ajuste masivo por inflación (% Aumento) */}
      <Modal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="Ajuste Masivo de Precios por Inflación (% Aumento)"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-brand-200 bg-brand-50/80 p-3 text-xs text-brand-900 dark:border-brand-900 dark:bg-brand-950/40 dark:text-brand-200">
            Esta acción actualizará los precios de mano de obra aplicando un porcentaje directo. Por ejemplo, ingresando <b>15</b>, un trabajo de $ 40.000 pasará a $ 46.000.
          </div>

          <Field label="Porcentaje de Aumento (%)">
            <div className="relative">
              <input
                type="number"
                step="1"
                className="input pr-8 font-mono text-lg font-black"
                placeholder="Ej.: 15"
                value={bulkPercentage}
                onChange={(e) => setBulkPercentage(e.target.value)}
              />
              <span className="pointer-events-none absolute right-3 top-2.5 font-bold text-slate-400">
                %
              </span>
            </div>
          </Field>

          <Field label="Aplicar a">
            <select
              className="input font-semibold"
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
            >
              <option value="todas">Todos los rubros y trabajos ({rates.length} tareas)</option>
              {LABOR_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  Solo {cat} ({rates.filter((r) => r.category === cat).length} tareas)
                </option>
              ))}
            </select>
          </Field>

          <Field label="Redondeo de Precios">
            <select
              className="input"
              value={bulkRounding}
              onChange={(e) => setBulkRounding(e.target.value)}
            >
              <option value="1000">Redondear a múltiplos de $ 1.000 (Recomendado)</option>
              <option value="500">Redondear a múltiplos de $ 500</option>
              <option value="100">Redondear a múltiplos de $ 100</option>
              <option value="0">Sin redondeo (valor exacto)</option>
            </select>
          </Field>

          {/* Vista previa rápida */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/50">
            <span className="font-bold text-slate-700 dark:text-slate-300">
              Ejemplos con {bulkPercentage}% de aumento:
            </span>
            <div className="mt-1.5 flex flex-wrap gap-4 font-mono">
              <span>
                $ 30.000 ➔{' '}
                <b className="text-emerald-700 dark:text-emerald-400">
                  ${' '}
                  {formatNumber(
                    Math.round(
                      (30000 * (1 + (parseFloat(bulkPercentage) || 0) / 100)) /
                        (parseInt(bulkRounding, 10) || 1),
                    ) * (parseInt(bulkRounding, 10) || 1),
                  )}
                </b>
              </span>
              <span>
                $ 50.000 ➔{' '}
                <b className="text-emerald-700 dark:text-emerald-400">
                  ${' '}
                  {formatNumber(
                    Math.round(
                      (50000 * (1 + (parseFloat(bulkPercentage) || 0) / 100)) /
                        (parseInt(bulkRounding, 10) || 1),
                    ) * (parseInt(bulkRounding, 10) || 1),
                  )}
                </b>
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="secondary" onClick={() => setBulkModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={applyIncrease.isPending}
              icon={<TrendingUp className="h-4 w-4" />}
              onClick={() => void handleBulkSubmit()}
            >
              Aplicar aumento a los precios
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Modificar Valor Hora de Taller */}
      <Modal
        open={hourlyModalOpen}
        onClose={() => setHourlyModalOpen(false)}
        title="Modificar Valor Hora de Taller ($/Hora)"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            El valor hora se utiliza como referencia de cotización en el taller y para autocalcular el costo de mano de obra en las Órdenes de Reparación según las horas trabajadas.
          </p>

          <Field label="Valor Hora Base ($ / hora)">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-2.5 font-bold text-slate-400">
                $
              </span>
              <input
                type="number"
                inputMode="numeric"
                className="input pl-8 font-mono text-xl font-black"
                placeholder="Ej.: 28000"
                value={hourlyInput}
                onChange={(e) => setHourlyInput(e.target.value)}
              />
            </div>
          </Field>

          <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 p-3 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/50 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-300"
              checked={recalcOption}
              onChange={(e) => setRecalcOption(e.target.checked)}
            />
            <span>
              <b>Recalcular automáticamente toda la lista de precios</b> multiplicando el nuevo valor hora por las horas estimadas de cada trabajo (Precio = Horas × Valor Hora).
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-3">
            <Button variant="secondary" onClick={() => setHourlyModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              loading={updateHourly.isPending}
              onClick={() => void handleHourlySubmit()}
            >
              Guardar nuevo valor hora
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Confirmar eliminación */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={async () => {
          if (!deleteConfirm) return;
          try {
            await deleteRate.mutateAsync(deleteConfirm.id);
            toast.success('Trabajo eliminado del tarifario');
            setDeleteConfirm(null);
          } catch {
            toast.error('Error al eliminar');
          }
        }}
        loading={deleteRate.isPending}
        title="Eliminar trabajo del tarifario"
        message={`¿Confirma que desea eliminar «${deleteConfirm?.name}» de la lista de precios de mano de obra?`}
        confirmLabel="Eliminar trabajo"
        danger
      />
    </div>
  );
}

/** Modal para crear o editar una tarea individual de mano de obra */
function LaborRateFormModal({
  open,
  onClose,
  rate,
  userName,
}: {
  open: boolean;
  onClose: () => void;
  rate: LaborRate | null;
  userName: string;
}) {
  const saveRate = useSaveLaborRate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('Service y Motor');
  const [hours, setHours] = useState('1.0');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');

  // Sincronizar al abrir
  useMemo(() => {
    if (rate) {
      setName(rate.name);
      setCategory(rate.category);
      setHours(String(rate.estimated_hours));
      setPrice(String(rate.price));
      setNotes(rate.notes || '');
    } else {
      setName('');
      setCategory('Service y Motor');
      setHours('1.0');
      setPrice('');
      setNotes('');
    }
  }, [rate, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Ingrese el nombre del trabajo');
      return;
    }
    const priceNum = parseInt(price.replace(/\./g, '').trim(), 10);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error('Ingrese un precio de mano de obra válido');
      return;
    }
    const hNum = parseFloat(hours.replace(',', '.'));
    const finalHours = Number.isFinite(hNum) && hNum > 0 ? hNum : 1.0;

    try {
      await saveRate.mutateAsync({
        id: rate?.id,
        name: name.trim(),
        category,
        estimated_hours: finalHours,
        price: priceNum,
        notes: notes.trim() || null,
        active: true,
        updated_by_name: userName,
      });
      toast.success(rate ? 'Trabajo actualizado' : 'Nuevo trabajo agregado al tarifario');
      onClose();
    } catch {
      toast.error('Error al guardar');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rate ? `Editar tarea: ${rate.name.slice(0, 35)}...` : 'Nueva Tarea de Mano de Obra'}
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <Field label="Descripción del trabajo / Mano de Obra" required>
          <input
            className="input font-bold"
            placeholder="Ej.: Cambio de pastillas de freno delanteras…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Rubro / Categoría" required>
            <select
              className="input font-semibold"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {LABOR_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tiempo Estimado Estándar (Hs)" required>
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="number"
                step="0.1"
                min="0.1"
                className="input pl-9 font-semibold"
                placeholder="Ej.: 1.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                required
              />
            </div>
          </Field>
        </div>

        <Field label="Precio de Mano de Obra ($)" required>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-2.5 font-bold text-slate-400">
              $
            </span>
            <input
              type="number"
              inputMode="numeric"
              className="input pl-8 font-mono text-xl font-black text-brand-700 dark:text-brand-300"
              placeholder="Ej.: 35000"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
        </Field>

        <Field label="Observaciones técnicas o alcance del trabajo">
          <textarea
            className="input min-h-[70px] text-xs"
            placeholder="Qué incluye la tarea, precauciones o piezas que se desarman…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={saveRate.isPending}>
            {rate ? 'Guardar cambios' : 'Crear trabajo en tarifario'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
