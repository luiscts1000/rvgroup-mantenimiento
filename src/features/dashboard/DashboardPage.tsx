import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck,
  CheckCircle2,
  XCircle,
  Wrench,
  ClipboardList,
  CalendarClock,
  ShieldCheck,
  Package,
  AlertTriangle,
  Plus,
  Upload,
  BarChart3,
  History,
  Clock,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, EmptyState, PageHeader, Spinner, StatCard } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { STATUS_LABELS } from '@/lib/constants';
import { formatDate, formatNumber } from '@/lib/utils';
import { useFleetStats, useVehicles } from '@/features/vehicles/api';
import { DemoBadge, StatusBadge } from '@/features/vehicles/VehiclesPage';
import { formatPatente } from '@/lib/patente';
import { DailyServiceDispatchSplash } from './DailyServiceDispatchSplash';

const STATUS_CHART_COLORS: Record<string, string> = {
  operativo: '#10b981',
  en_taller: '#f59e0b',
  fuera_de_servicio: '#ef4444',
};

const CATEGORY_CHART_COLORS = [
  '#14559b',
  '#0f4c5c',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#0284c7',
  '#f97316',
  '#06b6d4',
  '#64748b',
];

function DashboardTooltip({
  active,
  payload,
  label,
  valueSuffix = 'unidades',
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string; fill?: string }>;
  label?: string;
  valueSuffix?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  return (
    <div className="z-50 min-w-[170px] rounded-xl border border-slate-700/80 bg-slate-900/95 p-2.5 text-xs text-slate-100 shadow-2xl backdrop-blur-md">
      {label && <div className="mb-1 border-b border-slate-800 pb-1 font-semibold text-slate-200">{label}</div>}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color || item.fill }} />
          <span className="text-slate-300">{item.name}:</span>
        </div>
        <span className="font-mono font-bold text-white">
          {item.value} {valueSuffix}
        </span>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: stats, isLoading } = useFleetStats();
  const { data: vehicles = [] } = useVehicles();

  // Primer pantallazo de guardia de servicios (se muestra al abrir sesión y se oculta al pulsar 'Continuar')
  const [showDispatchSplash, setShowDispatchSplash] = useState<boolean>(() => {
    return !sessionStorage.getItem('rv_daily_dispatch_seen');
  });

  const handleDismissDispatch = () => {
    sessionStorage.setItem('rv_daily_dispatch_seen', 'true');
    setShowDispatchSplash(false);
  };

  if (isLoading) return <Spinner />;

  // Si aún no se pulsó "Continuar", mostrar el Primer Pantallazo de Unidades Próximas a Servicios
  if (showDispatchSplash) {
    return <DailyServiceDispatchSplash onContinue={handleDismissDispatch} />;
  }

  const s = stats ?? {
    total: 0,
    operativo: 0,
    fuera_de_servicio: 0,
    en_taller: 0,
    baja: 0,
    demo: 0,
    wo_open: 0,
    wo_finished: 0,
    wo_pending_approval: 0,
    parts_total: 0,
    parts_low_stock: 0,
    pending_open: 0,
    pending_urgent: 0,
    appointments_upcoming: 0,
    rto_due_soon: 0,
    rto_expired: 0,
    maintenance_alerts: 0,
    by_category: [],
    by_type: [],
  };

  const pieData = [
    { name: STATUS_LABELS.operativo, value: s.operativo, key: 'operativo' },
    { name: STATUS_LABELS.en_taller, value: s.en_taller, key: 'en_taller' },
    { name: STATUS_LABELS.fuera_de_servicio, value: s.fuera_de_servicio, key: 'fuera_de_servicio' },
  ].filter((d) => d.value > 0);

  const recent = [...vehicles]
    .filter((v) => v.status !== 'baja')
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, 8);

  const attention = vehicles.filter((v) => v.status === 'fuera_de_servicio' || v.status === 'en_taller');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Panel de control"
        subtitle="Situación actual de la flota registrada en el sistema"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Clock className="h-4 w-4" />}
              onClick={() => setShowDispatchSplash(true)}
              title="Abrir primer pantallazo de guardia de servicios"
            >
              Guardia de Servicios
            </Button>
            {can('vehicles', 'create') && (
              <>
                <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => navigate('/unidades/importar')}>
                  Importar Excel
                </Button>
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/unidades')}>
                  Gestionar unidades
                </Button>
              </>
            )}
          </>
        }
      />

      {s.demo > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-fuchsia-300 bg-fuchsia-50 px-4 py-3 text-sm text-fuchsia-900 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-200">
          <span>
            Hay <b>{s.demo}</b> unidades marcadas como <b>DEMO</b> (datos ficticios de prueba). Pueden eliminarse en un clic desde{' '}
            <b>Configuración</b>.
          </span>
          {can('settings', 'view') && (
            <Button size="sm" variant="secondary" onClick={() => navigate('/configuracion')}>
              Ir a Configuración
            </Button>
          )}
        </div>
      )}

      {/* Indicadores reales (Flota + Órdenes de Reparación) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total de vehículos"
          value={formatNumber(s.total)}
          hint={s.baja ? `+ ${s.baja} dados de baja` : 'Flota activa'}
          icon={<Truck className="h-5 w-5" />}
          tone="brand"
          onClick={() => navigate('/unidades')}
        />
        <StatCard
          label="Vehículos operativos"
          value={formatNumber(s.operativo)}
          hint={s.total ? `${Math.round((s.operativo / s.total) * 100)}% de la flota` : undefined}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
          onClick={() => navigate('/unidades')}
        />
        <StatCard
          label="Actualmente en taller"
          value={formatNumber(s.en_taller)}
          icon={<Wrench className="h-5 w-5" />}
          tone="amber"
          onClick={() => navigate('/unidades')}
        />
        <StatCard
          label="Fuera de servicio"
          value={formatNumber(s.fuera_de_servicio)}
          icon={<XCircle className="h-5 w-5" />}
          tone="red"
          onClick={() => navigate('/unidades')}
        />
        <StatCard
          label="Órdenes de reparación abiertas"
          value={formatNumber(s.wo_open)}
          hint={s.wo_pending_approval ? `${s.wo_pending_approval} pendientes de cierre/autorización` : 'En curso'}
          icon={<Wrench className="h-5 w-5" />}
          tone="amber"
          onClick={() => navigate('/ordenes')}
        />
        <StatCard
          label="Órdenes finalizadas / cerradas"
          value={formatNumber(s.wo_finished)}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
          onClick={() => navigate('/ordenes')}
        />
        <StatCard
          label="Repuestos con stock bajo"
          value={formatNumber(s.parts_low_stock)}
          hint={`${formatNumber(s.parts_total)} repuestos en inventario`}
          icon={<Package className="h-5 w-5" />}
          tone={s.parts_low_stock > 0 ? 'red' : 'green'}
          onClick={() => navigate('/inventario')}
        />
        <StatCard
          label="Trabajos pendientes"
          value={formatNumber(s.pending_open)}
          hint={s.pending_urgent ? `${s.pending_urgent} de prioridad alta/urgente` : 'En gestión'}
          icon={<ClipboardList className="h-5 w-5" />}
          tone={s.pending_urgent > 0 ? 'red' : 'amber'}
          onClick={() => navigate('/pendientes')}
        />
        <StatCard
          label="Turnos próximos"
          value={formatNumber(s.appointments_upcoming)}
          hint="Proveedores y talleres externos"
          icon={<CalendarClock className="h-5 w-5" />}
          tone="brand"
          onClick={() => navigate('/turnos')}
        />
        <StatCard
          label="Unidades próximas a RTO"
          value={formatNumber(s.rto_due_soon)}
          hint={s.rto_expired ? `${s.rto_expired} con RTO vencida` : 'Vencimiento ≤ 30 días'}
          icon={<ShieldCheck className="h-5 w-5" />}
          tone={s.rto_expired > 0 ? 'red' : s.rto_due_soon > 0 ? 'amber' : 'green'}
          onClick={() => navigate('/preventivo')}
        />
        <StatCard
          label="Alertas de mantenimiento"
          value={formatNumber(s.maintenance_alerts)}
          hint="RTO, pre-RTO y service por km"
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={s.maintenance_alerts > 0 ? 'red' : 'green'}
          onClick={() => navigate('/preventivo')}
        />
      </div>

      {/* Gráficos de flota */}
      {s.total > 0 ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">Unidades por categoría</h2>
                <p className="text-xs text-slate-500">Distribución de flota según tipo y rubro vehicular</p>
              </div>
              <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                {s.by_category.length} categorías
              </span>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.by_category} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
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
                    dataKey="name"
                    width={180}
                    tick={{ fill: '#334155', fontSize: 11, fontWeight: 500 }}
                    tickLine={false}
                    axisLine={{ stroke: '#cbd5e1', strokeOpacity: 0.4 }}
                  />
                  <Tooltip content={<DashboardTooltip valueSuffix="unidades" />} />
                  <Bar dataKey="count" name="Unidades" radius={[0, 6, 6, 0]}>
                    {s.by_category.map((_, idx) => (
                      <Cell
                        key={`cat-cell-${idx}`}
                        fill={CATEGORY_CHART_COLORS[idx % CATEGORY_CHART_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900 dark:text-white">Estado operativo</h2>
                <p className="text-xs text-slate-500">Disponibilidad en tiempo real</p>
              </div>
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {s.total > 0 ? `${Math.round((s.operativo / s.total) * 100)}% disp.` : ''}
              </span>
            </div>

            <div className="relative flex h-52 items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    cornerRadius={5}
                  >
                    {pieData.map((d) => (
                      <Cell key={d.key} fill={STATUS_CHART_COLORS[d.key]} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<DashboardTooltip valueSuffix="unidades" />} />
                </PieChart>
              </ResponsiveContainer>
              {/* Centro del Donut */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Total</span>
                <span className="text-xl font-bold font-mono text-slate-900 dark:text-white">{s.total}</span>
                <span className="text-[10px] text-slate-400">unidades</span>
              </div>
            </div>

            <div className="mt-2 space-y-1.5 text-xs">
              {pieData.map((d) => {
                const pct = s.total > 0 ? Math.round((d.value / s.total) * 100) : 0;
                return (
                  <div
                    key={d.key}
                    className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  >
                    <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                      <span className="h-2 w-2 rounded-full" style={{ background: STATUS_CHART_COLORS[d.key] }} />
                      {d.name}
                    </span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">
                      {d.value} <span className="font-normal text-slate-400">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <EmptyState
            title="La flota aún no tiene unidades cargadas"
            description="Importe la planilla Excel de la flota o cargue unidades manualmente para activar los indicadores."
            action={
              can('vehicles', 'create') && (
                <Button icon={<Upload className="h-4 w-4" />} onClick={() => navigate('/unidades/importar')}>
                  Importar flota desde Excel
                </Button>
              )
            }
          />
        </div>
      )}

      {/* Unidades en taller / fuera de servicio y últimas actualizadas */}
      {s.total > 0 && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="card p-5">
            <h2 className="mb-3 font-semibold">Unidades que requieren atención ({attention.length})</h2>
            {attention.length ? (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {attention.slice(0, 8).map((v) => (
                  <li
                    key={v.id}
                    onClick={() => navigate(`/unidades/${v.id}`)}
                    className="flex cursor-pointer items-center justify-between py-2.5 hover:text-brand-700"
                  >
                    <div>
                      <span className="font-mono font-semibold">{formatPatente(v.patente)}</span>
                      {v.nro_interno && <span className="ml-2 text-slate-500">Int. {v.nro_interno}</span>}
                      <p className="text-xs text-slate-500">{[v.marca, v.modelo, v.version].filter(Boolean).join(' ')}</p>
                    </div>
                    <StatusBadge status={v.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-slate-500">Todas las unidades activas están operativas.</p>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-3 font-semibold">Últimas unidades registradas o actualizadas</h2>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {recent.map((v) => (
                <li
                  key={v.id}
                  onClick={() => navigate(`/unidades/${v.id}`)}
                  className="flex cursor-pointer items-center justify-between py-2.5 hover:text-brand-700"
                >
                  <div>
                    <span className="font-mono font-semibold">{formatPatente(v.patente)}</span>
                    {v.is_demo && <span className="ml-2"><DemoBadge /></span>}
                    <p className="text-xs text-slate-500">
                      {[v.marca, v.modelo, v.version].filter(Boolean).join(' ') || v.vehicle_categories?.name || '—'}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400">{formatDate(v.updated_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Accesos rápidos a Historial y Estadísticas */}
      <div className="card flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center">
        <div>
          <h2 className="font-semibold">Historial integral por unidad, estadísticas y reportes ejecutivos</h2>
          <p className="text-xs text-slate-500">
            Consulte rankings de ingresos al taller, unidades con más fallas, fallas frecuentes, gastos por unidad y mensuales, repuestos más usados y exporte informes en PDF o Excel.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('history', 'view') && (
            <Button variant="secondary" icon={<History className="h-4 w-4" />} onClick={() => navigate('/historial')}>
              Historial por unidad
            </Button>
          )}
          {can('reports', 'view') && (
            <Button icon={<BarChart3 className="h-4 w-4" />} onClick={() => navigate('/reportes')}>
              Estadísticas y reportes
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
