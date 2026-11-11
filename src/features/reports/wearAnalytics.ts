import type { WorkOrder, WorkOrderItem, Vehicle } from '@/types/db';
import type { EnrichedWorkOrderItem } from '@/features/history/api';

export type WearComponentKind = 'cubiertas' | 'frenos' | 'amortiguadores' | 'bateria' | 'embrague';

export interface ComponentBenchmark {
  kind: WearComponentKind;
  label: string;
  expectedKm: number;
  prematureThresholdKm: number;
  warningKm: number;
  unitLabel: string;
}

export const COMPONENT_BENCHMARKS: Record<WearComponentKind, ComponentBenchmark> = {
  cubiertas: {
    kind: 'cubiertas',
    label: 'Cubiertas / Neumáticos',
    expectedKm: 45000,
    prematureThresholdKm: 22000,
    warningKm: 32000,
    unitLabel: 'juego de cubiertas',
  },
  frenos: {
    kind: 'frenos',
    label: 'Pastillas y Frenos',
    expectedKm: 25000,
    prematureThresholdKm: 12000,
    warningKm: 18000,
    unitLabel: 'juego de pastillas/frenos',
  },
  amortiguadores: {
    kind: 'amortiguadores',
    label: 'Amortiguadores y Suspensión',
    expectedKm: 60000,
    prematureThresholdKm: 30000,
    warningKm: 45000,
    unitLabel: 'cambio de suspensión',
  },
  bateria: {
    kind: 'bateria',
    label: 'Batería',
    expectedKm: 50000,
    prematureThresholdKm: 20000,
    warningKm: 35000,
    unitLabel: 'batería',
  },
  embrague: {
    kind: 'embrague',
    label: 'Embrague',
    expectedKm: 90000,
    prematureThresholdKm: 40000,
    warningKm: 60000,
    unitLabel: 'kit de embrague',
  },
};

export interface ComponentReplacementEvent {
  workOrderId: string;
  orderNumber: number;
  date: string;
  kilometraje: number | null;
  detail: string;
  cost: number;
  kmSincePrevious: number | null;
  daysSincePrevious: number | null;
  isPremature: boolean;
}

export interface VehicleComponentWearStats {
  kind: WearComponentKind;
  benchmark: ComponentBenchmark;
  replacementsCount: number;
  events: ComponentReplacementEvent[];
  lastReplacementKm: number | null;
  lastReplacementDate: string | null;
  kmSinceLastReplacement: number | null;
  averageIntervalKm: number | null;
  minIntervalKm: number | null;
  totalCost: number;
  hasPrematureWear: boolean;
  status: 'critico' | 'advertencia' | 'normal' | 'sin_datos';
  diagnosticMessage: string | null;
}

export interface PrematureWearAnomaly {
  vehicleId: string;
  patente: string;
  nro_interno: string | null;
  marcaModelo: string;
  categoryName?: string;
  currentKm: number | null;
  kind: WearComponentKind;
  componentLabel: string;
  replacementsCount: number;
  totalKmSpan: number | null;
  averageIntervalKm: number | null;
  minIntervalKm: number | null;
  expectedKm: number;
  deviationPercent: number; // e.g. -55% compared to expected life
  severity: 'critico' | 'advertencia';
  summary: string;
  recommendation: string;
  totalSpent: number;
  latestEventDate: string;
}

