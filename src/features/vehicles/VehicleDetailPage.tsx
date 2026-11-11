import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Pencil,
  Ban,
  RotateCcw,
  History,
  Wrench,
  ClipboardList,
  CalendarClock,
  ShieldCheck,
  QrCode,
  Disc,
  Gauge,
  DollarSign,
  AlertTriangle,
  AlertOctagon,
  Layers,
  Zap,
  Flame,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, ConfirmDialog, EmptyState, Spinner, StatCard } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { friendlyError } from '@/lib/supabase';
import { formatPatente } from '@/lib/patente';
import { STATUS_LABELS } from '@/lib/constants';
import { formatDate, formatNumber } from '@/lib/utils';
import type { AuditEntry, PreventiveInspection, VehicleStatus } from '@/types/db';
import { useSaveVehicle, useVehicle, useVehicleAudit } from './api';
import { VehicleFormModal } from './VehicleFormModal';
import { DemoBadge, StatusBadge } from './VehiclesPage';
import { VehicleQrModal } from './VehicleQrModal';
import { analyzeVehicleTires } from './tireTracking';
import {
  analyzeVehicleComponentWear,
  type WearComponentKind,
} from '@/features/reports/wearAnalytics';
import { useAllWorkOrderItems } from '@/features/history/api';
import { useVehicleWorkOrders } from '@/features/workOrders/api';
import { WorkOrderFormModal } from '@/features/workOrders/WorkOrderFormModal';
import { WorkOrderStatusBadge } from '@/features/workOrders/WorkOrdersPage';
import { formatOrderNumber, MAINTENANCE_TYPE_LABELS } from '@/lib/constants';
import { useVehicleAppointments, useVehiclePendingTasks } from '@/features/pending/api';
import { PendingFormModal, PendingStatusBadge } from '@/features/pending/PendingPage';
import { AppointmentFormModal } from '@/features/appointments/AppointmentFormModal';
import { AppointmentStatusBadge } from '@/features/appointments/AppointmentsPage';
import { getRtoStatus, getServiceKmStatus, useInspections } from '@/features/preventive/api';
import { InspectionFormModal } from '@/features/preventive/InspectionFormModal';
import { InspectionDetailModal } from '@/features/preventive/PreventivePage';

const FIELD_LABELS: Record<string, string> = {
  registro_nro: 'N° de registro',
  patente: 'Patente',
  nro_interno: 'N° interno',
  marca: 'Marca',
  modelo: 'Modelo',
  version: 'Versión',
  anio: 'Año',
  chasis: 'Chasis',
  motor: 'Motor',
  km_actual: 'Kilometraje',
  vehicle_type: 'Tipo de vehículo',
  category_id: 'Categoría',
  tire_type_size: 'Medida de cubiertas',
  tire_count: 'Cantidad de cubiertas',
  status: 'Estado',
  observaciones: 'Observaciones',
};

function fmtValue(field: string, v: unknown) {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'status') return STATUS_LABELS[v as VehicleStatus] ?? String(v);
  if (field === 'category_id') return '(categoría modificada)';
  return String(v);
}

