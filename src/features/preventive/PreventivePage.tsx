import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Edit2,
  Eye,
  Gauge,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  Wrench,
} from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Spinner,
  StatCard,
} from '@/components/ui';
import { CHECK_ITEM_COLORS, CHECK_ITEM_LABELS, RTO_CHECKLIST_ITEMS } from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useVehicles } from '@/features/vehicles/api';
import {
  exportPreventiveToExcel,
  formatShortModelLabel,
  getBrandGroup,
  getComponentCellClass,
  getPresetByBrand,
  getRestanteCellClass,
  getRtoStatus,
  getServiceKmStatus,
  PREVENTIVE_KM_COLUMNS,
  useInspections,
  useUpdateVehiclePreventive,
  type BrandGroup,
  type PreventiveKmField,
} from './api';
import { InspectionFormModal } from './InspectionFormModal';
import { ImportPreventiveModal } from './ImportPreventiveModal';
import type { PreventiveInspection, Vehicle } from '@/types/db';

type FilterMode = 'all' | 'service_red' | 'service_yellow' | 'comp_red' | 'rto_alert';
type SortField = 'restante' | 'km' | 'proximo' | 'interno' | 'patente';
type SortDir = 'asc' | 'desc';

export function PreventivePage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: vehicles = [], isLoading: loadingVeh } = useVehicles();
  const { data: inspections = [], isLoading: loadingInsp } = useInspections();

  const [tab, setTab] = useState<'matrix' | 'inspections'>('matrix');
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState<'all' | BrandGroup>('all');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [sortField, setSortField] = useState<SortField>('restante');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [inspFilter, setInspFilter] = useState<'all' | 'ready' | 'not_ready'>('all');

  const [importOpen, setImportOpen] = useState(false);
  const [inspModalOpen, setInspModalOpen] = useState(false);
  const [inspDefaultVehicleId, setInspDefaultVehicleId] = useState<string | undefined>(undefined);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [detailInspection, setDetailInspection] = useState<PreventiveInspection | null>(null);

  const activeVehicles = useMemo(() => vehicles.filter((v) => v.status !== 'baja'), [vehicles]);

  const latestInspectionByVehicle = useMemo(() => {
    const map = new Map<string, PreventiveInspection>();
    for (const insp of inspections) {
      if (!map.has(insp.vehicle_id)) {
        map.set(insp.vehicle_id, insp);
      }
    }
    return map;
  }, [inspections]);

  const hasExpiredComponent = (v: Vehicle): boolean => {
    if (v.km_actual == null) return false;
    return PREVENTIVE_KM_COLUMNS.some((col) => {
      const target = v[col.field];
      return target != null && target - v.km_actual! <= 0;
    });
  };

  const metrics = useMemo(() => {
    let serviceRed = 0;
    let serviceYellow = 0;
    let compExpired = 0;
    let rtoAlert = 0;

    for (const v of activeVehicles) {
      const svc = getServiceKmStatus(v);
      if (svc.code === 'vencido') serviceRed++;
      if (svc.code === 'proximo') serviceYellow++;
      if (hasExpiredComponent(v)) compExpired++;

      const rto = getRtoStatus(v.rto_due_date);
      const lastInsp = latestInspectionByVehicle.get(v.id);
      if (rto.code === 'vencida' || rto.code === 'proxima' || (lastInsp && !lastInsp.overall_ready_for_rto)) {
        rtoAlert++;
      }
    }

    return { serviceRed, serviceYellow, compExpired, rtoAlert };
  }, [activeVehicles, latestInspectionByVehicle]);

  const filteredVehicles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeVehicles
      .filter((v) => {
        if (brandFilter !== 'all' && getBrandGroup(v) !== brandFilter) return false;
        if (q) {
          const hay = [
            v.patente,
            v.nro_interno,
            v.marca,
            v.modelo,
            v.version,
            formatShortModelLabel(v),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        const svc = getServiceKmStatus(v);
        const rto = getRtoStatus(v.rto_due_date);
        const lastInsp = latestInspectionByVehicle.get(v.id);

        if (filterMode === 'service_red') return svc.code === 'vencido';
        if (filterMode === 'service_yellow') return svc.code === 'proximo';
        if (filterMode === 'comp_red') return hasExpiredComponent(v);
        if (filterMode === 'rto_alert')
          return rto.code === 'vencida' || rto.code === 'proxima' || Boolean(lastInsp && !lastInsp.overall_ready_for_rto);
        return true;
      })
      .sort((a, b) => {
        const mult = sortDir === 'desc' ? -1 : 1;

        if (sortField === 'km') {
          const ka = a.km_actual ?? -1;
          const kb = b.km_actual ?? -1;
          if (ka !== kb) return (ka - kb) * mult;
        } else if (sortField === 'proximo') {
          const pa = getServiceKmStatus(a).nextKm ?? -1;
          const pb = getServiceKmStatus(b).nextKm ?? -1;
          if (pa !== pb) return (pa - pb) * mult;
        } else if (sortField === 'interno') {
          const ia = parseInt(a.nro_interno || '', 10);
          const ib = parseInt(b.nro_interno || '', 10);
          const na = Number.isNaN(ia) ? (sortDir === 'desc' ? -1 : 999999) : ia;
          const nb = Number.isNaN(ib) ? (sortDir === 'desc' ? -1 : 999999) : ib;
          if (na !== nb) return (na - nb) * mult;
        } else if (sortField === 'patente') {
          return a.patente.localeCompare(b.patente) * mult;
        } else {
          const ra = getServiceKmStatus(a).remainingKm ?? (sortDir === 'desc' ? -999999 : 999999);
          const rb = getServiceKmStatus(b).remainingKm ?? (sortDir === 'desc' ? -999999 : 999999);
          if (ra !== rb) return (ra - rb) * mult;
        }
        return a.patente.localeCompare(b.patente);
      });
  }, [activeVehicles, brandFilter, search, filterMode, latestInspectionByVehicle, sortField, sortDir]);

  const toggleColumnSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir(field === 'km' || field === 'proximo' ? 'desc' : 'asc');
    }
  };

  const filteredInspections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inspections.filter((i) => {
      if (q) {
        const hay = [i.patente, i.nro_interno, i.vehicle_label, i.inspector_name, i.observations]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (inspFilter === 'ready') return i.overall_ready_for_rto;
      if (inspFilter === 'not_ready') return !i.overall_ready_for_rto;
      return true;
    });
  }, [inspections, search, inspFilter]);

  if (loadingVeh || loadingInsp) return <Spinner />;

  const canCreate = can('preventive', 'create') || can('preventive', 'edit');
  const canEditVehicle = can('preventive', 'edit') || can('vehicles', 'edit');

  const brandTextClass = (b: BrandGroup) => {
    if (b === 'toyota') return 'font-bold text-slate-900 dark:text-white';
    if (b === 'ranger') return 'font-semibold text-purple-700 dark:text-purple-300';
    if (b === 'sprinter') return 'font-semibold text-teal-700 dark:text-teal-300';
    return 'font-medium text-slate-700 dark:text-slate-300';
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planilla de Mantenimiento Preventivo y RTO"
        subtitle="Control unificado por kilometraje (Service, Cubiertas, Correas, Amortiguadores, Cintas, Pastillas, Discos y Fluidos) e inspecciones previas a RTO"
        actions={
          <>
            {canEditVehicle && (
              <Button
                variant="success"
                icon={<Upload className="h-4 w-4" />}
                onClick={() => setImportOpen(true)}
              >
                Importar Unidades y Km
              </Button>
            )}
            {can('preventive', 'export') && (
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                onClick={() => exportPreventiveToExcel(vehicles, inspections)}
              >
                Exportar Planilla Excel
              </Button>
            )}
            {canCreate && (
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setInspDefaultVehicleId(undefined);
                  setInspModalOpen(true);
                }}
              >
                Inspección Previa a RTO
              </Button>
            )}
          </>
        }
      />

      {/* Indicadores superiores */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Service vencido o crítico (< 1.000 km)"
          value={formatNumber(metrics.serviceRed)}
          hint="En rojo en la columna Restante"
          icon={<Gauge className="h-5 w-5" />}
          tone={metrics.serviceRed > 0 ? 'red' : 'green'}
          onClick={() => {
            setTab('matrix');
            setFilterMode(filterMode === 'service_red' ? 'all' : 'service_red');
          }}
        />
        <StatCard
          label="Service próximo (1.000 a 2.500 km)"
          value={formatNumber(metrics.serviceYellow)}
          hint="En amarillo en la columna Restante"
          icon={<CalendarClock className="h-5 w-5" />}
          tone={metrics.serviceYellow > 0 ? 'amber' : 'brand'}
          onClick={() => {
            setTab('matrix');
            setFilterMode(filterMode === 'service_yellow' ? 'all' : 'service_yellow');
          }}
        />
        <StatCard
          label="Con componentes por cambiar"
          value={formatNumber(metrics.compExpired)}
          hint="Cubiertas, correas, frenos o fluidos en rojo"
          icon={<Wrench className="h-5 w-5" />}
          tone={metrics.compExpired > 0 ? 'red' : 'green'}
          onClick={() => {
            setTab('matrix');
            setFilterMode(filterMode === 'comp_red' ? 'all' : 'comp_red');
          }}
        />
        <StatCard
          label="Alertas de RTO / Pre-RTO"
          value={formatNumber(metrics.rtoAlert)}
          hint="RTO vencida, próxima o requiere trabajos"
          icon={<ShieldAlert className="h-5 w-5" />}
          tone={metrics.rtoAlert > 0 ? 'red' : 'green'}
          onClick={() => {
            setTab('matrix');
            setFilterMode(filterMode === 'rto_alert' ? 'all' : 'rto_alert');
          }}
        />
      </div>

      {/* Selector de vista y buscador */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setTab('matrix')}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                tab === 'matrix'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Planilla General de Preventivo por Km ({filteredVehicles.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('inspections')}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                tab === 'inspections'
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
              }`}
            >
              Inspecciones Previas a RTO ({inspections.length})
            </button>
          </div>

          {tab === 'matrix' && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs dark:border-slate-800 dark:bg-slate-900">
              <span className="text-slate-400">Línea:</span>
              <button
                type="button"
                onClick={() => setBrandFilter('all')}
                className={`rounded px-2 py-0.5 font-semibold ${
                  brandFilter === 'all' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600'
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setBrandFilter(brandFilter === 'toyota' ? 'all' : 'toyota')}
                className={`rounded px-2 py-0.5 font-bold ${
                  brandFilter === 'toyota'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-900 hover:bg-slate-100 dark:text-white'
                }`}
              >
                Toyota
              </button>
              <button
                type="button"
                onClick={() => setBrandFilter(brandFilter === 'ranger' ? 'all' : 'ranger')}
                className={`rounded px-2 py-0.5 font-bold ${
                  brandFilter === 'ranger'
                    ? 'bg-purple-700 text-white'
                    : 'text-purple-700 hover:bg-purple-50 dark:text-purple-300'
                }`}
              >
                Ranger
              </button>
              <button
                type="button"
                onClick={() => setBrandFilter(brandFilter === 'sprinter' ? 'all' : 'sprinter')}
                className={`rounded px-2 py-0.5 font-bold ${
                  brandFilter === 'sprinter'
                    ? 'bg-teal-700 text-white'
                    : 'text-teal-700 hover:bg-teal-50 dark:text-teal-300'
                }`}
              >
                Sprinter
              </button>
            </div>
          )}
        </div>

        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar patente, interno, modelo..."
          />
        </div>
      </div>

      {tab === 'matrix' ? (
        <div className="space-y-3">
          {/* Barra de filtros rápidos, ordenamiento Mayor a Menor y leyenda de colores */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'all', label: 'Todas las unidades' },
                  { id: 'service_red', label: 'Service vencido / < 1.000 km' },
                  { id: 'service_yellow', label: 'Service próximo (1.000–2.500 km)' },
                  { id: 'comp_red', label: 'Con componente en rojo' },
                  { id: 'rto_alert', label: 'Con alerta de RTO' },
                ] as { id: FilterMode; label: string }[]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterMode(f.id)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 ${
                    filterMode === f.id
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Controles para ordenar de Mayor a Menor / Menor a Mayor */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <span className="font-semibold text-slate-500">Ordenar por:</span>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-brand-600 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="restante">Km Restante p/ Service</option>
                <option value="km">Kilómetros actuales (Km)</option>
                <option value="proximo">Próximo Service (Km)</option>
                <option value="interno">N° Interno</option>
                <option value="patente">Patente (A-Z)</option>
              </select>

              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setSortDir('desc')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 ${
                    sortDir === 'desc'
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                  Mayor a menor
                </button>
                <button
                  type="button"
                  onClick={() => setSortDir('asc')}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 ${
                    sortDir === 'asc'
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                  }`}
                >
                  <ArrowUpNarrowWide className="h-3.5 w-3.5" />
                  Menor a mayor
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-red-400" /> Vencido / Crítico
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-yellow-300" /> Próximo a vencer
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded bg-emerald-200" /> En rango / Al día
              </span>
            </div>
            <span className="text-slate-500">
              Clic en los encabezados (<b>Km</b>, <b>Próximo Servi</b>, <b>Restante</b>) para alternar Mayor a menor / Menor a mayor · Clic en una fila para editar
            </span>
          </div>

          {filteredVehicles.length === 0 ? (
            <div className="card">
              <EmptyState
                title="No hay unidades que coincidan con el filtro"
                description="Pruebe cambiando el filtro de marca o estado."
              />
            </div>
          ) : (
            <div className="card overflow-hidden border border-slate-300 shadow-sm dark:border-slate-700">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b-2 border-slate-400 bg-slate-200/90 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      <th className="sticky left-0 z-10 bg-slate-200 px-2.5 py-2.5 text-left font-bold dark:bg-slate-800">
                        Modelo
                      </th>
                      <th
                        onClick={() => toggleColumnSort('interno')}
                        className="cursor-pointer select-none border-l border-slate-300 px-2 py-2.5 text-center font-bold hover:bg-slate-300/70 dark:border-slate-700 dark:hover:bg-slate-700"
                      >
                        Interno {sortField === 'interno' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                      </th>
                      <th
                        onClick={() => toggleColumnSort('patente')}
                        className="cursor-pointer select-none border-l border-slate-300 px-2.5 py-2.5 text-center font-bold hover:bg-slate-300/70 dark:border-slate-700 dark:hover:bg-slate-700"
                      >
                        Patente {sortField === 'patente' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                      </th>
                      <th
                        onClick={() => toggleColumnSort('km')}
                        className="cursor-pointer select-none border-l border-slate-300 px-2.5 py-2.5 text-right font-bold hover:bg-slate-300/70 dark:border-slate-700 dark:hover:bg-slate-700"
                      >
                        Km {sortField === 'km' ? (sortDir === 'desc' ? '↓' : '↑') : '⇅'}
                      </th>
                      <th
                        onClick={() => toggleColumnSort('proximo')}
                        className="cursor-pointer select-none border-l border-slate-300 px-2.5 py-2.5 text-right font-bold hover:bg-slate-300/70 dark:border-slate-700 dark:hover:bg-slate-700"
                      >
                        Próximo Servi {sortField === 'proximo' ? (sortDir === 'desc' ? '↓' : '↑') : '⇅'}
                      </th>
                      <th
                        onClick={() => toggleColumnSort('restante')}
                        className="cursor-pointer select-none border-l border-slate-300 px-2.5 py-2.5 text-right font-bold hover:bg-slate-300/70 dark:border-slate-700 dark:hover:bg-slate-700"
                      >
                        Restante {sortField === 'restante' ? (sortDir === 'desc' ? '↓' : '↑') : '⇅'}
                      </th>
                      {PREVENTIVE_KM_COLUMNS.map((col) => (
                        <th
                          key={col.field}
                          className="border-l border-slate-300 px-2 py-2.5 text-center font-bold whitespace-nowrap dark:border-slate-700"
                        >
                          {col.shortHeader}
                        </th>
                      ))}
                      <th className="border-l border-slate-300 px-2.5 py-2.5 text-center font-bold dark:border-slate-700">
                        RTO
                      </th>
                      <th className="border-l border-slate-300 px-2 py-2.5 text-center font-bold dark:border-slate-700">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {filteredVehicles.map((v) => {
                      const brand = getBrandGroup(v);
                      const modelLabel = formatShortModelLabel(v);
                      const svc = getServiceKmStatus(v);
                      const rto = getRtoStatus(v.rto_due_date);
                      const lastInsp = latestInspectionByVehicle.get(v.id);

                      return (
                        <tr
                          key={v.id}
                          onClick={() => canEditVehicle && setEditingVehicle(v)}
                          className="cursor-pointer transition hover:brightness-95"
                        >
                          <td
                            className={`sticky left-0 z-10 bg-white px-2.5 py-1.5 whitespace-nowrap dark:bg-slate-900 ${brandTextClass(brand)}`}
                          >
                            {modelLabel}
                          </td>
                          <td
                            className={`border-l border-slate-200 px-2 py-1.5 text-center dark:border-slate-800 ${brandTextClass(brand)}`}
                          >
                            {v.nro_interno || '-'}
                          </td>
                          <td
                            className={`border-l border-slate-200 px-2.5 py-1.5 text-center font-mono ${brandTextClass(brand)} dark:border-slate-800`}
                          >
                            {formatPatente(v.patente)}
                          </td>
                          <td
                            className={`border-l border-slate-200 px-2.5 py-1.5 text-right tabular-nums ${brandTextClass(brand)} dark:border-slate-800`}
                          >
                            {v.km_actual != null ? formatNumber(v.km_actual) : '—'}
                          </td>
                          <td
                            className={`border-l border-slate-200 px-2.5 py-1.5 text-right tabular-nums ${brandTextClass(brand)} dark:border-slate-800`}
                          >
                            {svc.nextKm != null ? formatNumber(svc.nextKm) : '—'}
                          </td>
                          <td
                            className={`border-l border-slate-200 px-2.5 py-1.5 text-right tabular-nums dark:border-slate-800 ${getRestanteCellClass(
                              svc.remainingKm,
                            )}`}
                          >
                            {svc.remainingKm != null ? formatNumber(svc.remainingKm) : '—'}
                          </td>

                          {PREVENTIVE_KM_COLUMNS.map((col) => {
                            const val = v[col.field];
                            const cellTone = getComponentCellClass(v.km_actual, val);
                            return (
                              <td
                                key={col.field}
                                title={
                                  val != null && v.km_actual != null
                                    ? `${col.label}: objetivo ${formatNumber(val)} km (restan ${formatNumber(val - v.km_actual)} km)`
                                    : `${col.label}: no aplica / sin dato`
                                }
                                className={`border-l border-slate-200 px-2 py-1.5 text-center tabular-nums dark:border-slate-800 ${cellTone}`}
                              >
                                {val != null ? formatNumber(val) : '-'}
                              </td>
                            );
                          })}

                          <td
                            className="border-l border-slate-200 px-2 py-1.5 text-center whitespace-nowrap dark:border-slate-800"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-center gap-1">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${rto.badgeClass}`}>
                                {v.rto_due_date ? formatDate(v.rto_due_date) : 'S/F'}
                              </span>
                              {lastInsp && !lastInsp.overall_ready_for_rto && (
                                <span
                                  title="Última inspección pre-RTO requiere trabajos"
                                  className="rounded bg-red-600 px-1 py-0.5 text-[10px] font-bold text-white"
                                >
                                  !
                                </span>
                              )}
                            </div>
                          </td>

                          <td
                            className="border-l border-slate-200 px-2 py-1.5 text-center whitespace-nowrap dark:border-slate-800"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-center gap-1">
                              {canEditVehicle && (
                                <button
                                  type="button"
                                  title="Editar Km, Próximo Service y Componentes"
                                  onClick={() => setEditingVehicle(v)}
                                  className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {canCreate && (
                                <button
                                  type="button"
                                  title="Realizar Inspección Previa a RTO"
                                  onClick={() => {
                                    setInspDefaultVehicleId(v.id);
                                    setInspModalOpen(true);
                                  }}
                                  className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-emerald-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                >
                                  <ClipboardCheck className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                title="Ver ficha completa de la unidad"
                                onClick={() => navigate(`/unidades/${v.id}`)}
                                className="rounded p-1 text-slate-600 hover:bg-slate-100 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                            </div>
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
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'all', label: 'Todas las inspecciones' },
                { id: 'not_ready', label: 'Requieren trabajos antes de RTO' },
                { id: 'ready', label: 'Aptas para presentarse a RTO' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setInspFilter(f.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  inspFilter === f.id
                    ? 'bg-brand-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredInspections.length === 0 ? (
            <div className="card">
              <EmptyState
                title="Aún no hay inspecciones previas a RTO registradas"
                description="Registre una inspección previa para verificar parabrisas, cubiertas, frenos, suspensión, luces, cinturones, elementos de seguridad y documentación."
                action={
                  canCreate && (
                    <Button
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => {
                        setInspDefaultVehicleId(undefined);
                        setInspModalOpen(true);
                      }}
                    >
                      Realizar primera inspección
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Unidad</th>
                      <th className="px-4 py-3">Resultado Pre-RTO</th>
                      <th className="px-4 py-3">Resumen de los 8 rubros</th>
                      <th className="px-4 py-3">Responsable</th>
                      <th className="px-4 py-3">Pendientes creados</th>
                      <th className="px-4 py-3 text-right">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredInspections.map((insp) => (
                      <tr key={insp.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-medium">{formatDate(insp.inspected_at)}</p>
                          {insp.kilometraje != null && (
                            <p className="text-xs text-slate-500">{formatNumber(insp.kilometraje)} km</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold">{formatPatente(insp.patente)}</span>
                          {insp.nro_interno && (
                            <span className="ml-1.5 text-xs text-slate-500">Int. {insp.nro_interno}</span>
                          )}
                          <p className="text-xs text-slate-500">{insp.vehicle_label || '—'}</p>
                        </td>
                        <td className="px-4 py-3">
                          {insp.overall_ready_for_rto ? (
                            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                              <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Apta para RTO
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                              <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Requiere trabajos
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {RTO_CHECKLIST_ITEMS.map((item) => {
                              const st = insp[item.stateField];
                              return (
                                <span
                                  key={item.key}
                                  title={`${item.label}: ${CHECK_ITEM_LABELS[st]}`}
                                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CHECK_ITEM_COLORS[st]}`}
                                >
                                  {item.label.replace('Estado de ', '').replace('Estado del ', '')}:{' '}
                                  {st === 'ok' ? 'OK' : st === 'reparar' ? 'Reparar' : st === 'observacion' ? 'Obs.' : 'N/A'}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                          {insp.inspector_name || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {insp.generated_pending_count > 0 ? (
                            <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                              {insp.generated_pending_count} pendiente(s)
                            </Badge>
                          ) : (
                            <span className="text-xs text-slate-400">Ninguno</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Eye className="h-3.5 w-3.5" />}
                            onClick={() => setDetailInspection(insp)}
                          >
                            Ver planilla
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de importación masiva de Unidades y Kilómetros actuales */}
      <ImportPreventiveModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        vehicles={vehicles}
      />

      {/* Modal de nueva inspección previa a RTO */}
      <InspectionFormModal
        open={inspModalOpen}
        onClose={() => setInspModalOpen(false)}
        vehicles={vehicles}
        defaultVehicleId={inspDefaultVehicleId}
      />

      {/* Modal para editar Km, Próximo Service, RTO y los 10 componentes de la planilla */}
      <VehiclePreventiveModal vehicle={editingVehicle} onClose={() => setEditingVehicle(null)} />

      {/* Modal de detalle de una inspección */}
      <InspectionDetailModal inspection={detailInspection} onClose={() => setDetailInspection(null)} />
    </div>
  );
}

function VehiclePreventiveModal({
  vehicle,
  onClose,
}: {
  vehicle: Vehicle | null;
  onClose: () => void;
}) {
  const updateMut = useUpdateVehiclePreventive();
  const [kmActual, setKmActual] = useState('');
  const [nextServiceKm, setNextServiceKm] = useState('');
  const [rtoDueDate, setRtoDueDate] = useState('');
  const [compValues, setCompValues] = useState<Record<PreventiveKmField, string>>({
    km_cubiertas: '',
    km_correas: '',
    km_amortiguadores_del: '',
    km_amortiguadores_tras: '',
    km_cintas: '',
    km_pastillas_del: '',
    km_pastillas_tras: '',
    km_discos_tras: '',
    km_discos_del: '',
    km_fluidos: '',
  });

  useEffect(() => {
    if (!vehicle) return;
    const svc = getServiceKmStatus(vehicle);
    setKmActual(vehicle.km_actual != null ? String(vehicle.km_actual) : '');
    setNextServiceKm(svc.nextKm != null ? String(svc.nextKm) : '');
    setRtoDueDate(vehicle.rto_due_date ?? '');
    setCompValues({
      km_cubiertas: vehicle.km_cubiertas != null ? String(vehicle.km_cubiertas) : '',
      km_correas: vehicle.km_correas != null ? String(vehicle.km_correas) : '',
      km_amortiguadores_del: vehicle.km_amortiguadores_del != null ? String(vehicle.km_amortiguadores_del) : '',
      km_amortiguadores_tras: vehicle.km_amortiguadores_tras != null ? String(vehicle.km_amortiguadores_tras) : '',
      km_cintas: vehicle.km_cintas != null ? String(vehicle.km_cintas) : '',
      km_pastillas_del: vehicle.km_pastillas_del != null ? String(vehicle.km_pastillas_del) : '',
      km_pastillas_tras: vehicle.km_pastillas_tras != null ? String(vehicle.km_pastillas_tras) : '',
      km_discos_tras: vehicle.km_discos_tras != null ? String(vehicle.km_discos_tras) : '',
      km_discos_del: vehicle.km_discos_del != null ? String(vehicle.km_discos_del) : '',
      km_fluidos: vehicle.km_fluidos != null ? String(vehicle.km_fluidos) : '',
    });
  }, [vehicle]);

  if (!vehicle) return null;

  const currentKmNum = kmActual.trim() ? Number(kmActual) : null;
  const nextServiceNum = nextServiceKm.trim() ? Number(nextServiceKm) : null;
  const remainingPreview =
    currentKmNum != null && nextServiceNum != null ? nextServiceNum - currentKmNum : null;

  const applyBrandPreset = () => {
    const preset = getPresetByBrand(getBrandGroup(vehicle));
    setCompValues({
      km_cubiertas: preset.km_cubiertas != null ? String(preset.km_cubiertas) : '',
      km_correas: preset.km_correas != null ? String(preset.km_correas) : '',
      km_amortiguadores_del: preset.km_amortiguadores_del != null ? String(preset.km_amortiguadores_del) : '',
      km_amortiguadores_tras: preset.km_amortiguadores_tras != null ? String(preset.km_amortiguadores_tras) : '',
      km_cintas: preset.km_cintas != null ? String(preset.km_cintas) : '',
      km_pastillas_del: preset.km_pastillas_del != null ? String(preset.km_pastillas_del) : '',
      km_pastillas_tras: preset.km_pastillas_tras != null ? String(preset.km_pastillas_tras) : '',
      km_discos_tras: preset.km_discos_tras != null ? String(preset.km_discos_tras) : '',
      km_discos_del: preset.km_discos_del != null ? String(preset.km_discos_del) : '',
      km_fluidos: preset.km_fluidos != null ? String(preset.km_fluidos) : '',
    });
    toast.info(`Valores estándar aplicados para ${formatShortModelLabel(vehicle)}`);
  };

  const bumpComponentFromCurrentKm = (field: PreventiveKmField, step: number) => {
    const base = currentKmNum ?? (compValues[field] ? Number(compValues[field]) : 0);
    setCompValues((prev) => ({ ...prev, [field]: String(base + step) }));
  };

  const toNullableInt = (s: string) => (s.trim() === '' ? null : Number(s));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateMut.mutateAsync({
        id: vehicle.id,
        km_actual: toNullableInt(kmActual),
        next_service_km: toNullableInt(nextServiceKm),
        rto_due_date: rtoDueDate || null,
        km_cubiertas: toNullableInt(compValues.km_cubiertas),
        km_correas: toNullableInt(compValues.km_correas),
        km_amortiguadores_del: toNullableInt(compValues.km_amortiguadores_del),
        km_amortiguadores_tras: toNullableInt(compValues.km_amortiguadores_tras),
        km_cintas: toNullableInt(compValues.km_cintas),
        km_pastillas_del: toNullableInt(compValues.km_pastillas_del),
        km_pastillas_tras: toNullableInt(compValues.km_pastillas_tras),
        km_discos_tras: toNullableInt(compValues.km_discos_tras),
        km_discos_del: toNullableInt(compValues.km_discos_del),
        km_fluidos: toNullableInt(compValues.km_fluidos),
      });
      toast.success(`Planilla preventiva actualizada para ${formatPatente(vehicle.patente)}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    }
  };

  return (
    <Modal
      open={Boolean(vehicle)}
      onClose={onClose}
      title={`Control Preventivo por Km — ${formatPatente(vehicle.patente)}`}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {formatShortModelLabel(vehicle)} · {formatPatente(vehicle.patente)}
              {vehicle.nro_interno ? ` · Interno ${vehicle.nro_interno}` : ''}
            </p>
            <p className="text-slate-500">{[vehicle.marca, vehicle.modelo, vehicle.version].filter(Boolean).join(' ')}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            onClick={applyBrandPreset}
          >
            Cargar estándar del modelo
          </Button>
        </div>

        {/* Bloque principal: Km actual, Próximo Service, Restante y RTO */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Km actual">
            <input
              type="number"
              min={0}
              className="input font-semibold"
              value={kmActual}
              onChange={(e) => setKmActual(e.target.value)}
            />
          </Field>

          <Field
            label="Próximo Servi (Km)"
            hint="Use +10.000 km al registrar un service"
          >
            <div className="flex gap-1.5">
              <input
                type="number"
                min={0}
                className="input font-semibold"
                value={nextServiceKm}
                onChange={(e) => setNextServiceKm(e.target.value)}
              />
              <button
                type="button"
                title="Programar próximo service a Km actual + 10.000 km"
                onClick={() => setNextServiceKm(String((currentKmNum ?? 0) + 10000))}
                className="shrink-0 rounded-lg border border-slate-300 bg-slate-100 px-2 text-xs font-semibold hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800"
              >
                +10k
              </button>
            </div>
          </Field>

          <Field label="Restante (calculado)">
            <div
              className={`flex h-10 items-center justify-end rounded-lg px-3 text-sm tabular-nums ${getRestanteCellClass(
                remainingPreview,
              )}`}
            >
              {remainingPreview != null ? `${formatNumber(remainingPreview)} km` : '—'}
            </div>
          </Field>

          <Field label="Vencimiento de RTO">
            <input
              type="date"
              className="input"
              value={rtoDueDate}
              onChange={(e) => setRtoDueDate(e.target.value)}
            />
          </Field>
        </div>

        {/* Los 10 componentes de seguimiento por kilometraje */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Kilometraje objetivo de próximo cambio por componente (dejar vacío si no aplica «-»)
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {PREVENTIVE_KM_COLUMNS.map((col) => {
              const rawVal = compValues[col.field];
              const numVal = rawVal.trim() === '' ? null : Number(rawVal);
              const cellClass = getComponentCellClass(currentKmNum, numVal);
              return (
                <div
                  key={col.field}
                  className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-800"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-1">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {col.shortHeader}
                    </label>
                    <button
                      type="button"
                      title={`Renovar desde Km actual (+${formatNumber(col.defaultStepKm)} km)`}
                      onClick={() => bumpComponentFromCurrentKm(col.field, col.defaultStepKm)}
                      className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-brand-100 hover:text-brand-800 dark:bg-slate-800 dark:text-slate-300"
                    >
                      <RotateCcw className="h-2.5 w-2.5" /> +{col.defaultStepKm / 1000}k
                    </button>
                  </div>
                  <input
                    type="number"
                    min={0}
                    placeholder="-"
                    value={rawVal}
                    onChange={(e) =>
                      setCompValues((prev) => ({ ...prev, [col.field]: e.target.value }))
                    }
                    className={`input h-9 text-right text-xs tabular-nums ${cellClass}`}
                  />
                  {numVal != null && currentKmNum != null && (
                    <p className="mt-1 text-right text-[11px] text-slate-500">
                      Restan: <b>{formatNumber(numVal - currentKmNum)} km</b>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={updateMut.isPending}>
            Guardar cambios
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function InspectionDetailModal({
  inspection,
  onClose,
}: {
  inspection: PreventiveInspection | null;
  onClose: () => void;
}) {
  if (!inspection) return null;

  return (
    <Modal
      open={Boolean(inspection)}
      onClose={onClose}
      title={`Planilla de Inspección Pre-RTO — ${formatPatente(inspection.patente)}`}
      size="lg"
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/60">
          <div>
            <p className="font-mono text-base font-bold">
              {formatPatente(inspection.patente)}
              {inspection.nro_interno ? ` · Int. ${inspection.nro_interno}` : ''}
            </p>
            <p className="text-xs text-slate-500">{inspection.vehicle_label || '—'}</p>
          </div>
          <div className="text-right">
            {inspection.overall_ready_for_rto ? (
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Apta para presentarse a RTO
              </Badge>
            ) : (
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Requiere trabajos antes de RTO
              </Badge>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Inspeccionada el {formatDate(inspection.inspected_at)}
              {inspection.inspector_name ? ` por ${inspection.inspector_name}` : ''}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <span className="text-slate-500">Kilometraje al control:</span>
            <p className="font-semibold">
              {inspection.kilometraje != null ? `${formatNumber(inspection.kilometraje)} km` : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <span className="text-slate-500">Vencimiento RTO:</span>
            <p className="font-semibold">
              {inspection.rto_due_date ? formatDate(inspection.rto_due_date) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
            <span className="text-slate-500">Pendientes generados:</span>
            <p className="font-semibold">{inspection.generated_pending_count}</p>
          </div>
        </div>

        <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {RTO_CHECKLIST_ITEMS.map((item) => {
            const st = inspection[item.stateField];
            const notes = inspection[item.notesField];
            return (
              <div key={item.key} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{item.label}</p>
                  {notes && <p className="text-xs text-slate-600 dark:text-slate-400">Nota: {notes}</p>}
                </div>
                <Badge className={CHECK_ITEM_COLORS[st]}>{CHECK_ITEM_LABELS[st]}</Badge>
              </div>
            );
          })}
        </div>

        {inspection.observations && (
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs font-semibold uppercase text-slate-500">Observaciones generales</p>
            <p className="mt-1 whitespace-pre-wrap">{inspection.observations}</p>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
