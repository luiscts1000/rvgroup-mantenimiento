import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Download,
  Search,
  FilterX,
  Eye,
  Pencil,
  Wrench,
  CheckCircle2,
  Clock,
  UserCheck,
  Droplets,
  Disc,
  Activity,
  CircleDot,
  Cog,
  Zap,
  ShieldCheck,
  Layers,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  FileDown,
  ClipboardCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, EmptyState, PageHeader, Spinner, StatCard } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAllWorkOrderItems, type EnrichedWorkOrderItem } from '@/features/history/api';
import { useVehicles } from '@/features/vehicles/api';
import { friendlyError, supabase } from '@/lib/supabase';
import {
  formatOrderNumber,
  MAINTENANCE_TYPE_LABELS,
  WO_STATUS_COLORS,
  WO_STATUS_DOT,
  WO_STATUS_LABELS,
} from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber, slug } from '@/lib/utils';
import type { MaintenanceType, WorkOrder, WorkOrderStatus } from '@/types/db';
import { useMechanics, useSaveWorkOrder, useWorkOrders } from './api';
import { WorkOrderFormModal } from './WorkOrderFormModal';
import { exportWorkOrdersToExcel } from './exportWorkOrders';
import { generateWorkOrderPdf } from './generateWorkOrderPdf';

export type WorkOrderRubric =
  | 'service'
  | 'frenos'
  | 'amortiguadores'
  | 'cubiertas'
  | 'correas_motor'
  | 'electricidad_aa'
  | 'carroceria_rto';

export interface RubricMeta {
  id: WorkOrderRubric;
  label: string;
  shortLabel: string;
  badgeClass: string;
  activeChipClass: string;
}

export const WORK_ORDER_RUBRICS: RubricMeta[] = [
  {
    id: 'service',
    label: 'Services (Aceite y Filtros)',
    shortLabel: 'Service / Filtros',
    badgeClass: 'bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
    activeChipClass: 'bg-brand-600 text-white border-brand-600 shadow-sm',
  },
  {
    id: 'frenos',
    label: 'Cambio de Pastillas / Discos / Cintas',
    shortLabel: 'Pastillas / Frenos',
    badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    activeChipClass: 'bg-red-600 text-white border-red-600 shadow-sm',
  },
  {
    id: 'amortiguadores',
    label: 'Amortiguadores y Suspensión',
    shortLabel: 'Amortiguadores',
    badgeClass: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
    activeChipClass: 'bg-amber-600 text-white border-amber-600 shadow-sm',
  },
  {
    id: 'cubiertas',
    label: 'Cubiertas y Neumáticos',
    shortLabel: 'Cubiertas',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    activeChipClass: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
  },
  {
    id: 'correas_motor',
    label: 'Correas, Motor y Fluidos',
    shortLabel: 'Correas / Motor',
    badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
    activeChipClass: 'bg-purple-600 text-white border-purple-600 shadow-sm',
  },
  {
    id: 'electricidad_aa',
    label: 'Electricidad, Batería y A.A.',
    shortLabel: 'Electricidad / A.A.',
    badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
    activeChipClass: 'bg-sky-600 text-white border-sky-600 shadow-sm',
  },
  {
    id: 'carroceria_rto',
    label: 'Parabrisas, Carrocería y RTO',
    shortLabel: 'Parabrisas / RTO',
    badgeClass: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
    activeChipClass: 'bg-teal-600 text-white border-teal-600 shadow-sm',
  },
];

