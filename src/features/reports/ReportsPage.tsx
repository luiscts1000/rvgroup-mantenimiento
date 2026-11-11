import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Disc,
  DollarSign,
  Download,
  FileText,
  Flame,
  Gauge,
  Layers,
  Package,
  PieChart as PieChartIcon,
  ShieldAlert,
  TrendingUp,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, EmptyState, Field, PageHeader, Spinner, StatCard } from '@/components/ui';
import { formatDate, formatNumber } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories, useVehicles } from '@/features/vehicles/api';
import { useWorkOrders } from '@/features/workOrders/api';
import { usePendingTasks } from '@/features/pending/api';
import { useAllWorkOrderItems } from '@/features/history/api';
import {
  computeFleetAnalytics,
  exportAnalyticsToExcel,
  generateFleetReportPdf,
} from './analytics';
import {
  detectFleetWearAnomalies,
  COMPONENT_BENCHMARKS,
  type WearComponentKind,
} from './wearAnalytics';

// ---------------------------------------------------------------------------
// Paleta cromática corporativa y profesional para gráficos
// ---------------------------------------------------------------------------
const CHART_COLORS = {
  brandDark: '#0f4c5c',
  brand: '#14559b',
  brandLight: '#2b7bf6',
  emerald: '#10b981',
  emeraldLight: '#34d399',
  amber: '#f59e0b',
  amberLight: '#fbbf24',
  red: '#ef4444',
  redLight: '#f87171',
  orange: '#f97316',
  violet: '#8b5cf6',
  sky: '#0284c7',
  cyan: '#06b6d4',
  slate: '#64748b',
};

const MAINTENANCE_COLORS: Record<string, string> = {
  preventivo: '#10b981',
  correctivo: '#f59e0b',
  rto: '#0284c7',
  inspeccion: '#8b5cf6',
  auxilio: '#ef4444',
};

const CATEGORICAL_PALETTE = [
  '#14559b',
  '#0f4c5c',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#0284c7',
  '#f97316',
  '#06b6d4',
  '#ec4899',
  '#64748b',
];

// ---------------------------------------------------------------------------
// Tooltip flotante interactivo y profesional (Estilo Ejecutivo / Dark Glass)
// ---------------------------------------------------------------------------
interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color?: string;
    fill?: string;
    dataKey?: string;
  }>;
  label?: string;
  isCurrency?: boolean;
  valueSuffix?: string;
  showTotal?: boolean;
}