function matchComponentKinds(text: string, partCategory?: string | null): WearComponentKind[] {
  const low = text.toLowerCase();
  const kinds = new Set<WearComponentKind>();

  if (partCategory === 'cubiertas' || /cubierta|neum[aá]tic|llanta|gom[ae]r|rodado/.test(low)) {
    // Excluir si solo fue rotación o parchado menor sin recambio de cubierta
    if (/cambio|recambio|colocaci[oó]n|nueva|nuevas|recapad|adquisici[oó]n|compra/.test(low) || partCategory === 'cubiertas') {
      kinds.add('cubiertas');
    }
  }

  if (partCategory === 'frenos' || /freno|pastilla|disco de freno|cinta|campana|bomba de freno/.test(low)) {
    if (/cambio|recambio|colocaci[oó]n|nueva|nuevas|rectificac/.test(low) || partCategory === 'frenos' || /pastilla/.test(low)) {
      kinds.add('frenos');
    }
  }

  if (
    partCategory === 'suspension' ||
    /amortiguador|suspensi[oó]n|tren delantero|extremo|buje|parrilla|rotula|r[oó]tula|espiral|el[aá]stico/.test(low)
  ) {
    if (/cambio|recambio|colocaci[oó]n|nueva|nuevos|rotura/.test(low) || partCategory === 'suspension' || /amortiguador/.test(low)) {
      kinds.add('amortiguadores');
    }
  }

  if (/bater[ií]a|acumulador/.test(low)) {
    if (/cambio|recambio|nueva|colocaci[oó]n|agotad|muerta/.test(low)) {
      kinds.add('bateria');
    }
  }

  if (/embrague|clutch|crapodina/.test(low)) {
    if (/cambio|recambio|kit|disco de embrague|patina|placa y disco/.test(low)) {
      kinds.add('embrague');
    }
  }

  return Array.from(kinds);
}

/**
 * Analiza el historial completo de una unidad para calcular la durabilidad y frecuencia
 * de recambio de cada componente clave (cubiertas, frenos, amortiguadores, etc.).
 */
