import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CalendarClock,
  Camera,
  ClipboardList,
  DollarSign,
  Download,
  ExternalLink,
  FileText,
  History,
  Layers,
  Package,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { Badge, Button, EmptyState, Field, PageHeader, Spinner, StatCard } from '@/components/ui';
import {
  APPOINTMENT_STATUS_COLORS,
  APPOINTMENT_STATUS_LABELS,
  formatOrderNumber,
  MAINTENANCE_TYPE_LABELS,
  PENDING_STATUS_COLORS,
  PENDING_STATUS_LABELS,
  PHOTO_STAGE_LABELS,
  WO_STATUS_COLORS,
  WO_STATUS_LABELS,
} from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { useVehicles } from '@/features/vehicles/api';
import { useWorkOrders } from '@/features/workOrders/api';
import { generateWorkOrderPdf } from '@/features/workOrders/generateWorkOrderPdf';
import { useAppointments, usePendingTasks } from '@/features/pending/api';
import {
  formatShortModelLabel,
  getBrandGroup,
  getComponentCellClass,
  getRestanteCellClass,
  getServiceKmStatus,
  PREVENTIVE_KM_COLUMNS,
  useInspections,
  type BrandGroup,
} from '@/features/preventive/api';
import {
  exportHistoryToExcel,
  extractKeyInterventions,
  useAllPendingAttachments,
  useAllWorkOrderItems,
  useAllWorkOrderPhotos,
  type KeyInterventionKind,
} from './api';
import { generateVehicleHistoryPdf } from './generateVehicleHistoryPdf';

type TabKey = 'timeline' | 'work_orders' | 'km_matrix' | 'pendings_media';

const KIND_LABELS: Record<KeyInterventionKind, string> = {
  cubiertas: 'Cubiertas / Neumáticos',
  frenos: 'Frenos',
  amortiguadores: 'Amortiguadores / Suspensión',
  parabrisas: 'Parabrisas / Cristales',
};

const KIND_COLORS: Record<KeyInterventionKind, string> = {
  cubiertas: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  frenos: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  amortiguadores: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  parabrisas: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
};