function ModernChartTooltip({
  active,
  payload,
  label,
  isCurrency = false,
  valueSuffix = '',
  showTotal = true,
}: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const validItems = payload.filter((it) => it.value !== undefined && it.value !== null);
  const total = validItems.reduce((acc, it) => acc + (Number(it.value) || 0), 0);

  return (
    <div className="z-50 min-w-[210px] rounded-xl border border-slate-700/80 bg-slate-900/95 p-3 text-xs text-slate-100 shadow-2xl backdrop-blur-md">
      {label && (
        <div className="mb-2 border-b border-slate-800 pb-1.5 font-semibold text-slate-200">
          {label}
        </div>
      )}
      <div className="space-y-1.5">
        {validItems.map((item, idx) => {
          const color = item.color || item.fill || CHART_COLORS.brand;
          const valFormatted = isCurrency
            ? `$ ${formatNumber(item.value)}`
            : `${formatNumber(item.value)} ${valueSuffix}`.trim();
          const share = total > 0 ? ((item.value / total) * 100).toFixed(0) : null;

          return (
            <div key={idx} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-slate-300">{item.name}:</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono font-medium">
                <span>{valFormatted}</span>
                {share && validItems.length > 1 && (
                  <span className="text-[10px] text-slate-400">({share}%)</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {showTotal && validItems.length > 1 && (
        <div className="mt-2.5 flex items-center justify-between border-t border-slate-800 pt-2 font-semibold text-white">
          <span>Total:</span>
          <span className="font-mono text-rvgreen-400">
            {isCurrency ? `$ ${formatNumber(total)}` : `${formatNumber(total)} ${valueSuffix}`.trim()}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página Principal de Estadísticas y Reportes
// ---------------------------------------------------------------------------
export function ReportsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const { data: vehicles = [], isLoading: l1 } = useVehicles();
  const { data: categories = [] } = useCategories();
  const { data: workOrders = [], isLoading: l2 } = useWorkOrders();
  const { data: items = [], isLoading: l3 } = useAllWorkOrderItems();
  const { data: pendingTasks = [], isLoading: l4 } = usePendingTasks();

  const [categoryId, setCategoryId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [monthlyChartMode, setMonthlyChartMode] = useState<'area' | 'bar'>('area');

  const filteredVehicleIds = useMemo(() => {
    if (!categoryId) return null;
    return new Set(vehicles.filter((v) => v.category_id === categoryId).map((v) => v.id));
  }, [vehicles, categoryId]);

  const inRange = (iso: string | null | undefined) => {
    if (!iso) return true;
    const d = iso.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const filteredWOs = useMemo(() => {
    return workOrders.filter((w) => {
      if (filteredVehicleIds && !filteredVehicleIds.has(w.vehicle_id)) return false;
      if (!inRange(w.opened_at)) return false;
      return true;
    });
  }, [workOrders, filteredVehicleIds, dateFrom, dateTo]);

  const allowedWoIds = useMemo(() => new Set(filteredWOs.map((w) => w.id)), [filteredWOs]);

  const filteredItems = useMemo(() => {
    return items.filter((it) => allowedWoIds.has(it.work_order_id));
  }, [items, allowedWoIds]);

  const filteredPendings = useMemo(() => {
    return pendingTasks.filter((p) => {
      if (filteredVehicleIds && !filteredVehicleIds.has(p.vehicle_id)) return false;
      if (!inRange(p.detected_at)) return false;
      return true;
    });
  }, [pendingTasks, filteredVehicleIds, dateFrom, dateTo]);

  const analytics = useMemo(
    () =>
      computeFleetAnalytics({
        vehicles,
        workOrders: filteredWOs,
        items: filteredItems,
        pendingTasks: filteredPendings,
      }),
    [vehicles, filteredWOs, filteredItems, filteredPendings],
  );

  // Radar de desgaste anómalo y recambios prematuros en la flota
  const [wearFilter, setWearFilter] = useState<'all' | WearComponentKind>('all');
  const wearAnomalies = useMemo(
    () =>
      detectFleetWearAnomalies({
        vehicles,
        workOrders: filteredWOs,
        items: filteredItems,
      }),
    [vehicles, filteredWOs, filteredItems],
  );

  const filteredWearAnomalies = useMemo(() => {
    if (wearFilter === 'all') return wearAnomalies;
    return wearAnomalies.filter((a) => a.kind === wearFilter);
  }, [wearAnomalies, wearFilter]);

  // Datos para gráfico Donut de Gastos (Repuestos vs Mano de Obra)
  const costDistributionData = useMemo(() => {
    return [
      {
        name: 'Repuestos',
        value: analytics.totalPartsCost,
        color: CHART_COLORS.brand,
      },
      {
        name: 'Mano de obra',
        value: analytics.totalLaborCost,
        color: CHART_COLORS.amber,
      },
    ].filter((d) => d.value > 0);
  }, [analytics.totalPartsCost, analytics.totalLaborCost]);

  // Datos para gráfico Donut de Tipos de Mantenimiento
  const maintenanceDistributionData = useMemo(() => {
    return analytics.byMaintenanceType.map((m) => ({
      name: m.label,
      value: m.count,
      color: MAINTENANCE_COLORS[m.type] || CHART_COLORS.slate,
    }));
  }, [analytics.byMaintenanceType]);

  // Presets de fechas rápidos
  const setQuickRange = (preset: 'all' | 'this_year' | 'last_90' | 'last_30') => {
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
    } else if (preset === 'this_year') {
      setDateFrom(`${today.getFullYear()}-01-01`);
      setDateTo(toStr);
    } else if (preset === 'last_90') {
      const past = new Date();
      past.setDate(past.getDate() - 90);
      setDateFrom(past.toISOString().slice(0, 10));
      setDateTo(toStr);
    } else if (preset === 'last_30') {
      const past = new Date();
      past.setDate(past.getDate() - 30);
      setDateFrom(past.toISOString().slice(0, 10));
      setDateTo(toStr);
    }
  };

  if (l1 || l2 || l3 || l4) return <Spinner />;

  const periodLabel =
    [dateFrom ? `Desde ${formatDate(dateFrom)}` : null, dateTo ? `Hasta ${formatDate(dateTo)}` : null]
      .filter(Boolean)
      .join(' · ') || 'Histórico completo';

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    try {
      await generateFleetReportPdf(analytics, periodLabel);
      toast.success('Reporte estadístico en PDF descargado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar el reporte PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  const completionRate =
    analytics.totalOrders > 0
      ? Math.round((analytics.completedOrders / analytics.totalOrders) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estadísticas y reportes de flota"
        subtitle="Métricas operativas, costos reales, análisis de fallas frecuentes y evolución del mantenimiento vehicular"
        actions={
          can('reports', 'export') && (
            <>
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                onClick={() => exportAnalyticsToExcel(analytics, periodLabel)}
              >
                Exportar Excel
              </Button>
              <Button
                icon={<FileText className="h-4 w-4" />}
                loading={pdfBusy}
                onClick={() => void handleDownloadPdf()}
              >
                Exportar PDF
              </Button>
            </>
          )
        }
      />

      {/* Barra de Filtros y Rangos Rápidos */}
      <div className="card p-4.5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Categoría de flota" className="sm:col-span-1">
              <select
                className="input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">— Todas las categorías —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Desde fecha">
              <input
                type="date"
                className="input"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </Field>

            <Field label="Hasta fecha">
              <input
                type="date"
                className="input"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800 lg:border-t-0 lg:pt-0">
            <span className="mr-1 text-xs font-medium text-slate-400">Atajos:</span>
            <button
              type="button"
              onClick={() => setQuickRange('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                !dateFrom && !dateTo
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              Histórico
            </button>
            <button
              type="button"
              onClick={() => setQuickRange('this_year')}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Este año
            </button>
            <button
              type="button"
              onClick={() => setQuickRange('last_90')}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Últimos 90d
            </button>
            <button
              type="button"
              onClick={() => setQuickRange('last_30')}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Últimos 30d
            </button>
          </div>
        </div>
      </div>

      {/* Tarjetas de KPIs Ejecutivos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Inversión total"
          value={`$ ${formatNumber(analytics.totalCost)}`}
          hint={`Repuestos: $ ${formatNumber(analytics.totalPartsCost)} · M.O.: $ ${formatNumber(analytics.totalLaborCost)}`}
          icon={<DollarSign className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          label="Costo por Km (CPK Flota)"
          value={analytics.averageFleetCpk ? `$ ${analytics.averageFleetCpk}` : '—'}
          hint={analytics.totalFleetKm > 0 ? `${formatNumber(analytics.totalFleetKm)} km totales flota` : 'Sin odómetro'}
          icon={<Gauge className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          label="Órdenes de reparación"
          value={formatNumber(analytics.totalOrders)}
          hint={`${analytics.completedOrders} cerradas (${completionRate}% efectividad)`}
          icon={<Wrench className="h-5 w-5" />}
          tone="amber"
        />
        <StatCard
          label="Fallas detectadas"
          value={formatNumber(analytics.totalFailures)}
          hint={
            analytics.frequentFailures[0]
              ? `Mayor: ${analytics.frequentFailures[0].category}`
              : 'Sin novedades'
          }
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={analytics.totalFailures > 0 ? 'red' : 'green'}
        />
        <StatCard
          label="Repuestos utilizados"
          value={formatNumber(analytics.topPartsUsed.length)}
          hint={`${filteredItems.length} consumos en OR`}
          icon={<Package className="h-5 w-5" />}
          tone="green"
        />
      </div>

      {/* SECCIÓN 1: Gastos Mensuales y Evolución Operativa */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Gráfico 1: Gastos Mensuales con degradé y selector de vista */}
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                  <DollarSign className="h-4 w-4" />
                </span>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  Evolución de costos mensuales
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Inversión registrada en repuestos y mano de obra por mes
              </p>
            </div>
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setMonthlyChartMode('area')}
                className={`rounded-md px-2.5 py-1 transition-all ${
                  monthlyChartMode === 'area'
                    ? 'bg-white font-semibold text-brand-700 shadow-sm dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Áreas y curvas
              </button>
              <button
                type="button"
                onClick={() => setMonthlyChartMode('bar')}
                className={`rounded-md px-2.5 py-1 transition-all ${
                  monthlyChartMode === 'bar'
                    ? 'bg-white font-semibold text-brand-700 shadow-sm dark:bg-slate-800 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Barras apiladas
              </button>
            </div>
          </div>

          {analytics.monthlySeries.length === 0 ? (
            <EmptyState title="Sin órdenes registradas para graficar costos mensuales" />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                {monthlyChartMode === 'area' ? (
                  <AreaChart data={analytics.monthlySeries} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gradParts" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.brand} stopOpacity={0.65} />
                        <stop offset="95%" stopColor={CHART_COLORS.brand} stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="gradLabor" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART_COLORS.amber} stopOpacity={0.65} />
                        <stop offset="95%" stopColor={CHART_COLORS.amber} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                    <XAxis
                      dataKey="monthLabel"
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                      tickFormatter={(val) => `$ ${val >= 1_000_000 ? `${(val / 1_000_000).toFixed(1)}M` : val >= 1000 ? `${Math.round(val / 1000)}k` : val}`}
                    />
                    <Tooltip content={<ModernChartTooltip isCurrency />} />
                    <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="partsCost"
                      name="Repuestos ($)"
                      stroke={CHART_COLORS.brand}
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#gradParts)"
                    />
                    <Area
                      type="monotone"
                      dataKey="laborCost"
                      name="Mano de obra ($)"
                      stroke={CHART_COLORS.amber}
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#gradLabor)"
                    />
                  </AreaChart>
                ) : (
                  <BarChart data={analytics.monthlySeries} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                    <XAxis
                      dataKey="monthLabel"
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                    />
                    <YAxis
                      tick={{ fill: '#64748b', fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                      tickFormatter={(val) => `$ ${val >= 1_000_000 ? `${(val / 1_000_000).toFixed(1)}M` : val >= 1000 ? `${Math.round(val / 1000)}k` : val}`}
                    />
                    <Tooltip content={<ModernChartTooltip isCurrency />} />
                    <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />
                    <Bar
                      dataKey="partsCost"
                      name="Repuestos ($)"
                      stackId="cost"
                      fill={CHART_COLORS.brand}
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="laborCost"
                      name="Mano de obra ($)"
                      stackId="cost"
                      fill={CHART_COLORS.amber}
                      radius={[6, 6, 0, 0]}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Gráfico 2: Evolución de las reparaciones (Flujo Operativo) */}
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <TrendingUp className="h-4 w-4" />
                </span>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  Ritmo y evolución de reparaciones
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Órdenes abiertas vs finalizadas por mes (flujo del taller)
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{completionRate}% resueltas</span>
            </div>
          </div>

          {analytics.monthlySeries.length === 0 ? (
            <EmptyState title="Sin datos de reparaciones para el período seleccionado" />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.monthlySeries} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                  <defs>
                    <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.sky} stopOpacity={0.6} />
                      <stop offset="95%" stopColor={CHART_COLORS.sky} stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="gradClosed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.emerald} stopOpacity={0.6} />
                      <stop offset="95%" stopColor={CHART_COLORS.emerald} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis
                    dataKey="monthLabel"
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <Tooltip content={<ModernChartTooltip valueSuffix="OR" />} />
                  <Legend wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />
                  <Area
                    type="monotone"
                    dataKey="ordersOpened"
                    name="OR Abiertas"
                    stroke={CHART_COLORS.sky}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#gradOpened)"
                  />
                  <Area
                    type="monotone"
                    dataKey="ordersClosed"
                    name="OR Finalizadas"
                    stroke={CHART_COLORS.emerald}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#gradClosed)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* SECCIÓN 2: Distribución Ejecutiva (Donuts / Proporciones de Costos y Tipos) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Donut 1: Proporción Repuestos vs Mano de obra */}
        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                <PieChartIcon className="h-4 w-4" />
              </span>
              <h2 className="font-semibold text-slate-900 dark:text-white">
                Distribución de inversión en mantenimiento
              </h2>
            </div>
            <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
              100% de costos
            </span>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Relación porcentual entre gasto en repuestos adquiridos y mano de obra
          </p>

          {costDistributionData.length === 0 ? (
            <EmptyState title="Sin costos cargados en el período" />
          ) : (
            <div className="flex flex-col items-center sm:flex-row sm:items-center sm:justify-around">
              <div className="relative h-64 w-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={costDistributionData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={68}
                      outerRadius={95}
                      paddingAngle={4}
                      cornerRadius={6}
                    >
                      {costDistributionData.map((entry, index) => (
                        <Cell key={`cost-cell-${index}`} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip content={<ModernChartTooltip isCurrency showTotal={false} />} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Texto al centro del Donut */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Total</span>
                  <span className="text-lg font-bold font-mono text-slate-900 dark:text-white">
                    ${formatNumber(analytics.totalCost)}
                  </span>
                </div>
              </div>

              {/* Leyenda y desglose numérico */}
              <div className="mt-4 flex flex-col gap-3 sm:mt-0">
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS.brand }} />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Repuestos e Insumos</span>
                  </div>
                  <p className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white">
                    $ {formatNumber(analytics.totalPartsCost)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {analytics.totalCost > 0
                      ? `${Math.round((analytics.totalPartsCost / analytics.totalCost) * 100)}% de la inversión total`
                      : '0%'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS.amber }} />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Mano de Obra</span>
                  </div>
                  <p className="mt-1 font-mono text-base font-bold text-slate-900 dark:text-white">
                    $ {formatNumber(analytics.totalLaborCost)}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {analytics.totalCost > 0
                      ? `${Math.round((analytics.totalLaborCost / analytics.totalCost) * 100)}% de la inversión total`
                      : '0%'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Donut 2: Distribución por Tipo de Mantenimiento */}
        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                <Layers className="h-4 w-4" />
              </span>
              <h2 className="font-semibold text-slate-900 dark:text-white">
                Distribución por tipo de mantenimiento
              </h2>
            </div>
            <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
              {analytics.totalOrders} órdenes
            </span>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Proporción de intervenciones preventivas, correctivas, RTO y servicios
          </p>

          {maintenanceDistributionData.length === 0 ? (
            <EmptyState title="Sin órdenes en el período" />
          ) : (
            <div className="flex flex-col items-center sm:flex-row sm:items-center sm:justify-around">
              <div className="relative h-64 w-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={maintenanceDistributionData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={68}
                      outerRadius={95}
                      paddingAngle={3}
                      cornerRadius={6}
                    >
                      {maintenanceDistributionData.map((entry, index) => (
                        <Cell key={`maint-cell-${index}`} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip content={<ModernChartTooltip valueSuffix="OR" showTotal={false} />} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Texto al centro del Donut */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Total</span>
                  <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">
                    {analytics.totalOrders}
                  </span>
                  <span className="text-[10px] text-slate-400">Órdenes</span>
                </div>
              </div>

              {/* Leyenda tipo listado */}
              <div className="mt-4 flex flex-col gap-2 sm:mt-0">
                {analytics.byMaintenanceType.map((m) => {
                  const color = MAINTENANCE_COLORS[m.type] || CHART_COLORS.slate;
                  const pct =
                    analytics.totalOrders > 0
                      ? Math.round((m.count / analytics.totalOrders) * 100)
                      : 0;
                  return (
                    <div
                      key={m.type}
                      className="flex items-center justify-between gap-4 rounded-lg px-2.5 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-xs text-slate-700 dark:text-slate-300">{m.label}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <span className="font-bold text-slate-900 dark:text-white">{m.count}</span>
                        <span className="text-[11px] text-slate-400">({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECCIÓN 3: Rankings de Unidades (Ingresos al Taller vs Mayor Cantidad de Fallas) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Gráfico 3: Vehículos con más ingresos al taller */}
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  <Wrench className="h-4 w-4" />
                </span>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  Vehículos con más ingresos al taller (Top 10)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Unidades con mayor demanda de capacidad mecánica (preventivas vs correctivas)
              </p>
            </div>
          </div>

          {analytics.topWorkshopEntries.length === 0 ? (
            <EmptyState title="Sin ingresos al taller registrados en el período" />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.topWorkshopEntries.slice(0, 10)}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="patente"
                    width={85}
                    tick={{ fill: '#334155', fontSize: 11, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <Tooltip content={<ModernChartTooltip valueSuffix="OR" />} />
                  <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12 }} />
                  <Bar
                    dataKey="preventiveOrders"
                    name="Preventivos"
                    stackId="ord"
                    fill={CHART_COLORS.emerald}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="correctiveOrders"
                    name="Correctivos / Otros"
                    stackId="ord"
                    fill={CHART_COLORS.amber}
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Gráfico 4: Vehículos con mayor cantidad de fallas */}
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  Vehículos con mayor índice de fallas (Top 10)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Suma de reparaciones correctivas/emergencia y trabajos pendientes detectados
              </p>
            </div>
          </div>

          {analytics.topFailureVehicles.length === 0 ? (
            <EmptyState title="Sin fallas o pendientes registrados en las unidades" />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.topFailureVehicles.slice(0, 10)}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="patente"
                    width={85}
                    tick={{ fill: '#334155', fontSize: 11, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <Tooltip content={<ModernChartTooltip valueSuffix="casos" />} />
                  <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12 }} />
                  <Bar
                    dataKey="correctiveOrders"
                    name="OR por falla"
                    stackId="fail"
                    fill={CHART_COLORS.red}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="pendingCount"
                    name="Pendientes detectados"
                    stackId="fail"
                    fill={CHART_COLORS.orange}
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* SECCIÓN 4: Fallas más Frecuentes y Gastos Acumulados por Unidad */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Gráfico 5: Fallas más frecuentes por rubro con gradiente progresivo */}
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                  <BarChart3 className="h-4 w-4" />
                </span>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  Fallas más frecuentes por sistema
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Clasificación por sistema o rubro mecánico (frenos, cubiertas, suspensión, etc.)
              </p>
            </div>
          </div>

          {analytics.frequentFailures.length === 0 ? (
            <EmptyState title="Sin novedades clasificadas en el período" />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.frequentFailures}
                  layout="vertical"
                  margin={{ top: 5, right: 25, left: 35, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={170}
                    tick={{ fill: '#334155', fontSize: 11, fontWeight: 500 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <Tooltip content={<ModernChartTooltip valueSuffix="incidentes" showTotal={false} />} />
                  <Bar dataKey="count" name="Casos registrados" radius={[0, 8, 8, 0]}>
                    {analytics.frequentFailures.map((_, idx) => (
                      <Cell
                        key={`cell-fail-${idx}`}
                        fill={CATEGORICAL_PALETTE[idx % CATEGORICAL_PALETTE.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Gráfico 6: Inversión por unidad (Top 10) */}
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <DollarSign className="h-4 w-4" />
                </span>
                <h2 className="font-semibold text-slate-900 dark:text-white">
                  Inversión acumulada por unidad (Top 10)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Unidades con mayor costo total en mantenimiento durante el período
              </p>
            </div>
          </div>

          {analytics.expensesByVehicle.filter((e) => e.totalCost > 0).length === 0 ? (
            <EmptyState title="Sin costos cargados en las órdenes de reparación" />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.expensesByVehicle.filter((e) => e.totalCost > 0).slice(0, 10)}
                  layout="vertical"
                  margin={{ top: 5, right: 25, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#94a3b8" strokeOpacity={0.2} />
                  <XAxis
                    type="number"
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                    tickFormatter={(val) => `$ ${val >= 1_000_000 ? `${(val / 1_000_000).toFixed(1)}M` : val >= 1000 ? `${Math.round(val / 1000)}k` : val}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="patente"
                    width={85}
                    tick={{ fill: '#334155', fontSize: 11, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <Tooltip content={<ModernChartTooltip isCurrency />} />
                  <Legend wrapperStyle={{ paddingTop: 8, fontSize: 12 }} />
                  <Bar
                    dataKey="partsCost"
                    name="Repuestos ($)"
                    stackId="u"
                    fill={CHART_COLORS.brand}
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="laborCost"
                    name="Mano de obra ($)"
                    stackId="u"
                    fill={CHART_COLORS.amber}
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* SECCIÓN 5: Radar de Desgaste Anómalo y Recambios Prematuros (Inteligencia de Flota) */}
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-5 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400">
                <Flame className="h-4.5 w-4.5" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Radar de Desgaste Anómalo y Frecuencia de Recambio
                </h2>
                <p className="text-xs text-slate-500">
                  Detecta unidades con recambios prematuros de neumáticos, frenos, amortiguadores, batería o embrague
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Badges de resumen */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
                <ShieldAlert className="h-3.5 w-3.5" />
                {wearAnomalies.filter((a) => a.severity === 'critico').length} Críticas
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                {wearAnomalies.filter((a) => a.severity === 'advertencia').length} Advertencias
              </span>
            </div>

            {/* Selector de filtro por tipo de componente */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium dark:border-slate-800 dark:bg-slate-900">
              {(
                [
                  { id: 'all', label: 'Todos' },
                  { id: 'cubiertas', label: 'Cubiertas' },
                  { id: 'frenos', label: 'Frenos' },
                  { id: 'amortiguadores', label: 'Suspensión' },
                  { id: 'bateria', label: 'Batería' },
                  { id: 'embrague', label: 'Embrague' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setWearFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 transition-all ${
                    wearFilter === tab.id
                      ? 'bg-white font-semibold text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredWearAnomalies.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {wearFilter === 'all'
                ? 'Sin anomalías de desgaste detectadas en la flota'
                : `Sin anomalías detectadas en ${COMPONENT_BENCHMARKS[wearFilter]?.label || wearFilter}`}
            </h3>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              Los intervalos de recambio registrados en las órdenes de reparación se encuentran dentro de los parámetros esperados de vida útil normal.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filteredWearAnomalies.map((a, idx) => {
              const isCrit = a.severity === 'critico';
              return (
                <div
                  key={`${a.vehicleId}:${a.kind}:${idx}`}
                  className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-bold ${
                        isCrit
                          ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                      }`}
                    >
                      {a.kind === 'cubiertas' && <Disc className="h-5 w-5" />}
                      {a.kind === 'frenos' && <AlertOctagon className="h-5 w-5" />}
                      {a.kind === 'amortiguadores' && <Layers className="h-5 w-5" />}
                      {a.kind === 'bateria' && <Zap className="h-5 w-5" />}
                      {a.kind === 'embrague' && <Flame className="h-5 w-5" />}
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/unidades/${a.vehicleId}`)}
                          className="font-mono text-sm font-bold text-slate-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400"
                        >
                          {a.patente}
                        </button>
                        {a.nro_interno && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            Int. {a.nro_interno}
                          </span>
                        )}
                        <span className="text-xs text-slate-500">· {a.marcaModelo}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isCrit
                              ? 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-950/60 dark:text-red-300'
                              : 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300'
                          }`}
                        >
                          {isCrit ? 'Desgaste Crítico' : 'Desgaste Prematuro'}
                        </span>
                      </div>

                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {a.summary}
                      </p>

                      <p className="text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700 dark:text-slate-300">Diagnóstico sugerido:</span>{' '}
                        {a.recommendation}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-100 pt-2 sm:border-0 sm:pt-0">
                    <div className="text-right">
                      <div className="font-mono text-xs font-bold text-red-600 dark:text-red-400">
                        {a.deviationPercent}% vs norma
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {a.averageIntervalKm
                          ? `Cada ~${formatNumber(a.averageIntervalKm)} km`
                          : `${a.replacementsCount} recambios`}
                      </div>
                      {a.totalSpent > 0 && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                          Gasto: $ {formatNumber(a.totalSpent)}
                        </div>
                      )}
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/unidades/${a.vehicleId}`)}
                      className="gap-1 text-xs"
                    >
                      <span>Ver ficha</span>
                      <ArrowUpRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECCIÓN 6: Tablas Detalladas con Badges de Podio y Barras de Progresión */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Tabla: Detalle de gastos por unidad */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-white">
                Ranking de costos e ingresos por unidad
              </h2>
              <p className="text-xs text-slate-500">
                Haga clic en una fila para inspeccionar el historial completo
              </p>
            </div>
            <span className="text-xs text-slate-400">
              {analytics.expensesByVehicle.length} unidades
            </span>
          </div>
          {analytics.expensesByVehicle.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Sin datos registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-2.5">#</th>
                    <th className="px-3 py-2.5">Unidad</th>
                    <th className="px-3 py-2.5 text-right">OR</th>
                    <th className="px-3 py-2.5 text-right">Km Actual</th>
                    <th className="px-3 py-2.5 text-right">CPK ($/km)</th>
                    <th className="px-3 py-2.5 text-right">Repuestos</th>
                    <th className="px-3 py-2.5 text-right">M.O.</th>
                    <th className="px-4 py-2.5 text-right">Total Invertido</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {analytics.expensesByVehicle.slice(0, 15).map((e, idx) => {
                    const isTop1 = idx === 0 && e.totalCost > 0;
                    const isTop2 = idx === 1 && e.totalCost > 0;
                    const isTop3 = idx === 2 && e.totalCost > 0;

                    return (
                      <tr
                        key={e.vehicle_id}
                        onClick={() => navigate(`/historial?vehicleId=${e.vehicle_id}`)}
                        className="group cursor-pointer transition-colors hover:bg-brand-50/50 dark:hover:bg-slate-800/50"
                      >
                        <td className="px-4 py-2.5">
                          {isTop1 ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                              1
                            </span>
                          ) : isTop2 ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                              2
                            </span>
                          ) : isTop3 ? (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-100 text-[11px] font-bold text-orange-800 dark:bg-orange-900/60 dark:text-orange-300">
                              3
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">{idx + 1}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-brand-700 transition-colors group-hover:underline dark:text-brand-300">
                              {e.patente}
                            </span>
                            {e.nro_interno && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                Int. {e.nro_interno}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-slate-400">{e.label}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-slate-600 dark:text-slate-300">
                          {e.ordersCount}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-500">
                          {e.km_actual ? `${formatNumber(e.km_actual)}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold">
                          {e.cpk != null ? (
                            <span
                              className={`rounded px-1.5 py-0.5 ${
                                e.cpk < 25
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : e.cpk < 50
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                              }`}
                            >
                              ${e.cpk}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-600 dark:text-slate-300">
                          $ {formatNumber(e.partsCost)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-600 dark:text-slate-300">
                          $ {formatNumber(e.laborCost)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="font-mono font-bold text-slate-900 dark:text-white">
                            $ {formatNumber(e.totalCost)}
                          </div>
                          {analytics.totalCost > 0 && e.totalCost > 0 && (
                            <div className="mt-1 flex items-center justify-end gap-1.5">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                <div
                                  className="h-full rounded-full bg-brand-600 dark:bg-brand-400"
                                  style={{
                                    width: `${Math.min(100, Math.round((e.totalCost / analytics.totalCost) * 100))}%`,
                                  }}
                                />
                              </div>
                              <span className="text-[10px] text-slate-400">
                                {((e.totalCost / analytics.totalCost) * 100).toFixed(0)}%
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Tabla: Repuestos más utilizados */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-white">
                Ranking de repuestos e insumos más usados
              </h2>
              <p className="text-xs text-slate-500">
                Consumo físico e impacto presupuestario por código de pieza
              </p>
            </div>
            <span className="text-xs text-slate-400">
              {analytics.topPartsUsed.length} artículos
            </span>
          </div>
          {analytics.topPartsUsed.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Sin repuestos consumidos en el período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-2.5">Código</th>
                    <th className="px-3 py-2.5">Descripción</th>
                    <th className="px-3 py-2.5 text-right">Cantidad</th>
                    <th className="px-3 py-2.5 text-right">En OR</th>
                    <th className="px-4 py-2.5 text-right">Costo Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {analytics.topPartsUsed.slice(0, 15).map((p) => (
                    <tr
                      key={p.key}
                      className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs font-semibold text-brand-700 dark:text-brand-300">
                        {p.part_code}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {p.description}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {p.totalQuantity} <span className="text-[10px] text-slate-400">{p.unit}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-slate-600 dark:text-slate-400">
                        {p.ordersCount}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 dark:text-white">
                        $ {formatNumber(p.totalCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