export function analyzeVehicleComponentWear(
  vehicle: Vehicle,
  workOrders: WorkOrder[],
  items?: (WorkOrderItem | EnrichedWorkOrderItem)[],
): Record<WearComponentKind, VehicleComponentWearStats> {
  const rawEventsByKind: Record<WearComponentKind, Array<{
    workOrderId: string;
    orderNumber: number;
    date: string;
    kilometraje: number | null;
    detail: string;
    cost: number;
  }>> = {
    cubiertas: [],
    frenos: [],
    amortiguadores: [],
    bateria: [],
    embrague: [],
  };

  const seenWoKind = new Set<string>();

  // 1. Analizar repuestos utilizados
  if (items && items.length > 0) {
    for (const it of items) {
      const wo = 'work_orders' in it && it.work_orders ? (it.work_orders as WorkOrder) : workOrders.find((w) => w.id === it.work_order_id);
      if (!wo || wo.vehicle_id !== vehicle.id) continue;

      const sub = it.unit_cost != null ? Number(it.quantity) * Number(it.unit_cost) : 0;
      const partCat = 'parts' in it && it.parts ? (it.parts as { category?: string }).category : null;
      const kinds = matchComponentKinds(it.description, partCat);

      for (const k of kinds) {
        rawEventsByKind[k].push({
          workOrderId: wo.id,
          orderNumber: wo.order_number,
          date: wo.opened_at,
          kilometraje: wo.kilometraje,
          detail: `${it.quantity} ${it.unit} × ${it.description}${it.part_code ? ` [${it.part_code}]` : ''}`,
          cost: sub,
        });
        seenWoKind.add(`${wo.id}:${k}`);
      }
    }
  }

  // 2. Analizar descripciones en las órdenes de reparación
  for (const wo of workOrders) {
    if (wo.vehicle_id !== vehicle.id) continue;
    const text = [wo.requested_work, wo.work_performed, wo.failure_description, wo.diagnosis].filter(Boolean).join(' ');
    const kinds = matchComponentKinds(text);

    for (const k of kinds) {
      if (seenWoKind.has(`${wo.id}:${k}`)) continue;
      rawEventsByKind[k].push({
        workOrderId: wo.id,
        orderNumber: wo.order_number,
        date: wo.opened_at,
        kilometraje: wo.kilometraje,
        detail: wo.work_performed || wo.requested_work || wo.failure_description || 'Servicio registrado en orden',
        cost: Number(wo.labor_cost ?? 0),
      });
      seenWoKind.add(`${wo.id}:${k}`);
    }
  }

  const result = {} as Record<WearComponentKind, VehicleComponentWearStats>;

  // Procesar intervalos cronológicos y por kilometraje
  for (const k of Object.keys(COMPONENT_BENCHMARKS) as WearComponentKind[]) {
    const bench = COMPONENT_BENCHMARKS[k];
    const raw = rawEventsByKind[k];

    // Ordenar de más antiguo a más reciente para calcular intervalos
    raw.sort((a, b) => a.date.localeCompare(b.date));

    const events: ComponentReplacementEvent[] = [];
    const intervalsKm: number[] = [];
    let totalCost = 0;

    for (let i = 0; i < raw.length; i++) {
      const cur = raw[i];
      totalCost += cur.cost;
      let kmSincePrev: number | null = null;
      let daysSincePrev: number | null = null;
      let isPremature = false;

      if (i > 0) {
        const prev = raw[i - 1];
        if (cur.kilometraje != null && prev.kilometraje != null && cur.kilometraje >= prev.kilometraje) {
          kmSincePrev = cur.kilometraje - prev.kilometraje;
          intervalsKm.push(kmSincePrev);
          if (kmSincePrev <= bench.prematureThresholdKm) {
            isPremature = true;
          }
        }
        const dCur = new Date(cur.date).getTime();
        const dPrev = new Date(prev.date).getTime();
        daysSincePrev = Math.round((dCur - dPrev) / (1000 * 60 * 60 * 24));
      }

      events.push({
        ...cur,
        kmSincePrevious: kmSincePrev,
        daysSincePrevious: daysSincePrev,
        isPremature,
      });
    }

    // Invertir a orden descendente (más reciente primero) para presentación
    events.reverse();

    const lastEvent = events[0] ?? null;
    const kmSinceLast =
      lastEvent?.kilometraje != null && vehicle.km_actual != null && vehicle.km_actual >= lastEvent.kilometraje
        ? vehicle.km_actual - lastEvent.kilometraje
        : null;

    const avgInterval =
      intervalsKm.length > 0
        ? Math.round(intervalsKm.reduce((a, b) => a + b, 0) / intervalsKm.length)
        : null;

    const minInterval = intervalsKm.length > 0 ? Math.min(...intervalsKm) : null;

    let hasPrematureWear = events.some((e) => e.isPremature);
    let status: 'critico' | 'advertencia' | 'normal' | 'sin_datos' = 'sin_datos';
    let diagnosticMessage: string | null = null;

    if (events.length === 0) {
      status = 'sin_datos';
    } else if (hasPrematureWear || (minInterval != null && minInterval <= bench.prematureThresholdKm)) {
      status = 'critico';
      diagnosticMessage = `🚨 Desgaste anómalo detectado: se registró recambio en solo ${minInterval != null ? minInterval.toLocaleString() : ''} km (esperado: ${bench.expectedKm.toLocaleString()} km).`;
    } else if (avgInterval != null && avgInterval <= bench.warningKm) {
      status = 'advertencia';
      diagnosticMessage = `⚠️ Durabilidad reducida: promedio de ${avgInterval.toLocaleString()} km entre recambios (esperado: ${bench.expectedKm.toLocaleString()} km).`;
    } else if (events.length >= 2 && vehicle.km_actual && (vehicle.km_actual / events.length) <= bench.warningKm) {
      status = 'advertencia';
      diagnosticMessage = `⚠️ Frecuencia elevada: ${events.length} recambios en ${vehicle.km_actual.toLocaleString()} km totales.`;
    } else {
      status = 'normal';
    }

    result[k] = {
      kind: k,
      benchmark: bench,
      replacementsCount: events.length,
      events,
      lastReplacementKm: lastEvent?.kilometraje ?? null,
      lastReplacementDate: lastEvent?.date ?? null,
      kmSinceLastReplacement: kmSinceLast,
      averageIntervalKm: avgInterval,
      minIntervalKm: minInterval,
      totalCost: Math.round(totalCost),
      hasPrematureWear,
      status,
      diagnosticMessage,
    };
  }

  return result;
}

/**
 * Escanea toda la flota y detecta anomalías de desgaste prematuro (por ejemplo, unidades
 * que cambiaron 2 veces cubiertas en menos de 30.000 km, pastillas en menos de 12.000 km, etc.)
 */