export function HistoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();

  const { data: vehicles = [], isLoading: l1 } = useVehicles();
  const { data: workOrders = [], isLoading: l2 } = useWorkOrders();
  const { data: allItems = [], isLoading: l3 } = useAllWorkOrderItems();
  const { data: pendingTasks = [], isLoading: l4 } = usePendingTasks();
  const { data: appointments = [], isLoading: l5 } = useAppointments();
  const { data: inspections = [], isLoading: l6 } = useInspections();
  const { data: woPhotos = [] } = useAllWorkOrderPhotos();
  const { data: pendingAtts = [] } = useAllPendingAttachments();

  const selectedVehicleId = searchParams.get('vehicleId') ?? '';
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabKey>('timeline');
  const [kindFilter, setKindFilter] = useState<'all' | KeyInterventionKind>('all');
  const [pdfBusy, setPdfBusy] = useState(false);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) ?? null,
    [vehicles, selectedVehicleId],
  );

  const setVehicleFilter = (vid: string) => {
    const next = new URLSearchParams(searchParams);
    if (vid) next.set('vehicleId', vid);
    else next.delete('vehicleId');
    setSearchParams(next, { replace: true });
  };

  const inDateRange = (isoDate: string | null | undefined) => {
    if (!isoDate) return true;
    const d = isoDate.slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const filteredWOs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workOrders.filter((w) => {
      if (selectedVehicleId && w.vehicle_id !== selectedVehicleId) return false;
      if (!inDateRange(w.opened_at)) return false;
      if (q) {
        const hay = [
          formatOrderNumber(w.order_number),
          w.patente,
          w.nro_interno,
          w.marca_modelo,
          w.failure_description,
          w.requested_work,
          w.work_performed,
          w.mechanic_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [workOrders, selectedVehicleId, dateFrom, dateTo, search]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((it) => {
      const wo = it.work_orders;
      if (selectedVehicleId && wo?.vehicle_id !== selectedVehicleId) return false;
      if (!inDateRange(wo?.opened_at ?? it.created_at)) return false;
      if (q) {
        const hay = [it.part_code, it.description, wo?.patente, wo?.nro_interno, formatOrderNumber(wo?.order_number)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, selectedVehicleId, dateFrom, dateTo, search]);

  const filteredPendings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pendingTasks.filter((p) => {
      if (selectedVehicleId && p.vehicle_id !== selectedVehicleId) return false;
      if (!inDateRange(p.detected_at)) return false;
      if (q) {
        const hay = [p.patente, p.nro_interno, p.task_title, p.description, p.provider_name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [pendingTasks, selectedVehicleId, dateFrom, dateTo, search]);

  const filteredAppointments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return appointments.filter((a) => {
      if (selectedVehicleId && a.vehicle_id !== selectedVehicleId) return false;
      if (!inDateRange(a.appointment_date)) return false;
      if (q) {
        const hay = [a.patente, a.nro_interno, a.reason, a.provider_name, a.observations]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [appointments, selectedVehicleId, dateFrom, dateTo, search]);

  const filteredInspections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inspections.filter((i) => {
      if (selectedVehicleId && i.vehicle_id !== selectedVehicleId) return false;
      if (!inDateRange(i.inspected_at)) return false;
      if (q) {
        const hay = [i.patente, i.nro_interno, i.inspector_name, i.observations]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [inspections, selectedVehicleId, dateFrom, dateTo, search]);

  const interventions = useMemo(
    () => extractKeyInterventions(filteredWOs, filteredItems, filteredPendings, filteredAppointments),
    [filteredWOs, filteredItems, filteredPendings, filteredAppointments],
  );

  const visibleInterventions = useMemo(
    () => (kindFilter === 'all' ? interventions : interventions.filter((r) => r.kind === kindFilter)),
    [interventions, kindFilter],
  );

  const filteredPhotos = useMemo(() => {
    return woPhotos.filter((ph) => {
      if (selectedVehicleId && ph.work_orders?.vehicle_id !== selectedVehicleId) return false;
      if (!inDateRange(ph.work_orders?.opened_at ?? ph.created_at)) return false;
      return true;
    });
  }, [woPhotos, selectedVehicleId, dateFrom, dateTo]);

  const filteredAttachments = useMemo(() => {
    return pendingAtts.filter((att) => {
      if (selectedVehicleId && att.pending_tasks?.vehicle_id !== selectedVehicleId) return false;
      if (!inDateRange(att.pending_tasks?.detected_at ?? att.created_at)) return false;
      return true;
    });
  }, [pendingAtts, selectedVehicleId, dateFrom, dateTo]);

  const itemsCostByWo = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of allItems) {
      if (it.unit_cost != null) {
        map.set(it.work_order_id, (map.get(it.work_order_id) ?? 0) + Number(it.quantity) * Number(it.unit_cost));
      }
    }
    return map;
  }, [allItems]);

  const totals = useMemo(() => {
    const partsCost = filteredItems.reduce(
      (acc, it) => acc + (it.unit_cost != null ? Number(it.quantity) * Number(it.unit_cost) : 0),
      0,
    );
    const laborCost = filteredWOs.reduce((acc, w) => acc + Number(w.labor_cost ?? 0), 0);
    return {
      partsCost: Math.round(partsCost),
      laborCost: Math.round(laborCost),
      grandTotal: Math.round(partsCost + laborCost),
    };
  }, [filteredItems, filteredWOs]);

  const timelineEvents = useMemo(() => {
    const list: {
      id: string;
      date: string;
      type: 'wo' | 'inspection' | 'pending' | 'appointment';
      patente: string;
      nroInterno: string | null;
      title: string;
      subtitle: string;
      badgeLabel: string;
      badgeClass: string;
      cost?: number;
      linkTo?: string;
    }[] = [];

    for (const wo of filteredWOs) {
      const cost = Math.round((itemsCostByWo.get(wo.id) ?? 0) + Number(wo.labor_cost ?? 0));
      list.push({
        id: `wo-${wo.id}`,
        date: wo.opened_at.slice(0, 10),
        type: 'wo',
        patente: wo.patente,
        nroInterno: wo.nro_interno,
        title: `${formatOrderNumber(wo.order_number)} · ${MAINTENANCE_TYPE_LABELS[wo.maintenance_type]}`,
        subtitle: wo.work_performed || wo.requested_work || wo.failure_description || 'Sin descripción',
        badgeLabel: WO_STATUS_LABELS[wo.status],
        badgeClass: WO_STATUS_COLORS[wo.status],
        cost: cost > 0 ? cost : undefined,
        linkTo: `/ordenes/${wo.id}`,
      });
    }

    for (const insp of filteredInspections) {
      list.push({
        id: `insp-${insp.id}`,
        date: insp.inspected_at,
        type: 'inspection',
        patente: insp.patente,
        nroInterno: insp.nro_interno,
        title: 'Inspección Previa a RTO',
        subtitle: insp.observations || `Control de 8 puntos (${insp.inspector_name || 'Sin responsable'})`,
        badgeLabel: insp.overall_ready_for_rto ? 'Apta para RTO' : 'Requiere trabajos',
        badgeClass: insp.overall_ready_for_rto
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
        linkTo: '/preventivo',
      });
    }

    for (const p of filteredPendings) {
      list.push({
        id: `pend-${p.id}`,
        date: p.detected_at,
        type: 'pending',
        patente: p.patente,
        nroInterno: p.nro_interno,
        title: `Pendiente: ${p.task_title}`,
        subtitle: p.description || (p.provider_name ? `Proveedor: ${p.provider_name}` : 'Registrado en tablero'),
        badgeLabel: PENDING_STATUS_LABELS[p.status],
        badgeClass: PENDING_STATUS_COLORS[p.status],
        linkTo: '/pendientes',
      });
    }

    for (const a of filteredAppointments) {
      list.push({
        id: `appt-${a.id}`,
        date: a.appointment_date,
        type: 'appointment',
        patente: a.patente,
        nroInterno: a.nro_interno,
        title: `Turno externo: ${a.reason}`,
        subtitle: `Taller: ${a.provider_name}${a.appointment_time ? ` (${a.appointment_time} hs)` : ''}`,
        badgeLabel: APPOINTMENT_STATUS_LABELS[a.status],
        badgeClass: APPOINTMENT_STATUS_COLORS[a.status],
        linkTo: '/turnos',
      });
    }

    return list.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [filteredWOs, filteredInspections, filteredPendings, filteredAppointments, itemsCostByWo]);

  if (l1 || l2 || l3 || l4 || l5 || l6) return <Spinner />;

  const openStorageFile = async (storagePath: string) => {
    const { data, error } = await supabase.storage.from('work-orders').createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) {
      toast.error('No se pudo abrir el archivo adjunto');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    try {
      await generateVehicleHistoryPdf({
        vehicle: selectedVehicle,
        workOrders: filteredWOs,
        items: filteredItems,
        interventions,
        pendingTasks: filteredPendings,
        appointments: filteredAppointments,
        inspections: filteredInspections,
      });
      toast.success('Ficha histórica en PDF descargada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al generar PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Historial de mantenimiento por unidad"
        subtitle="Consulta unificada de servicios, reparaciones, repuestos, cubiertas, frenos, amortiguadores, parabrisas, gastos, pendientes, turnos, fotos y PDFs"
        actions={
          can('history', 'export') && (
            <>
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                onClick={() =>
                  exportHistoryToExcel({
                    selectedVehicle,
                    workOrders: filteredWOs,
                    items: filteredItems,
                    interventions,
                    pendingTasks: filteredPendings,
                    appointments: filteredAppointments,
                    inspections: filteredInspections,
                  })
                }
              >
                Exportar Excel
              </Button>
              <Button
                icon={<FileText className="h-4 w-4" />}
                loading={pdfBusy}
                onClick={() => void handleDownloadPdf()}
              >
                Descargar Ficha PDF
              </Button>
            </>
          )
        }
      />

      {/* Filtros principales */}
      <div className="card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Unidad (Patente / Interno)" className="lg:col-span-2">
            <select
              className="input"
              value={selectedVehicleId}
              onChange={(e) => setVehicleFilter(e.target.value)}
            >
              <option value="">— Todas las unidades de la flota —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {formatPatente(v.patente)}
                  {v.nro_interno ? ` · Int. ${v.nro_interno}` : ''} —{' '}
                  {[v.marca, v.modelo, v.version].filter(Boolean).join(' ')}
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

          <Field label="Buscar palabra clave">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                placeholder="OR, repuesto, falla, taller..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </Field>
        </div>
      </div>

      {/* KPIs del historial filtrado */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Gasto total acumulado"
          value={`$ ${formatNumber(totals.grandTotal)}`}
          hint={`Repuestos: $ ${formatNumber(totals.partsCost)} · M.O.: $ ${formatNumber(totals.laborCost)}`}
          icon={<DollarSign className="h-5 w-5" />}
          tone="brand"
          onClick={() => setTab('work_orders')}
        />
        <StatCard
          label="Servicios y reparaciones (OR)"
          value={formatNumber(filteredWOs.length)}
          hint={`${filteredInspections.length} inspecciones pre-RTO`}
          icon={<Wrench className="h-5 w-5" />}
          tone="amber"
          onClick={() => setTab('work_orders')}
        />
        <StatCard
          label="Repuestos colocados"
          value={formatNumber(filteredItems.length)}
          hint="Ítems registrados en órdenes"
          icon={<Package className="h-5 w-5" />}
          tone="green"
          onClick={() => setTab('work_orders')}
        />
        <StatCard
          label="Planilla Km y Componentes"
          value={formatNumber(selectedVehicle ? 1 : vehicles.filter((v) => v.status !== 'baja').length)}
          hint={`${interventions.length} cambios registrados en OR`}
          icon={<Layers className="h-5 w-5" />}
          tone="brand"
          onClick={() => setTab('km_matrix')}
        />
      </div>

      {/* 4 Pestañas unificadas para mayor claridad */}
      <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {(
          [
            { id: 'timeline', label: `Línea de tiempo (${timelineEvents.length})`, icon: History },
            { id: 'work_orders', label: `Órdenes y Repuestos (${filteredWOs.length})`, icon: Wrench },
            { id: 'km_matrix', label: 'Planilla Control Km (Cubiertas, Correas, Frenos, Fluidos)', icon: ShieldCheck },
            {
              id: 'pendings_media',
              label: `Pendientes, Turnos y Archivos (${filteredPendings.length + filteredAppointments.length + filteredPhotos.length})`,
              icon: Camera,
            },
          ] as { id: TabKey; label: string; icon: typeof History }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Contenido por pestaña */}
      {tab === 'timeline' && (
        <div className="card p-5">
          {timelineEvents.length === 0 ? (
            <EmptyState
              title="Sin eventos en el historial para los filtros seleccionados"
              description="Seleccione otra unidad o amplíe el rango de fechas."
            />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {timelineEvents.map((ev) => (
                <li
                  key={ev.id}
                  onClick={() => ev.linkTo && navigate(ev.linkTo)}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/70 dark:hover:bg-slate-800/40 cursor-pointer px-2 rounded-lg"
                >
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">{formatDate(ev.date)}</span>
                      <span className="font-mono text-xs font-bold text-brand-700 dark:text-brand-300">
                        {formatPatente(ev.patente)}
                      </span>
                      {ev.nroInterno && <span className="text-xs text-slate-400">Int. {ev.nroInterno}</span>}
                      <span className="font-semibold text-slate-900 dark:text-white">{ev.title}</span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{ev.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ev.cost != null && (
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                        $ {formatNumber(ev.cost)}
                      </span>
                    )}
                    <Badge className={ev.badgeClass}>{ev.badgeLabel}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'work_orders' && (
        <div className="space-y-5">
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 font-semibold dark:border-slate-800">
              Órdenes de reparación y servicios ({filteredWOs.length})
            </div>
            {filteredWOs.length === 0 ? (
              <EmptyState title="Sin órdenes de reparación registradas" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-4 py-3">N° OR</th>
                      <th className="px-4 py-3">Fecha / Km</th>
                      <th className="px-4 py-3">Unidad</th>
                      <th className="px-4 py-3">Tipo / Mecánico</th>
                      <th className="px-4 py-3">Trabajo realizado / Falla</th>
                      <th className="px-4 py-3">Costos</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-right">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredWOs.map((wo) => {
                      const pCost = Math.round(itemsCostByWo.get(wo.id) ?? 0);
                      const lCost = Math.round(Number(wo.labor_cost ?? 0));
                      const tot = pCost + lCost;
                      const woItems = allItems.filter((i) => i.work_order_id === wo.id);
                      const veh = vehicles.find((v) => v.id === wo.vehicle_id);

                      return (
                        <tr key={wo.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => navigate(`/ordenes/${wo.id}`)}
                              className="font-mono font-bold text-brand-700 hover:underline dark:text-brand-300"
                            >
                              {formatOrderNumber(wo.order_number)}
                            </button>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p>{formatDate(wo.opened_at)}</p>
                            {wo.kilometraje != null && (
                              <p className="text-xs text-slate-500">{formatNumber(wo.kilometraje)} km</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono font-semibold">{formatPatente(wo.patente)}</span>
                            <p className="text-xs text-slate-500">{wo.marca_modelo || '—'}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-medium">{MAINTENANCE_TYPE_LABELS[wo.maintenance_type]}</p>
                            <p className="text-xs text-slate-500">{wo.mechanic_name || 'Sin mecánico'}</p>
                          </td>
                          <td className="px-4 py-3 max-w-xs">
                            <p className="line-clamp-2 text-xs">
                              {wo.work_performed || wo.requested_work || wo.failure_description || '—'}
                            </p>
                            {wo.oil_type && (
                              <p className="mt-0.5 text-[11px] text-brand-700 dark:text-brand-300">
                                Aceite: {wo.oil_type} {wo.oil_liters ? `(${wo.oil_liters} L)` : ''}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs">
                            <p className="font-bold text-slate-900 dark:text-white">$ {formatNumber(tot)}</p>
                            <p className="text-slate-500">
                              Rep: $ {formatNumber(pCost)} · MO: $ {formatNumber(lCost)}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={WO_STATUS_COLORS[wo.status]}>{WO_STATUS_LABELS[wo.status]}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<FileText className="h-3.5 w-3.5" />}
                              onClick={() => void generateWorkOrderPdf(wo, veh, woItems, { download: true, saveToCloud: false })}
                            >
                              PDF
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-4 py-3 font-semibold dark:border-slate-800">
              Repuestos e insumos colocados ({filteredItems.length})
            </div>
            {filteredItems.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No se registraron repuestos colocados en este filtro.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                    <tr>
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Orden</th>
                      <th className="px-4 py-3">Unidad</th>
                      <th className="px-4 py-3">Código</th>
                      <th className="px-4 py-3">Descripción del repuesto</th>
                      <th className="px-4 py-3 text-right">Cantidad</th>
                      <th className="px-4 py-3 text-right">Costo Unit.</th>
                      <th className="px-4 py-3 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredItems.map((it) => {
                      const sub = it.unit_cost != null ? Math.round(Number(it.quantity) * Number(it.unit_cost)) : null;
                      return (
                        <tr key={it.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3 whitespace-nowrap">
                            {formatDate(it.work_orders?.opened_at ?? it.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            {it.work_orders ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/ordenes/${it.work_orders!.id}`)}
                                className="font-mono font-bold text-brand-700 hover:underline dark:text-brand-300"
                              >
                                {formatOrderNumber(it.work_orders.order_number)}
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono font-semibold">
                            {formatPatente(it.work_orders?.patente ?? '')}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{it.part_code || '—'}</td>
                          <td className="px-4 py-3">{it.description}</td>
                          <td className="px-4 py-3 text-right">
                            {it.quantity} {it.unit}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {it.unit_cost != null ? `$ ${formatNumber(Number(it.unit_cost))}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {sub != null ? `$ ${formatNumber(sub)}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'km_matrix' && (
        <div className="space-y-5">
          {/* Planilla idéntica a la imagen (Modelo, Interno, Patente, Km, Próximo Servi, Restante y los 10 componentes) */}
          <div className="card overflow-hidden border border-slate-300 shadow-sm dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <div>
                <h3 className="font-semibold">
                  Planilla General de Control por Kilometraje (Service y 10 Componentes)
                </h3>
                <p className="text-xs text-slate-500">
                  Muestra el estado actual de Km, Próximo Service, Restante y objetivos de cambio de Cubiertas, Correas, Amortiguadores, Cintas, Pastillas, Discos y Fluidos.
                </p>
              </div>
              <Button size="sm" onClick={() => navigate('/preventivo')}>
                Editar valores en Preventivo
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b-2 border-slate-400 bg-slate-200/90 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    <th className="sticky left-0 z-10 bg-slate-200 px-2.5 py-2 text-left font-bold dark:bg-slate-800">
                      Modelo
                    </th>
                    <th className="border-l border-slate-300 px-2 py-2 text-center font-bold dark:border-slate-700">
                      Interno
                    </th>
                    <th className="border-l border-slate-300 px-2.5 py-2 text-center font-bold dark:border-slate-700">
                      Patente
                    </th>
                    <th className="border-l border-slate-300 px-2.5 py-2 text-right font-bold dark:border-slate-700">
                      Km
                    </th>
                    <th className="border-l border-slate-300 px-2.5 py-2 text-right font-bold dark:border-slate-700">
                      Próximo Servi
                    </th>
                    <th className="border-l border-slate-300 px-2.5 py-2 text-right font-bold dark:border-slate-700">
                      Restante
                    </th>
                    {PREVENTIVE_KM_COLUMNS.map((col) => (
                      <th
                        key={col.field}
                        className="border-l border-slate-300 px-2 py-2 text-center font-bold whitespace-nowrap dark:border-slate-700"
                      >
                        {col.shortHeader}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {vehicles
                    .filter((v) => v.status !== 'baja' && (!selectedVehicleId || v.id === selectedVehicleId))
                    .sort((a, b) => (getServiceKmStatus(a).remainingKm ?? 999999) - (getServiceKmStatus(b).remainingKm ?? 999999))
                    .map((v) => {
                      const b: BrandGroup = getBrandGroup(v);
                      const bClass =
                        b === 'toyota'
                          ? 'font-bold text-slate-900 dark:text-white'
                          : b === 'ranger'
                            ? 'font-semibold text-purple-700 dark:text-purple-300'
                            : b === 'sprinter'
                              ? 'font-semibold text-teal-700 dark:text-teal-300'
                              : 'font-medium';
                      const svc = getServiceKmStatus(v);
                      return (
                        <tr key={v.id} className="hover:brightness-95">
                          <td className={`sticky left-0 z-10 bg-white px-2.5 py-1.5 whitespace-nowrap dark:bg-slate-900 ${bClass}`}>
                            {formatShortModelLabel(v)}
                          </td>
                          <td className={`border-l border-slate-200 px-2 py-1.5 text-center dark:border-slate-800 ${bClass}`}>
                            {v.nro_interno || '-'}
                          </td>
                          <td className={`border-l border-slate-200 px-2.5 py-1.5 text-center font-mono dark:border-slate-800 ${bClass}`}>
                            {formatPatente(v.patente)}
                          </td>
                          <td className={`border-l border-slate-200 px-2.5 py-1.5 text-right tabular-nums dark:border-slate-800 ${bClass}`}>
                            {v.km_actual != null ? formatNumber(v.km_actual) : '—'}
                          </td>
                          <td className={`border-l border-slate-200 px-2.5 py-1.5 text-right tabular-nums dark:border-slate-800 ${bClass}`}>
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
                            return (
                              <td
                                key={col.field}
                                className={`border-l border-slate-200 px-2 py-1.5 text-center tabular-nums dark:border-slate-800 ${getComponentCellClass(
                                  v.km_actual,
                                  val,
                                )}`}
                              >
                                {val != null ? formatNumber(val) : '-'}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Registro histórico de cambios realizados en esos rubros */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                Historial de cambios realizados en órdenes y talleres ({visibleInterventions.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'all', label: `Todos (${interventions.length})` },
                    { id: 'cubiertas', label: 'Cubiertas' },
                    { id: 'frenos', label: 'Frenos' },
                    { id: 'amortiguadores', label: 'Amortiguadores / Susp.' },
                    { id: 'parabrisas', label: 'Parabrisas' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setKindFilter(f.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      kindFilter === f.id
                        ? 'bg-brand-700 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card overflow-hidden">
              {visibleInterventions.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">
                  Aún no hay órdenes ni pendientes cerrados en estos rubros para el filtro actual.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
                      <tr>
                        <th className="px-4 py-3">Rubro</th>
                        <th className="px-4 py-3">Fecha</th>
                        <th className="px-4 py-3">Unidad</th>
                        <th className="px-4 py-3">Kilometraje</th>
                        <th className="px-4 py-3">Detalle del cambio / trabajo</th>
                        <th className="px-4 py-3">Origen</th>
                        <th className="px-4 py-3 text-right">Costo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {visibleInterventions.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="px-4 py-3">
                            <Badge className={KIND_COLORS[r.kind]}>{KIND_LABELS[r.kind]}</Badge>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.date)}</td>
                          <td className="px-4 py-3 font-mono font-bold">{formatPatente(r.patente)}</td>
                          <td className="px-4 py-3">
                            {r.kilometraje != null ? `${formatNumber(r.kilometraje)} km` : '—'}
                          </td>
                          <td className="px-4 py-3">{r.detail}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{r.sourceLabel}</td>
                          <td className="px-4 py-3 text-right font-semibold">
                            {r.cost > 0 ? `$ ${formatNumber(Math.round(r.cost))}` : '—'}
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
      )}

      {tab === 'pendings_media' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <ClipboardList className="h-4 w-4" /> Pendientes actuales y solucionados ({filteredPendings.length})
              </h3>
              {filteredPendings.length === 0 ? (
                <p className="text-sm text-slate-500">Sin pendientes registrados.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {filteredPendings.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="font-medium">
                          <span className="font-mono font-bold text-brand-700 dark:text-brand-300">
                            {formatPatente(p.patente)}
                          </span>{' '}
                          · {p.task_title}
                        </p>
                        <p className="text-xs text-slate-500">
                          Detectado: {formatDate(p.detected_at)}
                          {p.resolved_at ? ` · Solucionado: ${formatDate(p.resolved_at)}` : ''}
                          {p.provider_name ? ` · Taller: ${p.provider_name}` : ''}
                        </p>
                      </div>
                      <Badge className={PENDING_STATUS_COLORS[p.status]}>{PENDING_STATUS_LABELS[p.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <CalendarClock className="h-4 w-4" /> Turnos externos realizados y programados ({filteredAppointments.length})
              </h3>
              {filteredAppointments.length === 0 ? (
                <p className="text-sm text-slate-500">Sin turnos registrados.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                  {filteredAppointments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="font-medium">
                          <span className="font-mono font-bold text-brand-700 dark:text-brand-300">
                            {formatPatente(a.patente)}
                          </span>{' '}
                          · {a.reason}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(a.appointment_date)} {a.appointment_time ?? ''} · Taller: {a.provider_name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {a.receipt_path && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void openStorageFile(a.receipt_path!)}
                          >
                            Comprobante
                          </Button>
                        )}
                        <Badge className={APPOINTMENT_STATUS_COLORS[a.status]}>
                          {APPOINTMENT_STATUS_LABELS[a.status]}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-3 font-semibold">
              Fotografías y comprobantes adjuntos ({filteredPhotos.length + filteredAttachments.length})
            </h3>
            {filteredPhotos.length === 0 && filteredAttachments.length === 0 ? (
              <p className="text-sm text-slate-500">
                No hay fotografías ni comprobantes cargados en las órdenes o pendientes filtrados.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredPhotos.map((ph) => (
                  <div
                    key={ph.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold text-brand-700 dark:text-brand-300">
                        {formatOrderNumber(ph.work_orders?.order_number)} · {formatPatente(ph.work_orders?.patente ?? '')}
                      </p>
                      <p className="truncate text-sm font-medium">{ph.caption || 'Fotografía de OR'}</p>
                      <p className="text-xs text-slate-500">
                        {PHOTO_STAGE_LABELS[ph.stage ?? ''] || 'Registro fotográfico'} · {formatDate(ph.created_at)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<ExternalLink className="h-3.5 w-3.5" />}
                      onClick={() => void openStorageFile(ph.storage_path)}
                    >
                      Abrir
                    </Button>
                  </div>
                ))}

                {filteredAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-bold text-brand-700 dark:text-brand-300">
                        {formatPatente(att.pending_tasks?.patente ?? '')} · {att.kind.toUpperCase()}
                      </p>
                      <p className="truncate text-sm font-medium">{att.caption || att.file_name}</p>
                      <p className="text-xs text-slate-500">
                        {att.pending_tasks?.task_title} · {formatDate(att.created_at)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<ExternalLink className="h-3.5 w-3.5" />}
                      onClick={() => void openStorageFile(att.storage_path)}
                    >
                      Abrir
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
