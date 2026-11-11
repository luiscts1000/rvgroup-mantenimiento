import type { WorkOrder, WorkOrderItem } from '@/types/db';

export interface TireIntervention {
  workOrderId: string;
  orderNumber: number;
  date: string;
  kilometraje: number | null;
  type: 'rotacion' | 'alineacion_balanceo' | 'cambio' | 'reparacion';
  title: string;
  description: string;
}

export interface VehicleTireIntelligence {
  lastRotationKm: number | null;
  lastRotationDate: string | null;
  kmSinceRotation: number | null;
  rotationStatus: 'ok' | 'due_soon' | 'overdue' | 'sin_datos';
  lastAlignmentKm: number | null;
  lastAlignmentDate: string | null;
  lastChangeKm: number | null;
  lastChangeDate: string | null;
  interventions: TireIntervention[];
}

/**
 * Analiza automáticamente el historial de órdenes de reparación e ítems de una unidad
 * para extraer intervenciones de neumáticos: rotaciones, alineación/balanceo y recambios.
 */
export function analyzeVehicleTires(
  vehicleKm: number | null | undefined,
  workOrders: WorkOrder[],
  _items?: WorkOrderItem[],
): VehicleTireIntelligence {
  const interventions: TireIntervention[] = [];

  // Buscar en las órdenes de reparación
  for (const wo of workOrders) {
    const text = [wo.requested_work, wo.failure_description, wo.work_performed, wo.diagnosis]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const isRotation = /rotaci[oó]n|rotar|rotaron/.test(text) && /cubierta|neum[aá]tic|rueda|tren/.test(text);
    const isAlignment = /alineaci[oó]n|balanceo|combar|alinear|balancear/.test(text);
    const isChange = /cambio de cubierta|recambio de cubierta|cubierta nueva|cubiertas nuevas|cubierta colocada|recapad/.test(text);
    const isRepair = /pinchadura|gomeria|gomer[ií]a|vulcaniz|parche|v[aá]lvula/.test(text);

    if (isRotation) {
      interventions.push({
        workOrderId: wo.id,
        orderNumber: wo.order_number,
        date: wo.opened_at,
        kilometraje: wo.kilometraje,
        type: 'rotacion',
        title: 'Rotación de neumáticos',
        description: wo.work_performed || wo.requested_work || 'Rotación de cubiertas realizada',
      });
    } else if (isAlignment) {
      interventions.push({
        workOrderId: wo.id,
        orderNumber: wo.order_number,
        date: wo.opened_at,
        kilometraje: wo.kilometraje,
        type: 'alineacion_balanceo',
        title: 'Alineación y balanceo',
        description: wo.work_performed || wo.requested_work || 'Alineación y balanceo de tren rodante',
      });
    } else if (isChange) {
      interventions.push({
        workOrderId: wo.id,
        orderNumber: wo.order_number,
        date: wo.opened_at,
        kilometraje: wo.kilometraje,
        type: 'cambio',
        title: 'Recambio / Colocación de cubiertas',
        description: wo.work_performed || wo.requested_work || 'Cambio de cubiertas',
      });
    } else if (isRepair) {
      interventions.push({
        workOrderId: wo.id,
        orderNumber: wo.order_number,
        date: wo.opened_at,
        kilometraje: wo.kilometraje,
        type: 'reparacion',
        title: 'Reparación / Gomería',
        description: wo.work_performed || wo.failure_description || 'Servicio de gomería',
      });
    }
  }

  // Ordenar por fecha descendente
  interventions.sort((a, b) => b.date.localeCompare(a.date));

  const lastRotation = interventions.find((i) => i.type === 'rotacion');
  const lastAlignment = interventions.find((i) => i.type === 'alineacion_balanceo');
  const lastChange = interventions.find((i) => i.type === 'cambio');

  let kmSinceRotation: number | null = null;
  let rotationStatus: 'ok' | 'due_soon' | 'overdue' | 'sin_datos' = 'sin_datos';

  if (lastRotation?.kilometraje != null && vehicleKm != null && vehicleKm >= lastRotation.kilometraje) {
    kmSinceRotation = vehicleKm - lastRotation.kilometraje;
    if (kmSinceRotation >= 15000) {
      rotationStatus = 'overdue'; // Excedido (crítico para desgaste parejo)
    } else if (kmSinceRotation >= 10000) {
      rotationStatus = 'due_soon'; // Próximo a rotar (10.000 - 15.000 km)
    } else {
      rotationStatus = 'ok'; // En rango óptimo
    }
  } else if (vehicleKm != null && vehicleKm > 15000 && !lastRotation) {
    // Si la unidad tiene más de 15.000 km y nunca se registró una rotación
    rotationStatus = 'overdue';
  }

  return {
    lastRotationKm: lastRotation?.kilometraje ?? null,
    lastRotationDate: lastRotation?.date ?? null,
    kmSinceRotation,
    rotationStatus,
    lastAlignmentKm: lastAlignment?.kilometraje ?? null,
    lastAlignmentDate: lastAlignment?.date ?? null,
    lastChangeKm: lastChange?.kilometraje ?? null,
    lastChangeDate: lastChange?.date ?? null,
    interventions,
  };
}
