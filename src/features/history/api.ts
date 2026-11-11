import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import {
  APPOINTMENT_STATUS_LABELS,
  formatOrderNumber,
  MAINTENANCE_TYPE_LABELS,
  PENDING_PRIORITY_LABELS,
  PENDING_STATUS_LABELS,
  WO_STATUS_LABELS,
} from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import type {
  Appointment,
  PartCategory,
  PendingTask,
  PendingTaskAttachment,
  PreventiveInspection,
  Vehicle,
  WorkOrder,
  WorkOrderItem,
  WorkOrderPhoto,
} from '@/types/db';

export interface EnrichedWorkOrderItem extends WorkOrderItem {
  work_orders?: {
    id: string;
    order_number: number;
    opened_at: string;
    closed_at: string | null;
    vehicle_id: string;
    patente: string;
    nro_interno: string | null;
    marca_modelo: string | null;
    kilometraje: number | null;
    maintenance_type: string;
    status: string;
  } | null;
  parts?: {
    category: PartCategory;
    brand: string | null;
  } | null;
}

export interface EnrichedWorkOrderPhoto extends WorkOrderPhoto {
  work_orders?: {
    id: string;
    order_number: number;
    vehicle_id: string;
    patente: string;
    nro_interno: string | null;
    opened_at: string;
  } | null;
}

export interface EnrichedPendingAttachment extends PendingTaskAttachment {
  pending_tasks?: {
    id: string;
    vehicle_id: string;
    patente: string;
    nro_interno: string | null;
    task_title: string;
    detected_at: string;
  } | null;
}

export function useAllWorkOrderItems() {
  return useQuery({
    queryKey: ['all-work-order-items'],
    queryFn: async (): Promise<EnrichedWorkOrderItem[]> => {
      const { data, error } = await supabase
        .from('work_order_items')
        .select(
          '*, work_orders(id, order_number, opened_at, closed_at, vehicle_id, patente, nro_interno, marca_modelo, kilometraje, maintenance_type, status), parts(category, brand)',
        )
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EnrichedWorkOrderItem[];
    },
  });
}