function AuditItem({ a }: { a: AuditEntry }) {
  const who = a.user_email ?? 'Sistema';
  return (
    <li className="relative pb-5 pl-6 last:pb-0">
      <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-brand-100 dark:ring-brand-900" />
      <p className="text-sm">
        <span className="font-medium text-slate-900 dark:text-white">
          {a.action === 'INSERT' ? 'Alta de la unidad' : a.action === 'DELETE' ? 'Eliminación' : 'Modificación'}
        </span>{' '}
        <span className="text-slate-500">por {who}</span>
      </p>
      <p className="text-xs text-slate-400">{formatDate(a.created_at, true)}</p>
      {a.action === 'INSERT' && a.new_data?.import_batch_id ? (
        <p className="mt-1 text-xs text-slate-500">Importada desde Excel</p>
      ) : null}
      {a.action === 'UPDATE' && a.changed_fields && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
          {a.changed_fields
            .filter((f) => FIELD_LABELS[f])
            .map((f) => (
              <li key={f}>
                <span className="font-medium">{FIELD_LABELS[f]}:</span>{' '}
                <span className="text-slate-400 line-through">{fmtValue(f, a.old_data?.[f])}</span> →{' '}
                <span>{fmtValue(f, a.new_data?.[f])}</span>
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}

function Info({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-sm text-slate-900 dark:text-slate-100 ${mono ? 'font-mono' : ''}`}>{value || '—'}</dd>
    </div>
  );
}

export function VehicleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: v, isLoading, error } = useVehicle(id);
  const { data: audit = [], isLoading: auditLoading } = useVehicleAudit(id);
  const { data: workOrders = [] } = useVehicleWorkOrders(id);
  const { data: pendingTasks = [] } = useVehiclePendingTasks(id);
  const { data: appointments = [] } = useVehicleAppointments(id);
  const { data: inspections = [] } = useInspections(id);
  const { data: allItems = [] } = useAllWorkOrderItems();
  const save = useSaveVehicle();
  const [editOpen, setEditOpen] = useState(false);
  const [woOpen, setWoOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [apptOpen, setApptOpen] = useState(false);
  const [inspOpen, setInspOpen] = useState(false);
  const [detailInsp, setDetailInsp] = useState<PreventiveInspection | null>(null);
  const [confirm, setConfirm] = useState<'baja' | 'reactivar' | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [expandedWearKind, setExpandedWearKind] = useState<WearComponentKind | null>(null);

  const vehicleItems = useMemo(() => {
    if (!v) return [];
    return allItems.filter(
      (it) => it.work_orders?.vehicle_id === v.id || workOrders.some((wo) => wo.id === it.work_order_id),
    );
  }, [v, workOrders, allItems]);

  const totalExpense = useMemo(() => {
    const labor = workOrders.reduce((sum, wo) => sum + (Number(wo.labor_cost) || 0), 0);
    const parts = vehicleItems.reduce(
      (sum, it) => sum + (it.unit_cost != null ? Number(it.quantity) * Number(it.unit_cost) : 0),
      0,
    );
    return labor + parts;
  }, [workOrders, vehicleItems]);

  const cpk =
    v?.km_actual && v.km_actual > 0 && totalExpense > 0
      ? Number((totalExpense / v.km_actual).toFixed(2))
      : null;

  const tires = useMemo(() => analyzeVehicleTires(v?.km_actual, workOrders), [v?.km_actual, workOrders]);

  // Análisis de frecuencia de recambio y desgaste por componente para esta unidad
  const componentWear = useMemo(() => {
    if (!v) return null;
    return analyzeVehicleComponentWear(v, workOrders, vehicleItems);
  }, [v, workOrders, vehicleItems]);

  if (isLoading) return <Spinner />;
  if (error || !v)
    return (
      <EmptyState
        title="Unidad no encontrada"
        description={error ? friendlyError(error) : undefined}
        action={<Button onClick={() => navigate('/unidades')}>Volver a unidades</Button>}
      />
    );

  const changeStatus = async (status: VehicleStatus) => {
    try {
      await save.mutateAsync({ id: v.id, values: { status } });
      toast.success(`Estado actualizado: ${STATUS_LABELS[status]}`);
      setConfirm(null);
    } catch (err) {
      toast.error(friendlyError(err));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link to="/unidades" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Volver">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold text-slate-900 dark:text-white">{formatPatente(v.patente)}</h1>
              <StatusBadge status={v.status} />
              {v.is_demo && <DemoBadge />}
            </div>
            <p className="text-sm text-slate-500">
              {[v.marca, v.modelo, v.version].filter(Boolean).join(' ') || 'Sin modelo'}
              {v.nro_interno && ` · Interno ${v.nro_interno}`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('vehicles', 'edit') && v.status !== 'baja' && (
            <select
              className="input w-auto"
              value={v.status}
              onChange={(e) => void changeStatus(e.target.value as VehicleStatus)}
              disabled={save.isPending}
              title="Cambiar estado operativo"
            >
              {(['operativo', 'fuera_de_servicio', 'en_taller'] as VehicleStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="secondary"
            icon={<QrCode className="h-4 w-4 text-brand-600 dark:text-brand-400" />}
            onClick={() => setQrOpen(true)}
            title="Generar o imprimir código QR de la unidad"
          >
            Ficha QR
          </Button>
          {can('work_orders', 'create') && v.status !== 'baja' && (
            <Button icon={<Wrench className="h-4 w-4" />} onClick={() => setWoOpen(true)}>
              Nueva OR
            </Button>
          )}
          {can('vehicles', 'edit') && (
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
          )}
          {can('vehicles', 'delete') &&
            (v.status === 'baja' ? (
              <Button variant="success" icon={<RotateCcw className="h-4 w-4" />} onClick={() => setConfirm('reactivar')}>
                Reactivar
              </Button>
            ) : (
              <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setConfirm('baja')}>
                Dar de baja
              </Button>
            ))}
        </div>
      </div>

      {/* KPIs Ejecutivos de la Unidad (Inversión acumulada, Costo por Km y Odómetro) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Inversión mantenimiento"
          value={`$ ${formatNumber(totalExpense)}`}
          hint={`${workOrders.length} órdenes registradas`}
          icon={<DollarSign className="h-5 w-5" />}
          tone="brand"
        />
        <StatCard
          label="Costo por Km (CPK)"
          value={cpk != null ? `$ ${cpk.toFixed(2)}` : '—'}
          hint={v.km_actual ? `${formatNumber(v.km_actual)} km odómetro` : 'Sin odómetro'}
          icon={<Gauge className="h-5 w-5" />}
          tone={cpk == null ? 'slate' : cpk < 25 ? 'green' : cpk < 60 ? 'amber' : 'red'}
        />
        <StatCard
          label="Vencimiento RTO"
          value={v.rto_due_date ? formatDate(v.rto_due_date) : 'Sin RTO'}
          hint={v.rto_due_date ? getRtoStatus(v.rto_due_date).label : 'Cargar vencimiento'}
          icon={<ShieldCheck className="h-5 w-5" />}
          tone={
            v.rto_due_date && getRtoStatus(v.rto_due_date).code === 'vencida'
              ? 'red'
              : v.rto_due_date && getRtoStatus(v.rto_due_date).code === 'proxima'
                ? 'amber'
                : 'green'
          }
        />
        <StatCard
          label="Rotación de cubiertas"
          value={tires.kmSinceRotation != null ? `${formatNumber(tires.kmSinceRotation)} km` : 'Sin registro'}
          hint={
            tires.rotationStatus === 'overdue'
              ? 'Rotación requerida (≥15.000 km)'
              : tires.rotationStatus === 'due_soon'
                ? 'Próxima a rotar (10-15k km)'
                : tires.rotationStatus === 'ok'
                  ? 'Rodado al día'
                  : 'Registrar en OR'
          }
          icon={<Disc className="h-5 w-5" />}
          tone={
            tires.rotationStatus === 'overdue'
              ? 'red'
              : tires.rotationStatus === 'due_soon'
                ? 'amber'
                : tires.rotationStatus === 'ok'
                  ? 'green'
                  : 'slate'
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <div className="card p-5">
            <h2 className="mb-4 font-semibold">Datos del vehículo</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
              <Info label="Patente" value={v.patente} mono />
              <Info label="N° interno" value={v.nro_interno} />
              <Info label="N° de orden / registro" value={v.registro_nro} />
              <Info label="Categoría" value={v.vehicle_categories?.name} />
              <Info label="Marca" value={v.marca} />
              <Info label="Modelo" value={v.modelo} />
              <Info label="Versión" value={v.version} />
              <Info label="Año" value={v.anio} />
              <Info label="Tipo de vehículo" value={v.vehicle_type} />
              <Info label="Kilometraje actual" value={v.km_actual != null ? `${formatNumber(v.km_actual)} km` : null} />
              <Info label="N° de chasis" value={v.chasis} mono />
              <Info label="N° de motor" value={v.motor} mono />
              <Info label="Tipo y medida de cubiertas" value={v.tire_type_size} />
              <Info label="Cantidad de cubiertas" value={v.tire_count} />
              <Info label="Estado" value={STATUS_LABELS[v.status]} />
              <Info
                label="Vencimiento de RTO"
                value={
                  v.rto_due_date ? (
                    <span className="inline-flex items-center gap-1.5">
                      {formatDate(v.rto_due_date)}
                      <Badge className={getRtoStatus(v.rto_due_date).badgeClass}>{getRtoStatus(v.rto_due_date).label}</Badge>
                    </span>
                  ) : null
                }
              />
              <Info
                label="Último service preventivo"
                value={
                  v.last_service_km != null
                    ? `${formatNumber(v.last_service_km)} km${v.last_service_date ? ` (${formatDate(v.last_service_date)})` : ''}`
                    : null
                }
              />
              <Info
                label="Estado service por km"
                value={<Badge className={getServiceKmStatus(v).badgeClass}>{getServiceKmStatus(v).label}</Badge>}
              />
            </dl>
            {v.observaciones && (
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <p className="mb-1 text-xs font-medium uppercase text-slate-500">Observaciones</p>
                <p className="whitespace-pre-wrap">{v.observaciones}</p>
              </div>
            )}
            <p className="mt-4 text-xs text-slate-400">
              Alta: {formatDate(v.created_at, true)} · Última modificación: {formatDate(v.updated_at, true)}
            </p>
          </div>

          {/* Tarjeta de Control Automatizado de Neumáticos y Cubiertas */}
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                  <Disc className="h-4 w-4 text-brand-600 dark:text-brand-400" /> Control de Neumáticos y Cubiertas
                </h2>
                <p className="text-xs text-slate-500">
                  Detección automática de rotaciones, alineación y recambios a partir de las Órdenes de Reparación
                </p>
              </div>
              <Badge
                className={
                  tires.rotationStatus === 'overdue'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                    : tires.rotationStatus === 'due_soon'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                      : tires.rotationStatus === 'ok'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }
              >
                {tires.rotationStatus === 'overdue'
                  ? 'Rotación requerida'
                  : tires.rotationStatus === 'due_soon'
                    ? 'Rotación próxima'
                    : tires.rotationStatus === 'ok'
                      ? 'Cubiertas al día'
                      : 'Sin historial'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
              <div>
                <span className="text-[11px] font-medium uppercase text-slate-500">Medida instalada</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-slate-800 dark:text-slate-200">
                  {v.tire_type_size || '—'}
                </p>
                <p className="text-[11px] text-slate-400">{v.tire_count ? `${v.tire_count} cubiertas` : ''}</p>
              </div>

              <div>
                <span className="text-[11px] font-medium uppercase text-slate-500">Última rotación</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-slate-800 dark:text-slate-200">
                  {tires.lastRotationKm != null ? `${formatNumber(tires.lastRotationKm)} km` : '—'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {tires.lastRotationDate ? formatDate(tires.lastRotationDate) : 'Sin registrar'}
                </p>
              </div>

              <div>
                <span className="text-[11px] font-medium uppercase text-slate-500">Km desde rotación</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-slate-800 dark:text-slate-200">
                  {tires.kmSinceRotation != null ? `${formatNumber(tires.kmSinceRotation)} km` : '—'}
                </p>
                <p className="text-[11px] text-slate-400">Recomendado c/ 10-15k km</p>
              </div>

              <div>
                <span className="text-[11px] font-medium uppercase text-slate-500">Alineación / Balanceo</span>
                <p className="mt-0.5 font-mono text-sm font-bold text-slate-800 dark:text-slate-200">
                  {tires.lastAlignmentKm != null ? `${formatNumber(tires.lastAlignmentKm)} km` : '—'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {tires.lastAlignmentDate ? formatDate(tires.lastAlignmentDate) : 'Sin registrar'}
                </p>
              </div>
            </div>

            {tires.interventions.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Historial de gomería registrado en Órdenes de Reparación:
                </p>
                <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
                  {tires.interventions.map((item, idx) => (
                    <li
                      key={idx}
                      onClick={() => navigate(`/ordenes/${item.workOrderId}`)}
                      className="flex cursor-pointer items-center justify-between py-2 hover:text-brand-700 dark:hover:text-brand-300"
                    >
                      <div>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{item.title}</span>
                        <span className="ml-2 font-mono text-slate-500">OT #{item.orderNumber}</span>
                        <p className="text-[11px] text-slate-500">{item.description}</p>
                      </div>
                      <div className="text-right font-mono">
                        <span>{formatDate(item.date)}</span>
                        {item.kilometraje != null && <p className="text-slate-400">{formatNumber(item.kilometraje)} km</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Card: Ciclos de Vida y Frecuencia de Recambio de Componentes Clave */}
          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                  <Flame className="h-4.5 w-4.5" />
                </span>
                <div>
                  <h2 className="font-semibold text-slate-900 dark:text-white">
                    Frecuencia de Recambio y Durabilidad de Componentes
                  </h2>
                  <p className="text-xs text-slate-500">
                    Control de vida útil e intervalos de reemplazo (cubiertas, frenos, amortiguadores, batería, embrague)
                  </p>
                </div>
              </div>

              {componentWear && (
                <div className="flex items-center gap-1.5 text-xs">
                  {Object.values(componentWear).some((s) => s.status === 'critico') && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                      <ShieldAlert className="h-3 w-3" /> Desgaste Prematuro
                    </span>
                  )}
                  {Object.values(componentWear).some((s) => s.status === 'advertencia') && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" /> Atención
                    </span>
                  )}
                </div>
              )}
            </div>

            {componentWear && (
              <div className="space-y-3">
                {(
                  [
                    {
                      kind: 'cubiertas' as WearComponentKind,
                      icon: <Disc className="h-4 w-4" />,
                      color: 'text-blue-600 dark:text-blue-400',
                      bgColor: 'bg-blue-50 dark:bg-blue-950/60',
                    },
                    {
                      kind: 'frenos' as WearComponentKind,
                      icon: <AlertOctagon className="h-4 w-4" />,
                      color: 'text-amber-600 dark:text-amber-400',
                      bgColor: 'bg-amber-50 dark:bg-amber-950/60',
                    },
                    {
                      kind: 'amortiguadores' as WearComponentKind,
                      icon: <Layers className="h-4 w-4" />,
                      color: 'text-purple-600 dark:text-purple-400',
                      bgColor: 'bg-purple-50 dark:bg-purple-950/60',
                    },
                    {
                      kind: 'bateria' as WearComponentKind,
                      icon: <Zap className="h-4 w-4" />,
                      color: 'text-emerald-600 dark:text-emerald-400',
                      bgColor: 'bg-emerald-50 dark:bg-emerald-950/60',
                    },
                    {
                      kind: 'embrague' as WearComponentKind,
                      icon: <Flame className="h-4 w-4" />,
                      color: 'text-rose-600 dark:text-rose-400',
                      bgColor: 'bg-rose-50 dark:bg-rose-950/60',
                    },
                  ] as const
                ).map(({ kind, icon, color, bgColor }) => {
                  const s = componentWear[kind];
                  const isExpanded = expandedWearKind === kind;
                  const isCrit = s.status === 'critico';
                  const isWarn = s.status === 'advertencia';
                  const isNormal = s.status === 'normal';

                  return (
                    <div
                      key={kind}
                      className={`rounded-xl border transition-all ${
                        isCrit
                          ? 'border-red-200 bg-red-50/40 dark:border-red-900/40 dark:bg-red-950/20'
                          : isWarn
                            ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20'
                            : 'border-slate-200/80 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/40'
                      }`}
                    >
                      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bgColor} ${color}`}>
                            {icon}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                                {s.benchmark.label}
                              </span>
                              <Badge
                                className={
                                  isCrit
                                    ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                                    : isWarn
                                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                      : isNormal
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                }
                              >
                                {isCrit
                                  ? 'Recambios muy seguidos'
                                  : isWarn
                                    ? 'Desgaste acelerado'
                                    : isNormal
                                      ? 'Intervalo normal'
                                      : 'Sin recambios'}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-slate-500">
                              {s.replacementsCount === 0
                                ? `Vida esperada de referencia: ~${formatNumber(s.benchmark.expectedKm)} km`
                                : s.replacementsCount === 1
                                  ? `1 recambio registrado en OT · Esperado: ~${formatNumber(s.benchmark.expectedKm)} km`
                                  : `${s.replacementsCount} recambios · Promedio: ~${formatNumber(s.averageIntervalKm || 0)} km (Esperado: ~${formatNumber(s.benchmark.expectedKm)} km)`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <div className="text-right">
                            {s.lastReplacementKm != null ? (
                              <p className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                                Último a los {formatNumber(s.lastReplacementKm)} km
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400">Sin cambio en historial</p>
                            )}
                            {s.totalCost > 0 && (
                              <p className="font-mono text-[10px] text-slate-500">
                                Gasto: $ {formatNumber(s.totalCost)}
                              </p>
                            )}
                          </div>

                          {s.events.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setExpandedWearKind(isExpanded ? null : kind)}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                              title={isExpanded ? 'Ocultar OTs' : 'Ver OTs'}
                            >
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Mensaje de alerta / diagnóstico */}
                      {s.diagnosticMessage && (
                        <div
                          className={`border-t px-3 py-2 text-xs font-medium ${
                            isCrit
                              ? 'border-red-200/80 bg-red-100/40 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                              : 'border-amber-200/80 bg-amber-100/40 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          <span className="font-bold">Aviso técnico:</span> {s.diagnosticMessage}
                        </div>
                      )}

                      {/* Desglose desplegable de OTs del componente */}
                      {isExpanded && s.events.length > 0 && (
                        <div className="border-t border-slate-200/80 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-900/80">
                          <p className="mb-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            Órdenes de Reparación con recambio de {s.benchmark.label.toLowerCase()}:
                          </p>
                          <div className="space-y-1.5 text-xs">
                            {s.events.map((ev, eIdx) => (
                              <div
                                key={eIdx}
                                onClick={() => navigate(`/ordenes/${ev.workOrderId}`)}
                                className="flex cursor-pointer flex-col gap-1 rounded-lg border border-slate-100 bg-white p-2 transition hover:border-brand-300 dark:border-slate-800 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-brand-700 dark:text-brand-300">
                                      OT #{ev.orderNumber}
                                    </span>
                                    <span className="text-[11px] text-slate-400">· {formatDate(ev.date)}</span>
                                    {ev.isPremature && (
                                      <span className="rounded bg-red-100 px-1.5 py-0.2 font-mono text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                                        Prematuro
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                                    {ev.detail}
                                  </p>
                                </div>
                                <div className="text-right">
                                  {ev.kilometraje != null ? (
                                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                      {formatNumber(ev.kilometraje)} km
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">Sin km</span>
                                  )}
                                  {ev.kmSincePrevious != null && (
                                    <p className="text-[10px] text-slate-500">
                                      +{formatNumber(ev.kmSincePrevious)} km desde el anterior
                                    </p>
                                  )}
                                  {ev.cost > 0 && (
                                    <p className="font-mono text-[10px] font-bold text-slate-700 dark:text-slate-300">
                                      $ {formatNumber(ev.cost)}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <Wrench className="h-4 w-4" /> Órdenes de reparación ({workOrders.length})
              </h2>
              {can('work_orders', 'create') && v.status !== 'baja' && (
                <Button size="sm" variant="secondary" onClick={() => setWoOpen(true)}>
                  Nueva OR
                </Button>
              )}
            </div>
            {workOrders.length ? (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {workOrders.map((wo) => (
                  <li
                    key={wo.id}
                    onClick={() => navigate(`/ordenes/${wo.id}`)}
                    className="flex cursor-pointer items-center justify-between py-2.5 hover:text-brand-700"
                  >
                    <div>
                      <span className="font-mono font-bold text-brand-700 dark:text-brand-300">
                        {formatOrderNumber(wo.order_number)}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {formatDate(wo.opened_at)} · {MAINTENANCE_TYPE_LABELS[wo.maintenance_type]}
                      </span>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        {wo.failure_description || wo.requested_work || wo.work_performed || 'Sin detalle'}
                      </p>
                    </div>
                    <WorkOrderStatusBadge status={wo.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Esta unidad no registra órdenes de reparación.</p>
            )}
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <ClipboardList className="h-4 w-4" /> Pendientes actuales y solucionados ({pendingTasks.length})
              </h2>
              {(can('pending', 'create') || can('pending', 'edit')) && v.status !== 'baja' && (
                <Button size="sm" variant="secondary" onClick={() => setPendingOpen(true)}>
                  Nuevo pendiente
                </Button>
              )}
            </div>
            {pendingTasks.length ? (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {pendingTasks.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">{p.task_title}</p>
                      <p className="text-xs text-slate-500">
                        Detectado: {formatDate(p.detected_at)}
                        {p.provider_name ? ` · Taller: ${p.provider_name}` : ''}
                        {p.appointment_date ? ` · Turno: ${formatDate(p.appointment_date)}` : ''}
                      </p>
                    </div>
                    <PendingStatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Esta unidad no registra trabajos pendientes.</p>
            )}
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <CalendarClock className="h-4 w-4" /> Turnos con proveedores ({appointments.length})
              </h2>
              {(can('appointments', 'create') || can('appointments', 'edit')) && v.status !== 'baja' && (
                <Button size="sm" variant="secondary" onClick={() => setApptOpen(true)}>
                  Agendar turno
                </Button>
              )}
            </div>
            {appointments.length ? (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {appointments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">
                        {formatDate(a.appointment_date)} {a.appointment_time ?? ''} · {a.reason}
                      </p>
                      <p className="text-xs text-slate-500">Taller: {a.provider_name}</p>
                    </div>
                    <AppointmentStatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Sin turnos registrados para esta unidad.</p>
            )}
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4" /> Inspecciones previas a RTO ({inspections.length})
              </h2>
              {(can('preventive', 'create') || can('preventive', 'edit')) && v.status !== 'baja' && (
                <Button size="sm" variant="secondary" onClick={() => setInspOpen(true)}>
                  Nueva inspección RTO
                </Button>
              )}
            </div>
            {inspections.length ? (
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {inspections.map((insp) => (
                  <li
                    key={insp.id}
                    onClick={() => setDetailInsp(insp)}
                    className="flex cursor-pointer items-center justify-between py-2.5 hover:text-brand-700"
                  >
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">
                        Control del {formatDate(insp.inspected_at)}
                        {insp.kilometraje != null ? ` · ${formatNumber(insp.kilometraje)} km` : ''}
                      </p>
                      <p className="text-xs text-slate-500">
                        Responsable: {insp.inspector_name || '—'}
                        {insp.generated_pending_count > 0
                          ? ` · ${insp.generated_pending_count} pendiente(s) generado(s)`
                          : ''}
                      </p>
                    </div>
                    <Badge
                      className={
                        insp.overall_ready_for_rto
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                      }
                    >
                      {insp.overall_ready_for_rto ? 'Apta para RTO' : 'Requiere trabajos'}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Sin inspecciones previas a RTO registradas.</p>
            )}
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <History className="h-4 w-4 text-brand-700 dark:text-brand-300" /> Historial completo, repuestos, costos y archivos
              </h2>
              <p className="text-xs text-slate-500">
                Consulte repuestos colocados, cambios de cubiertas/frenos/suspensión/parabrisas, gastos acumulados, fotos y descargue la Ficha Histórica en PDF.
              </p>
            </div>
            <Button variant="secondary" icon={<History className="h-4 w-4" />} onClick={() => navigate(`/historial?vehicleId=${v.id}`)}>
              Abrir historial integral
            </Button>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 flex items-center gap-2 font-semibold">
            <History className="h-4 w-4" /> Registro de cambios
          </h2>
          {auditLoading ? (
            <Spinner />
          ) : audit.length ? (
            <ul className="border-l border-slate-200 pl-0 dark:border-slate-700 [&>li]:-ml-[5px]">
              {audit.map((a) => (
                <AuditItem key={a.id} a={a} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Sin registros de auditoría.</p>
          )}
        </div>
      </div>

      <VehicleFormModal open={editOpen} onClose={() => setEditOpen(false)} vehicle={v} />
      <WorkOrderFormModal
        open={woOpen}
        onClose={() => setWoOpen(false)}
        defaultVehicle={v}
        onSaved={(wo) => navigate(`/ordenes/${wo.id}`)}
      />
      <PendingFormModal open={pendingOpen} onClose={() => setPendingOpen(false)} defaultVehicleId={v.id} />
      <AppointmentFormModal open={apptOpen} onClose={() => setApptOpen(false)} defaultVehicleId={v.id} />
      <InspectionFormModal open={inspOpen} onClose={() => setInspOpen(false)} vehicles={[v]} defaultVehicleId={v.id} />
      <InspectionDetailModal inspection={detailInsp} onClose={() => setDetailInsp(null)} />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        loading={save.isPending}
        danger={confirm === 'baja'}
        title={confirm === 'baja' ? 'Dar de baja la unidad' : 'Reactivar la unidad'}
        confirmLabel={confirm === 'baja' ? 'Dar de baja' : 'Reactivar'}
        message={
          confirm === 'baja' ? (
            <>
              La unidad <b>{v.patente}</b> dejará de figurar en la flota activa. <b>No se elimina</b>: su información e historial se
              conservan y puede reactivarse en cualquier momento.
            </>
          ) : (
            <>La unidad <b>{v.patente}</b> volverá a la flota con estado <b>Operativo</b>.</>
          )
        }
        onConfirm={() => void changeStatus(confirm === 'baja' ? 'baja' : 'operativo')}
      />
      <VehicleQrModal open={qrOpen} onClose={() => setQrOpen(false)} vehicle={v} />
    </div>
  );
}