export function detectFleetWearAnomalies(params: {
  vehicles: Vehicle[];
  workOrders: WorkOrder[];
  items?: (WorkOrderItem | EnrichedWorkOrderItem)[];
}): PrematureWearAnomaly[] {
  const { vehicles, workOrders, items } = params;
  const anomalies: PrematureWearAnomaly[] = [];

  for (const v of vehicles) {
    if (v.status === 'baja') continue;
    const vWos = workOrders.filter((w) => w.vehicle_id === v.id);
    if (vWos.length === 0) continue;

    const wearStats = analyzeVehicleComponentWear(v, vWos, items);

    for (const k of Object.keys(wearStats) as WearComponentKind[]) {
      const stat = wearStats[k];
      const bench = stat.benchmark;

      // Criterio 1: Se registró un intervalo entre cambios menor al umbral de desgaste prematuro
      const hasShortInterval = stat.minIntervalKm != null && stat.minIntervalKm <= bench.prematureThresholdKm;

      // Criterio 2: Múltiples recambios (ej. 2 o más) en poco kilometraje total de la camioneta
      const multipleChangesInLowKm =
        stat.replacementsCount >= 2 &&
        v.km_actual != null &&
        v.km_actual > 0 &&
        (v.km_actual / stat.replacementsCount) <= bench.warningKm;

      // Criterio 3: Frecuencia promedio muy baja
      const hasLowAverage = stat.averageIntervalKm != null && stat.averageIntervalKm <= bench.warningKm;

      if (hasShortInterval || multipleChangesInLowKm || hasLowAverage) {
        const severity: 'critico' | 'advertencia' =
          hasShortInterval || (stat.averageIntervalKm != null && stat.averageIntervalKm <= bench.prematureThresholdKm)
            ? 'critico'
            : 'advertencia';

        const effectiveInterval = stat.minIntervalKm ?? stat.averageIntervalKm ?? (v.km_actual ? Math.round(v.km_actual / stat.replacementsCount) : bench.expectedKm);
        const deviationPercent = Math.round(((effectiveInterval - bench.expectedKm) / bench.expectedKm) * 100);

        let recommendation = '';
        if (k === 'cubiertas') {
          recommendation = 'Revisar urgente alineación/comba, presiones de inflado, amortiguadores y hábitos de frenado/conducción del chofer asignado.';
        } else if (k === 'frenos') {
          recommendation = 'Verificar cáliper trabado, retorno de pistones, calidad del compuesto de pastillas o costumbre de apoyar el pie en el freno.';
        } else if (k === 'amortiguadores') {
          recommendation = 'Inspeccionar tren delantero completo (bujes, extremos, cazoletas), estado de caminos del servicio y evitar sobrecarga de la unidad.';
        } else if (k === 'bateria') {
          recommendation = 'Revisar voltaje de carga del alternador, regulador de voltaje y medir posibles consumos eléctricos parásitos en reposo.';
        } else if (k === 'embrague') {
          recommendation = 'Capacitar al conductor para evitar retención en pendientes con embrague y verificar bombín de accionamiento hidráulico.';
        }

        anomalies.push({
          vehicleId: v.id,
          patente: v.patente,
          nro_interno: v.nro_interno,
          marcaModelo: `${v.marca} ${v.modelo} ${v.version || ''}`.trim(),
          categoryName: v.vehicle_categories?.name,
          currentKm: v.km_actual,
          kind: k,
          componentLabel: bench.label,
          replacementsCount: stat.replacementsCount,
          totalKmSpan: v.km_actual,
          averageIntervalKm: stat.averageIntervalKm,
          minIntervalKm: stat.minIntervalKm,
          expectedKm: bench.expectedKm,
          deviationPercent,
          severity,
          summary: `${stat.replacementsCount} recambios registrados (intervalo: cada ${effectiveInterval.toLocaleString()} km vs ${bench.expectedKm.toLocaleString()} km esperados)`,
          recommendation,
          totalSpent: stat.totalCost,
          latestEventDate: stat.lastReplacementDate || '',
        });
      }
    }
  }

  // Ordenar primero las críticas y luego por mayor desviación negativa
  return anomalies.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critico' ? -1 : 1;
    return a.deviationPercent - b.deviationPercent;
  });
}