export function useAllWorkOrderPhotos() {
  return useQuery({
    queryKey: ['all-work-order-photos'],
    queryFn: async (): Promise<EnrichedWorkOrderPhoto[]> => {
      const { data, error } = await supabase
        .from('work_order_photos')
        .select('*, work_orders(id, order_number, vehicle_id, patente, nro_interno, opened_at)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EnrichedWorkOrderPhoto[];
    },
  });
}

export function useAllPendingAttachments() {
  return useQuery({
    queryKey: ['all-pending-attachments'],
    queryFn: async (): Promise<EnrichedPendingAttachment[]> => {
      const { data, error } = await supabase
        .from('pending_task_attachments')
        .select('*, pending_tasks(id, vehicle_id, patente, nro_interno, task_title, detected_at)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as EnrichedPendingAttachment[];
    },
  });
}

export type KeyInterventionKind = 'cubiertas' | 'frenos' | 'amortiguadores' | 'parabrisas';

export interface KeyInterventionRecord {
  id: string;
  kind: KeyInterventionKind;
  date: string;
  vehicle_id: string;
  patente: string;
  nro_interno: string | null;
  kilometraje: number | null;
  sourceLabel: string;
  detail: string;
  cost: number;
  workOrderId?: string;
}

/**
 * Detecta y agrupa automáticamente los cambios de cubiertas, frenos, amortiguadores/suspensión
 * y parabrisas registrados en órdenes de reparación, repuestos utilizados, pendientes resueltos y turnos realizados.
 */
export function extractKeyInterventions(
  workOrders: WorkOrder[],
  items: EnrichedWorkOrderItem[],
  pendingTasks: PendingTask[],
  appointments: Appointment[],
): KeyInterventionRecord[] {
  const out: KeyInterventionRecord[] = [];
  const seenWoKind = new Set<string>();

  const matchKinds = (text: string, partCat?: PartCategory | null): KeyInterventionKind[] => {
    const low = text.toLowerCase();
    const kinds = new Set<KeyInterventionKind>();
    if (partCat === 'cubiertas' || /cubierta|neum[aá]tic|llanta|gom[ae]r/.test(low)) kinds.add('cubiertas');
    if (partCat === 'frenos' || /freno|pastilla|disco de freno|cinta|campana|bomba de freno/.test(low)) kinds.add('frenos');
    if (
      partCat === 'suspension' ||
      /amortiguador|suspensi[oó]n|tren delantero|extremo|buje|parrilla|rotula|r[oó]tula|espiral|el[aá]stico/.test(low)
    ) {
      kinds.add('amortiguadores');
    }
    if (/parabrisas|luneta|cristal/.test(low)) kinds.add('parabrisas');
    return Array.from(kinds);
  };

  // 1) Por repuestos utilizados en OR
  for (const it of items) {
    const wo = it.work_orders;
    if (!wo) continue;
    const kinds = matchKinds(it.description, it.parts?.category ?? null);
    for (const k of kinds) {
      const sub = it.unit_cost != null ? Number(it.quantity) * Number(it.unit_cost) : 0;
      out.push({
        id: `item-${it.id}-${k}`,
        kind: k,
        date: wo.opened_at.slice(0, 10),
        vehicle_id: wo.vehicle_id,
        patente: wo.patente,
        nro_interno: wo.nro_interno,
        kilometraje: wo.kilometraje,
        sourceLabel: `${formatOrderNumber(wo.order_number)} (Repuesto)`,
        detail: `${it.quantity} ${it.unit} × ${it.description}${it.part_code ? ` [${it.part_code}]` : ''}`,
        cost: sub,
        workOrderId: wo.id,
      });
      seenWoKind.add(`${wo.id}:${k}`);
    }
  }

  // 2) Por trabajos descriptos en OR (cuando no se cargó como ítem separado de ese rubro)
  for (const wo of workOrders) {
    const text = [wo.requested_work, wo.work_performed, wo.failure_description, wo.diagnosis].filter(Boolean).join(' ');
    const kinds = matchKinds(text);
    for (const k of kinds) {
      if (seenWoKind.has(`${wo.id}:${k}`)) continue;
      out.push({
        id: `wo-${wo.id}-${k}`,
        kind: k,
        date: wo.opened_at.slice(0, 10),
        vehicle_id: wo.vehicle_id,
        patente: wo.patente,
        nro_interno: wo.nro_interno,
        kilometraje: wo.kilometraje,
        sourceLabel: formatOrderNumber(wo.order_number),
        detail: wo.work_performed || wo.requested_work || wo.failure_description || 'Trabajo registrado en OR',
        cost: Number(wo.labor_cost ?? 0),
        workOrderId: wo.id,
      });
    }
  }

  // 3) Por pendientes reparados/cerrados sin OR vinculada
  for (const p of pendingTasks) {
    if ((p.status !== 'reparado' && p.status !== 'cerrado') || p.work_order_id) continue;
    const kinds = matchKinds(`${p.task_title} ${p.description ?? ''}`);
    for (const k of kinds) {
      out.push({
        id: `pend-${p.id}-${k}`,
        kind: k,
        date: (p.resolved_at || p.detected_at).slice(0, 10),
        vehicle_id: p.vehicle_id,
        patente: p.patente,
        nro_interno: p.nro_interno,
        kilometraje: null,
        sourceLabel: 'Pendiente resuelto',
        detail: `${p.task_title}${p.provider_name ? ` (${p.provider_name})` : ''}`,
        cost: 0,
      });
    }
  }

  // 4) Por turnos externos realizados sin OR ni pendiente vinculado
  for (const a of appointments) {
    if (a.status !== 'realizado' || a.work_order_id || a.pending_task_id) continue;
    const kinds = matchKinds(`${a.reason} ${a.observations ?? ''}`);
    for (const k of kinds) {
      out.push({
        id: `appt-${a.id}-${k}`,
        kind: k,
        date: a.appointment_date,
        vehicle_id: a.vehicle_id,
        patente: a.patente,
        nro_interno: a.nro_interno,
        kilometraje: null,
        sourceLabel: `Turno realizado (${a.provider_name})`,
        detail: a.reason,
        cost: 0,
      });
    }
  }

  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function exportHistoryToExcel(params: {
  selectedVehicle: Vehicle | null;
  workOrders: WorkOrder[];
  items: EnrichedWorkOrderItem[];
  interventions: KeyInterventionRecord[];
  pendingTasks: PendingTask[];
  appointments: Appointment[];
  inspections: PreventiveInspection[];
}) {
  const { selectedVehicle, workOrders, items, interventions, pendingTasks, appointments, inspections } = params;

  const itemsCostByWo = new Map<string, number>();
  for (const it of items) {
    if (it.unit_cost != null) {
      itemsCostByWo.set(it.work_order_id, (itemsCostByWo.get(it.work_order_id) ?? 0) + Number(it.quantity) * Number(it.unit_cost));
    }
  }

  const woRows = workOrders.map((wo) => {
    const partsCost = Math.round(itemsCostByWo.get(wo.id) ?? 0);
    const laborCost = Math.round(Number(wo.labor_cost ?? 0));
    return {
      'N° OR': formatOrderNumber(wo.order_number),
      Apertura: wo.opened_at.slice(0, 10),
      Cierre: wo.closed_at ? wo.closed_at.slice(0, 10) : '',
      Patente: formatPatente(wo.patente),
      'N° Interno': wo.nro_interno ?? '',
      Unidad: wo.marca_modelo ?? '',
      Kilometraje: wo.kilometraje ?? '',
      Tipo: MAINTENANCE_TYPE_LABELS[wo.maintenance_type],
      Estado: WO_STATUS_LABELS[wo.status],
      Mecánico: wo.mechanic_name ?? '',
      'Falla / Solicitud': wo.failure_description || wo.requested_work || '',
      'Trabajo Realizado': wo.work_performed ?? '',
      Aceite: wo.oil_type ? `${wo.oil_type}${wo.oil_liters ? ` (${wo.oil_liters} L)` : ''}` : '',
      'Costo Repuestos ($)': partsCost,
      'Mano de Obra ($)': laborCost,
      'Costo Total OR ($)': partsCost + laborCost,
    };
  });

  const itemRows = items.map((it) => ({
    Fecha: it.work_orders?.opened_at.slice(0, 10) ?? it.created_at.slice(0, 10),
    'N° OR': formatOrderNumber(it.work_orders?.order_number),
    Patente: formatPatente(it.work_orders?.patente ?? ''),
    'N° Interno': it.work_orders?.nro_interno ?? '',
    Código: it.part_code ?? '',
    Repuesto: it.description,
    Cantidad: Number(it.quantity),
    Unidad: it.unit,
    'Costo Unit. ($)': it.unit_cost != null ? Number(it.unit_cost) : '',
    'Subtotal ($)': it.unit_cost != null ? Math.round(Number(it.quantity) * Number(it.unit_cost)) : '',
  }));

  const kindLabel: Record<KeyInterventionKind, string> = {
    cubiertas: 'Cubiertas / Neumáticos',
    frenos: 'Frenos',
    amortiguadores: 'Amortiguadores / Suspensión',
    parabrisas: 'Parabrisas / Cristales',
  };

  const intRows = interventions.map((r) => ({
    Rubro: kindLabel[r.kind],
    Fecha: r.date,
    Patente: formatPatente(r.patente),
    'N° Interno': r.nro_interno ?? '',
    Kilometraje: r.kilometraje ?? '',
    Origen: r.sourceLabel,
    Detalle: r.detail,
    'Importe ($)': r.cost ? Math.round(r.cost) : '',
  }));

  const pendRows = pendingTasks.map((p) => ({
    'Fecha Detección': p.detected_at,
    Patente: formatPatente(p.patente),
    'N° Interno': p.nro_interno ?? '',
    Trabajo: p.task_title,
    Detalle: p.description ?? '',
    Prioridad: PENDING_PRIORITY_LABELS[p.priority],
    Estado: PENDING_STATUS_LABELS[p.status],
    'Fecha Solución': p.resolved_at ? p.resolved_at.slice(0, 10) : '',
    Proveedor: p.provider_name ?? '',
  }));

  const apptRows = appointments.map((a) => ({
    Fecha: a.appointment_date,
    Hora: a.appointment_time ?? '',
    Patente: formatPatente(a.patente),
    'N° Interno': a.nro_interno ?? '',
    Motivo: a.reason,
    'Taller / Proveedor': a.provider_name,
    Estado: APPOINTMENT_STATUS_LABELS[a.status],
    Responsable: a.responsible ?? '',
  }));

  const inspRows = inspections.map((i) => ({
    Fecha: i.inspected_at,
    Patente: formatPatente(i.patente),
    'N° Interno': i.nro_interno ?? '',
    Kilometraje: i.kilometraje ?? '',
    'Vencimiento RTO': i.rto_due_date ?? '',
    'Apta para RTO': i.overall_ready_for_rto ? 'Sí' : 'No (requiere trabajos)',
    Inspector: i.inspector_name ?? '',
    Observaciones: i.observations ?? '',
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(woRows), 'Servicios y OR');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemRows), 'Repuestos Utilizados');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(intRows), 'Cubiertas-Frenos-Susp');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendRows), 'Pendientes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(apptRows), 'Turnos');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inspRows), 'Inspecciones RTO');

  const suffix = selectedVehicle ? formatPatente(selectedVehicle.patente) : 'Flota_Completa';
  XLSX.writeFile(wb, `Historial_Mantenimiento_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