export function classifyWorkOrderRubrics(
  o: WorkOrder,
  items: EnrichedWorkOrderItem[],
): WorkOrderRubric[] {
  const found = new Set<WorkOrderRubric>();

  const text = slug(
    [
      o.failure_description,
      o.requested_work,
      o.diagnosis,
      o.work_performed,
      o.oil_type,
      o.other_fluids,
      o.labor_detail,
      o.observations,
      ...items.map((it) => `${it.description} ${it.part_code ?? ''}`),
    ]
      .filter(Boolean)
      .join(' '),
  );

  // 1. Service (Aceite y Filtros)
  if (
    Boolean(o.service_type_id) ||
    Boolean(o.oil_type && o.oil_type.trim()) ||
    /\b(service|servi|cambio de aceite|filtro de aceite|filtro de aire|filtro de combustible|filtro de habitaculo|lubricacion)\b/.test(
      text,
    ) ||
    items.some(
      (it) =>
        it.parts?.category === 'filtros' ||
        it.parts?.category === 'aceites' ||
        it.parts?.category === 'lubricantes',
    )
  ) {
    found.add('service');
  }

  // 2. Cambio de Pastillas / Discos / Cintas (Frenos)
  if (
    /\b(pastilla|pastillas|freno|frenos|disco|discos|cinta|cintas|campana|caliper|bomba de freno|liquido de freno)\b/.test(
      text,
    ) ||
    items.some((it) => it.parts?.category === 'frenos')
  ) {
    found.add('frenos');
  }

  // 3. Amortiguadores y Suspensión
  if (
    /\b(amortiguador|amortiguadores|suspension|tren delantero|rotula|extremo|buje|bujes|espiral|elastico|parrilla|barra estabilizadora|cazoleta|ruleman|rodamiento)\b/.test(
      text,
    ) ||
    items.some((it) => it.parts?.category === 'suspension')
  ) {
    found.add('amortiguadores');
  }

  // 4. Cubiertas y Neumáticos
  if (
    /\b(cubierta|cubiertas|neumatico|neumaticos|llanta|alineacion|balanceo|rotacion|gomeria|auxilio)\b/.test(
      text,
    ) ||
    items.some((it) => it.parts?.category === 'cubiertas')
  ) {
    found.add('cubiertas');
  }

  // 5. Correas, Motor y Fluidos
  if (
    /\b(correa|correas|distribucion|tensor|poli v|poliv|motor|embrague|radiador|refrigerante|bomba de agua|inyector|turbo|caja|diferencial|transmision|fluido|fluidos|hidraulico)\b/.test(
      text,
    ) ||
    items.some(
      (it) => it.parts?.category === 'repuestos_motor' || it.parts?.category === 'liquidos',
    )
  ) {
    found.add('correas_motor');
  }

  // 6. Electricidad, Batería y A.A.
  if (
    /\b(bateria|alternador|arranque|burro|luces|lampara|foco|optica|faro|fusible|aire acondicionado|compresor|calefaccion|electrica|electrico|electricidad|sensor)\b/.test(
      text,
    ) ||
    items.some(
      (it) =>
        it.parts?.category === 'electricidad' ||
        it.parts?.category === 'baterias' ||
        it.parts?.category === 'aire_acondicionado',
    )
  ) {
    found.add('electricidad_aa');
  }

  // 7. Parabrisas, Carrocería y RTO
  if (
    o.maintenance_type === 'rto' ||
    /\b(parabrisas|luneta|cristal|vidrio|espejo|rto|cinturon|matafuego|baliza|botiquin|chapa|pintura|paragolpe|puerta|cerradura|limpiaparabrisas|escobilla)\b/.test(
      text,
    )
  ) {
    found.add('carroceria_rto');
  }

  return Array.from(found);
}

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return (
    <Badge className={WO_STATUS_COLORS[status]} dot={WO_STATUS_DOT[status]}>
      {WO_STATUS_LABELS[status]}
    </Badge>
  );
}

