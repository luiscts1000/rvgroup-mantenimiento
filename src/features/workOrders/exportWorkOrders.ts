import * as XLSX from 'xlsx';
import { formatOrderNumber, MAINTENANCE_TYPE_LABELS, WO_STATUS_LABELS } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import type { WorkOrder } from '@/types/db';

export function exportWorkOrdersToExcel(orders: WorkOrder[]) {
  const rows = orders.map((wo) => ({
    'N° Orden': formatOrderNumber(wo.order_number),
    'Fecha apertura': formatDate(wo.opened_at, true),
    Patente: wo.patente,
    'N° Interno': wo.nro_interno ?? '',
    'Marca y modelo': wo.marca_modelo ?? '',
    Kilometraje: wo.kilometraje ?? '',
    'Tipo mantenimiento': MAINTENANCE_TYPE_LABELS[wo.maintenance_type],
    Estado: WO_STATUS_LABELS[wo.status],
    Solicitante: wo.requester_name ?? '',
    'Mecánico asignado': wo.mechanic_name ?? '',
    'Descripción falla': wo.failure_description ?? '',
    'Trabajo solicitado': wo.requested_work ?? '',
    Diagnóstico: wo.diagnosis ?? '',
    'Reparación realizada': wo.work_performed ?? '',
    Aceite: wo.oil_type ?? '',
    'Litros aceite': wo.oil_liters ?? '',
    'Otros fluidos': wo.other_fluids ?? '',
    'Mano de obra (hs)': wo.labor_hours ?? '',
    'Costo mano de obra': wo.labor_cost ?? '',
    'Detalle mano de obra': wo.labor_detail ?? '',
    Observaciones: wo.observations ?? '',
    'Fecha finalización': formatDate(wo.closed_at, true),
    'Aprobado por': wo.approved_by_name ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] ?? { 'N° Orden': '' });
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ordenes');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Ordenes_Reparacion_RVGroup_${date}.xlsx`);
}