export function WorkOrdersPage() {
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const { data: orders = [], isLoading, error } = useWorkOrders();
  const { data: allItems = [] } = useAllWorkOrderItems();
  const { data: vehicles = [] } = useVehicles();
  const { data: mechanics = [] } = useMechanics();
  const save = useSaveWorkOrder();

  const isMechanicOnly = profile?.role === 'mecanico';

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'activas' | 'todas' | WorkOrderStatus>(() =>
    profile?.role === 'mecanico' ? 'activas' : 'todas',
  );
  const [typeFilter, setTypeFilter] = useState<'' | MaintenanceType>('');
  const [rubricFilter, setRubricFilter] = useState<'all' | WorkOrderRubric>('all');
  const [mechanicFilter, setMechanicFilter] = useState<string>(() =>
    profile?.role === 'mecanico' ? profile.id : '',
  );
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const vehicleMap = useMemo(() => {
    const m = new Map(vehicles.map((v) => [v.id, v]));
    return m;
  }, [vehicles]);

  const handleQuickPdf = async (o: WorkOrder) => {
    setBusyOrderId(o.id);
    try {
      const orderItems = itemsByOrderId.get(o.id) ?? [];
      await generateWorkOrderPdf(o, vehicleMap.get(o.vehicle_id), orderItems);
      toast.success(`PDF ${formatOrderNumber(o.order_number)} descargado`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleCloseAndDownload = async (o: WorkOrder) => {
    setBusyOrderId(o.id);
    try {
      const updated = await save.mutateAsync({ id: o.id, values: { status: 'cerrada' } });
      if (can('vehicles', 'edit')) {
        await supabase.from('vehicles').update({ status: 'operativo' }).eq('id', o.vehicle_id);
      }
      const orderItems = itemsByOrderId.get(o.id) ?? [];
      await generateWorkOrderPdf(updated, vehicleMap.get(o.vehicle_id), orderItems);
      toast.success(
        `${formatOrderNumber(o.order_number)} cerrada y PDF F02-PGV-02 descargado`,
      );
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusyOrderId(null);
    }
  };

  const itemsByOrderId = useMemo(() => {
    const map = new Map<string, EnrichedWorkOrderItem[]>();
    for (const item of allItems) {
      const list = map.get(item.work_order_id) ?? [];
      list.push(item);
      map.set(item.work_order_id, list);
    }
    return map;
  }, [allItems]);

  const rubricsByOrderId = useMemo(() => {
    const map = new Map<string, WorkOrderRubric[]>();
    for (const o of orders) {
      map.set(o.id, classifyWorkOrderRubrics(o, itemsByOrderId.get(o.id) ?? []));
    }
    return map;
  }, [orders, itemsByOrderId]);

  const counts = useMemo(() => {
    const open = orders.filter((o) => o.status !== 'finalizada' && o.status !== 'cerrada').length;
    const inProcess = orders.filter((o) => o.status === 'en_proceso' || o.status === 'asignada').length;
    const completedByMechanic = orders.filter((o) => o.status === 'finalizada').length;
    const closed = orders.filter((o) => o.status === 'cerrada').length;
    return { open, inProcess, completedByMechanic, closed };
  }, [orders]);

  const rubricCounts = useMemo(() => {
    const countsMap: Record<WorkOrderRubric, number> = {
      service: 0,
      frenos: 0,
      amortiguadores: 0,
      cubiertas: 0,
      correas_motor: 0,
      electricidad_aa: 0,
      carroceria_rto: 0,
    };
    for (const o of orders) {
      const rList = rubricsByOrderId.get(o.id) ?? [];
      for (const r of rList) {
        countsMap[r]++;
      }
    }
    return countsMap;
  }, [orders, rubricsByOrderId]);

  const filtered = useMemo(() => {
    const term = slug(q);
    return orders
      .filter((o) => {
        if (statusFilter === 'activas' && o.status === 'cerrada') return false;
        if (statusFilter !== 'activas' && statusFilter !== 'todas' && o.status !== statusFilter)
          return false;
        if (typeFilter && o.maintenance_type !== typeFilter) return false;
        if (rubricFilter !== 'all') {
          const rList = rubricsByOrderId.get(o.id) ?? [];
          if (!rList.includes(rubricFilter)) return false;
        }
        if (mechanicFilter) {
          if (mechanicFilter === '__unassigned' && (o.mechanic_id || o.mechanic_name)) return false;
          if (mechanicFilter !== '__unassigned' && o.mechanic_id !== mechanicFilter) return false;
        }
        if (term) {
          const orderItems = itemsByOrderId.get(o.id) ?? [];
          const hay = slug(
            [
              formatOrderNumber(o.order_number),
              o.order_number,
              o.patente,
              o.nro_interno,
              o.marca_modelo,
              o.mechanic_name,
              o.requester_name,
              o.failure_description,
              o.requested_work,
              o.diagnosis,
              o.work_performed,
              o.oil_type,
              ...orderItems.map((it) => it.description),
            ].join(' '),
          );
          if (!hay.includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const mult = sortDir === 'desc' ? -1 : 1;
        return (a.order_number - b.order_number) * mult;
      });
  }, [orders, q, statusFilter, typeFilter, rubricFilter, mechanicFilter, rubricsByOrderId, itemsByOrderId, sortDir]);

  const hasFilters =
    q || statusFilter !== 'todas' || typeFilter || rubricFilter !== 'all' || mechanicFilter;
  const resetFilters = () => {
    setQ('');
    setStatusFilter('todas');
    setTypeFilter('');
    setRubricFilter('all');
    setMechanicFilter('');
  };

  const renderRubricIcon = (id: WorkOrderRubric) => {
    switch (id) {
      case 'service':
        return <Droplets className="h-3.5 w-3.5" />;
      case 'frenos':
        return <Disc className="h-3.5 w-3.5" />;
      case 'amortiguadores':
        return <Activity className="h-3.5 w-3.5" />;
      case 'cubiertas':
        return <CircleDot className="h-3.5 w-3.5" />;
      case 'correas_motor':
        return <Cog className="h-3.5 w-3.5" />;
      case 'electricidad_aa':
        return <Zap className="h-3.5 w-3.5" />;
      case 'carroceria_rto':
        return <ShieldCheck className="h-3.5 w-3.5" />;
    }
  };

  const canApproveClose = can('work_orders', 'create') || profile?.role === 'admin';

  return (
    <div className="space-y-5">
      <PageHeader
        title={isMechanicOnly ? 'Mis Hojas de Trabajo (OT)' : 'Órdenes de Trabajo / Reparación (OT)'}
        subtitle={
          isMechanicOnly
            ? 'Seleccione la unidad asignada desde su teléfono para cargar los kilómetros actuales, trabajos extras, repuestos utilizados, observaciones y marcar como Completado.'
            : `${formatNumber(filtered.length)} de ${formatNumber(orders.length)} órdenes registradas · Formato oficial F02-PGV-02 rev0`
        }
        actions={
          <>
            {profile?.role === 'mecanico' && (
              <Button
                variant={mechanicFilter === profile.id ? 'primary' : 'secondary'}
                icon={<UserCheck className="h-4 w-4" />}
                onClick={() => setMechanicFilter(mechanicFilter === profile.id ? '' : profile.id)}
              >
                {mechanicFilter === profile.id ? 'Viendo mis asignadas' : 'Ver todas las del taller'}
              </Button>
            )}
            {!isMechanicOnly && can('work_orders', 'export') && (
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                disabled={!filtered.length}
                onClick={() => exportWorkOrdersToExcel(filtered)}
              >
                Exportar Excel
              </Button>
            )}
            {!isMechanicOnly && (can('work_orders', 'create') || can('work_orders', 'edit')) && (
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Asignar Nueva Orden (OT)
              </Button>
            )}
          </>
        }
      />

      {/* Resumen rápido por estado */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="En taller / Activas"
          value={counts.open}
          icon={<Wrench className="h-5 w-5" />}
          tone="brand"
          onClick={() => setStatusFilter(statusFilter === 'activas' ? 'todas' : 'activas')}
        />
        <StatCard
          label="Asignadas / En proceso"
          value={counts.inProcess}
          icon={<Clock className="h-5 w-5" />}
          tone="amber"
          onClick={() => setStatusFilter(statusFilter === 'en_proceso' ? 'todas' : 'en_proceso')}
        />
        <StatCard
          label="Completadas por Mecánico (P/ Cerrar)"
          value={counts.completedByMechanic}
          hint="Listas con Km y partes p/ cerrar OR"
          icon={<ClipboardCheck className="h-5 w-5" />}
          tone={counts.completedByMechanic > 0 ? 'green' : 'slate'}
          onClick={() => setStatusFilter(statusFilter === 'finalizada' ? 'todas' : 'finalizada')}
        />
        <StatCard
          label="Cerradas / OT Archivadas"
          value={counts.closed}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
          onClick={() => setStatusFilter(statusFilter === 'cerrada' ? 'todas' : 'cerrada')}
        />
      </div>

      {/* Aviso destacado del Siguiente Nivel cuando hay órdenes completadas por el mecánico esperando cierre */}
      {!isMechanicOnly && counts.completedByMechanic > 0 && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border-2 border-rvgreen-500 bg-gradient-to-r from-rvgreen-50 via-white to-brand-50 p-4 shadow-sm dark:from-rvgreen-950/40 dark:via-slate-900 dark:to-brand-950/30 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rvgreen-500 font-extrabold text-slate-950 shadow">
              {counts.completedByMechanic}
            </div>
            <div>
              <p className="text-sm font-extrabold text-slate-900 dark:text-white">
                Siguiente Nivel: {counts.completedByMechanic} Hoja(s) de Trabajo ya completadas por el mecánico
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Ya tienen cargados los kilómetros actuales, trabajos extras, repuestos y observaciones. Solo falta cerrar la orden para guardar/descargar el PDF F02-PGV-02.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant={statusFilter === 'finalizada' ? 'secondary' : 'success'}
            icon={<ClipboardCheck className="h-4 w-4" />}
            onClick={() =>
              setStatusFilter(statusFilter === 'finalizada' ? 'todas' : 'finalizada')
            }
          >
            {statusFilter === 'finalizada'
              ? 'Ver todas las órdenes'
              : 'Ver listas para cerrar y descargar'}
          </Button>
        </div>
      )}

      {/* Filtro visual por Rubro de Intervención (Services, Pastillas, Amortiguadores, Cubiertas, etc.) */}
      <div className="card p-3.5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
            Filtrar OR por Rubro de Intervención
          </span>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setSortDir('desc')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-all duration-200 hover:-translate-y-0.5 ${
                sortDir === 'desc'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              }`}
            >
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
              Mayor a menor (Más nuevas)
            </button>
            <button
              type="button"
              onClick={() => setSortDir('asc')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold transition-all duration-200 hover:-translate-y-0.5 ${
                sortDir === 'asc'
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
              }`}
            >
              <ArrowUpNarrowWide className="h-3.5 w-3.5" />
              Menor a mayor (Más antiguas)
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRubricFilter('all')}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
              rubricFilter === 'all'
                ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Todas las OR
            <span
              className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                rubricFilter === 'all'
                  ? 'bg-white/20 text-white'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {orders.length}
            </span>
          </button>

          {WORK_ORDER_RUBRICS.map((rub) => {
            const active = rubricFilter === rub.id;
            const count = rubricCounts[rub.id];
            return (
              <button
                key={rub.id}
                type="button"
                onClick={() => setRubricFilter(active ? 'all' : rub.id)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
                  active
                    ? rub.activeChipClass
                    : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                {renderRubricIcon(rub.id)}
                {rub.label}
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active
                      ? 'bg-white/25 text-white'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Buscador y filtros adicionales */}
      <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar N° OR, patente, pastillas, amortiguador, aceite, mecánico…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="todas">Todos los estados (Activas + Cerradas)</option>
          <option value="activas">Solo activas (sin cerradas)</option>
          {(Object.keys(WO_STATUS_LABELS) as WorkOrderStatus[]).map((s) => (
            <option key={s} value={s}>
              {WO_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as '' | MaintenanceType)}
        >
          <option value="">Todos los tipos</option>
          {(Object.keys(MAINTENANCE_TYPE_LABELS) as MaintenanceType[]).map((t) => (
            <option key={t} value={t}>
              {MAINTENANCE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select
            className="input"
            value={mechanicFilter}
            onChange={(e) => setMechanicFilter(e.target.value)}
          >
            <option value="">Todos los mecánicos</option>
            <option value="__unassigned">Sin mecánico asignado</option>
            {mechanics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name || m.email}
              </option>
            ))}
          </select>
          {hasFilters && (
            <Button variant="ghost" onClick={resetFilters} title="Limpiar filtros" className="px-2">
              <FilterX className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <EmptyState
            title="No se pudieron cargar las órdenes"
            description={(error as Error).message}
          />
        ) : !filtered.length ? (
          <EmptyState
            title={
              orders.length
                ? 'No hay órdenes que coincidan con el rubro o filtros seleccionados'
                : 'Todavía no hay órdenes de reparación'
            }
            description={
              orders.length
                ? 'Pruebe seleccionando «Todas las OR» o limpiando el filtro activo.'
                : 'Genere la primera Orden de Reparación seleccionando una patente de la flota.'
            }
            action={
              orders.length ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Ver todas las órdenes
                </Button>
              ) : can('work_orders', 'create') || can('work_orders', 'edit') ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                  Nueva Orden de Reparación
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Tabla en computadoras */}
            <div className="hidden overflow-x-auto md:block">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>N° OR</th>
                    <th>Apertura / Km</th>
                    <th>Patente / Unidad</th>
                    <th>Rubro / Intervención</th>
                    <th>Detalle de Trabajo y Repuestos</th>
                    <th>Mecánico</th>
                    <th>Estado</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((o) => {
                    const orderRubrics = rubricsByOrderId.get(o.id) ?? [];
                    const orderItems = itemsByOrderId.get(o.id) ?? [];
                    return (
                      <tr
                        key={o.id}
                        onClick={() => navigate(`/ordenes/${o.id}`)}
                        className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="font-mono font-bold text-brand-700 dark:text-brand-300">
                          {formatOrderNumber(o.order_number)}
                        </td>
                        <td className="whitespace-nowrap">
                          <div className="font-medium">{formatDate(o.opened_at)}</div>
                          {o.kilometraje != null && (
                            <div className="text-xs text-slate-500">
                              {formatNumber(o.kilometraje)} km
                            </div>
                          )}
                        </td>
                        <td>
                          <div>
                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                              {formatPatente(o.patente)}
                            </span>
                            {o.nro_interno && (
                              <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                Int. {o.nro_interno}
                              </span>
                            )}
                          </div>
                          <div className="max-w-[180px] truncate text-xs text-slate-500">
                            {o.marca_modelo || '—'}
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {orderRubrics.length > 0 ? (
                              orderRubrics.map((rId) => {
                                const meta = WORK_ORDER_RUBRICS.find((x) => x.id === rId)!;
                                return (
                                  <span
                                    key={rId}
                                    className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                                  >
                                    {renderRubricIcon(rId)}
                                    {meta.shortLabel}
                                  </span>
                                );
                              })
                            ) : (
                              <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {MAINTENANCE_TYPE_LABELS[o.maintenance_type]}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="max-w-[320px]">
                          <div className="truncate font-medium text-slate-800 dark:text-slate-100">
                            {o.requested_work ||
                              o.work_performed ||
                              o.failure_description || <span className="text-slate-400">—</span>}
                          </div>
                          {o.oil_type && (
                            <div className="mt-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">
                              Aceite: {o.oil_type}
                              {o.oil_liters != null ? ` (${o.oil_liters} L)` : ''}
                            </div>
                          )}
                          {orderItems.length > 0 && (
                            <div className="mt-0.5 truncate text-xs text-slate-500">
                              Repuestos ({orderItems.length}):{' '}
                              {orderItems.map((it) => it.description).join(', ')}
                            </div>
                          )}
                        </td>
                        <td>
                          {o.mechanic_name || <span className="text-slate-400">Sin asignar</span>}
                        </td>
                        <td>
                          <WorkOrderStatusBadge status={o.status} />
                        </td>
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {canApproveClose && o.status === 'finalizada' && (
                              <Button
                                size="sm"
                                variant="success"
                                title="Aprobar cierre y descargar PDF oficial F02-PGV-02"
                                loading={busyOrderId === o.id}
                                onClick={() => void handleCloseAndDownload(o)}
                              >
                                Cerrar y PDF
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Descargar PDF F02-PGV-02 rev0"
                              loading={busyOrderId === o.id}
                              onClick={() => void handleQuickPdf(o)}
                            >
                              <FileDown className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Abrir Hoja de Trabajo"
                              onClick={() => navigate(`/ordenes/${o.id}`)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {!isMechanicOnly && can('work_orders', 'edit') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Editar asignación"
                                onClick={() => {
                                  setEditing(o);
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

            {/* Tarjetas adaptadas para uso del mecánico en el celular */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
              {filtered.map((o) => {
                const orderRubrics = rubricsByOrderId.get(o.id) ?? [];
                const orderItems = itemsByOrderId.get(o.id) ?? [];
                return (
                  <button
                    key={o.id}
                    onClick={() => navigate(`/ordenes/${o.id}`)}
                    className="flex w-full flex-col gap-1.5 p-4 text-left active:bg-slate-50 dark:active:bg-slate-800"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-bold text-brand-700 dark:text-brand-300">
                        {formatOrderNumber(o.order_number)} · {formatPatente(o.patente)}
                      </span>
                      <WorkOrderStatusBadge status={o.status} />
                    </div>
                    <p className="text-xs text-slate-500">
                      {o.marca_modelo || 'Sin modelo'} {o.nro_interno ? `· Int. ${o.nro_interno}` : ''}{' '}
                      · {formatDate(o.opened_at)}
                      {o.kilometraje != null ? ` · ${formatNumber(o.kilometraje)} km` : ''}
                    </p>
                    {orderRubrics.length > 0 && (
                      <div className="flex flex-wrap gap-1 py-0.5">
                        {orderRubrics.map((rId) => {
                          const meta = WORK_ORDER_RUBRICS.find((x) => x.id === rId)!;
                          return (
                            <span
                              key={rId}
                              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${meta.badgeClass}`}
                            >
                              {renderRubricIcon(rId)}
                              {meta.shortLabel}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {(o.requested_work || o.work_performed || o.failure_description) && (
                      <p className="line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                        {o.requested_work || o.work_performed || o.failure_description}
                      </p>
                    )}
                    {orderItems.length > 0 && (
                      <p className="truncate text-xs text-slate-500">
                        Repuestos: {orderItems.map((it) => it.description).join(', ')}
                      </p>
                    )}
                    <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                      <p className="text-xs text-slate-400">
                        Mecánico:{' '}
                        <b className="text-slate-600 dark:text-slate-300">
                          {o.mechanic_name || 'Sin asignar'}
                        </b>
                      </p>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 dark:bg-brand-950/50 dark:text-brand-300">
                        <Wrench className="h-3 w-3" />
                        {o.status === 'finalizada' || o.status === 'cerrada'
                          ? 'Ver Hoja OT'
                          : 'Cargar Km / Completar →'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <WorkOrderFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        workOrder={editing}
      />
    </div>
  );
}
