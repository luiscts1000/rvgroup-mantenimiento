import * as XLSX from 'xlsx';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { MAINTENANCE_TYPE_LABELS } from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber } from '@/lib/utils';
import type { PendingTask, Vehicle, WorkOrder } from '@/types/db';
import type { EnrichedWorkOrderItem } from '@/features/history/api';

const vfsSource = pdfFonts as unknown as { pdfMake?: { vfs: Record<string, string> }; vfs?: Record<string, string> };
(pdfMake as unknown as { vfs: Record<string, string> }).vfs = vfsSource.pdfMake?.vfs ?? vfsSource.vfs ?? {};

export interface VehicleWorkshopRank {
  vehicle_id: string;
  patente: string;
  nro_interno: string | null;
  label: string;
  totalOrders: number;
  preventiveOrders: number;
  correctiveOrders: number;
}

export interface VehicleFailureRank {
  vehicle_id: string;
  patente: string;
  nro_interno: string | null;
  label: string;
  correctiveOrders: number;
  pendingCount: number;
  totalFailures: number;
}

export interface FrequentFailureItem {
  category: string;
  count: number;
}

export interface VehicleExpenseItem {
  vehicle_id: string;
  patente: string;
  nro_interno: string | null;
  label: string;
  partsCost: number;
  laborCost: number;
  totalCost: number;
  ordersCount: number;
  km_actual: number | null;
  cpk: number | null; // Costo por kilómetro ($ / km)
}

export interface MonthlyExpenseItem {
  month: string; // YYYY-MM
  monthLabel: string;
  partsCost: number;
  laborCost: number;
  totalCost: number;
  ordersOpened: number;
  ordersClosed: number;
}

export interface TopPartUsedItem {
  key: string;
  part_code: string;
  description: string;
  unit: string;
  totalQuantity: number;
  totalCost: number;
  ordersCount: number;
}

export interface MaintenanceTypeDistribution {
  type: string;
  label: string;
  count: number;
}

export interface FleetAnalyticsResult {
  totalCost: number;
  totalPartsCost: number;
  totalLaborCost: number;
  totalOrders: number;
  completedOrders: number;
  totalFailures: number;
  totalFleetKm: number;
  averageFleetCpk: number | null; // CPK promedio de la flota ($ / km)
  topWorkshopEntries: VehicleWorkshopRank[];
  topFailureVehicles: VehicleFailureRank[];
  frequentFailures: FrequentFailureItem[];
  expensesByVehicle: VehicleExpenseItem[];
  monthlySeries: MonthlyExpenseItem[];
  topPartsUsed: TopPartUsedItem[];
  byMaintenanceType: MaintenanceTypeDistribution[];
}

export function classifyFailureCategory(text: string): string {
  const low = text.toLowerCase();
  if (/freno|pastilla|disco|cinta|campana/.test(low)) return 'Frenos';
  if (/cubierta|neum[aá]tic|llanta|gom[ae]r|alineaci|balanceo/.test(low)) return 'Cubiertas y neumáticos';
  if (/amortiguador|suspensi[oó]n|tren delantero|extremo|buje|parrilla|rotula|r[oó]tula|el[aá]stico/.test(low))
    return 'Suspensión y tren delantero';
  if (/parabrisas|luneta|cristal|escobilla/.test(low)) return 'Parabrisas y cristales';
  if (/aire acondicionado|calefacci[oó]n|compresor a\/a/.test(low)) return 'Aire acondicionado';
  if (/el[eé]ctric|bater[ií]a|alternador|arranque|luz|luces|faro|fusible/.test(low)) return 'Electricidad y luces';
  if (/tac[oó]grafo/.test(low)) return 'Tacógrafo';
  if (/refrigeraci[oó]n|radiador|bomba de agua|termostato|manguera/.test(low)) return 'Refrigeración';
  if (/motor|inyecci[oó]n|embrague|caja|transmisi[oó]n|correa|distribuci[oó]n|turbo/.test(low))
    return 'Motor y transmisión';
  if (/rto|revisi[oó]n t[eé]cnica|matafuego|seguridad|cintur[oó]n/.test(low)) return 'Preparación RTO y seguridad';
  if (/aceite|filtro|service|servicio/.test(low)) return 'Service y lubricación';
  return 'Otras reparaciones mecánicas';
}

const MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const idx = Number(m) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${y}`;
}

export function computeFleetAnalytics(params: {
  vehicles: Vehicle[];
  workOrders: WorkOrder[];
  items: EnrichedWorkOrderItem[];
  pendingTasks: PendingTask[];
}): FleetAnalyticsResult {
  const { vehicles, workOrders, items, pendingTasks } = params;
  const vehMap = new Map<string, Vehicle>();
  for (const v of vehicles) vehMap.set(v.id, v);

  const itemsCostByWo = new Map<string, number>();
  let totalPartsCost = 0;

  for (const it of items) {
    if (it.unit_cost != null) {
      const sub = Number(it.quantity) * Number(it.unit_cost);
      totalPartsCost += sub;
      itemsCostByWo.set(it.work_order_id, (itemsCostByWo.get(it.work_order_id) ?? 0) + sub);
    }
  }

  let totalLaborCost = 0;
  let completedOrders = 0;

  const workshopByVeh = new Map<string, VehicleWorkshopRank>();
  const failureByVeh = new Map<string, VehicleFailureRank>();
  const expenseByVeh = new Map<string, VehicleExpenseItem>();
  const monthlyMap = new Map<string, MonthlyExpenseItem>();
  const failureCategoryMap = new Map<string, number>();
  const maintTypeMap = new Map<string, number>();

  const ensureVehMeta = (vehicleId: string, fallbackPatente: string, fallbackInterno: string | null) => {
    const v = vehMap.get(vehicleId);
    const patente = formatPatente(v?.patente ?? fallbackPatente);
    const nro_interno = v?.nro_interno ?? fallbackInterno;
    const label = [v?.marca, v?.modelo, v?.version].filter(Boolean).join(' ') || patente;
    return { patente, nro_interno, label };
  };

  const ensureMonth = (ym: string) => {
    if (!monthlyMap.has(ym)) {
      monthlyMap.set(ym, {
        month: ym,
        monthLabel: formatMonthLabel(ym),
        partsCost: 0,
        laborCost: 0,
        totalCost: 0,
        ordersOpened: 0,
        ordersClosed: 0,
      });
    }
    return monthlyMap.get(ym)!;
  };

  for (const wo of workOrders) {
    const meta = ensureVehMeta(wo.vehicle_id, wo.patente, wo.nro_interno);
    const pCost = itemsCostByWo.get(wo.id) ?? 0;
    const lCost = Number(wo.labor_cost ?? 0);
    totalLaborCost += lCost;

    if (wo.status === 'finalizada' || wo.status === 'cerrada') {
      completedOrders++;
    }

    // 1. Ingresos al taller
    const wRank = workshopByVeh.get(wo.vehicle_id) ?? {
      vehicle_id: wo.vehicle_id,
      patente: meta.patente,
      nro_interno: meta.nro_interno,
      label: meta.label,
      totalOrders: 0,
      preventiveOrders: 0,
      correctiveOrders: 0,
    };
    wRank.totalOrders++;
    if (wo.maintenance_type === 'preventivo') wRank.preventiveOrders++;
    else wRank.correctiveOrders++;
    workshopByVeh.set(wo.vehicle_id, wRank);

    // 2. Fallas por unidad (cuando es correctivo / emergencia o tiene falla reportada)
    if (wo.maintenance_type === 'correctivo' || wo.maintenance_type === 'emergencia' || wo.failure_description) {
      const fRank = failureByVeh.get(wo.vehicle_id) ?? {
        vehicle_id: wo.vehicle_id,
        patente: meta.patente,
        nro_interno: meta.nro_interno,
        label: meta.label,
        correctiveOrders: 0,
        pendingCount: 0,
        totalFailures: 0,
      };
      fRank.correctiveOrders++;
      fRank.totalFailures++;
      failureByVeh.set(wo.vehicle_id, fRank);

      const cat = classifyFailureCategory(
        [wo.failure_description, wo.requested_work, wo.work_performed].filter(Boolean).join(' '),
      );
      failureCategoryMap.set(cat, (failureCategoryMap.get(cat) ?? 0) + 1);
    }

    // 3. Gastos por unidad
    const exp = expenseByVeh.get(wo.vehicle_id) ?? {
      vehicle_id: wo.vehicle_id,
      patente: meta.patente,
      nro_interno: meta.nro_interno,
      label: meta.label,
      partsCost: 0,
      laborCost: 0,
      totalCost: 0,
      ordersCount: 0,
      km_actual: null,
      cpk: null,
    };
    exp.partsCost += pCost;
    exp.laborCost += lCost;
    exp.totalCost += pCost + lCost;
    exp.ordersCount++;
    expenseByVeh.set(wo.vehicle_id, exp);

    // 4. Evolución mensual
    const openYm = wo.opened_at.slice(0, 7);
    const mEntry = ensureMonth(openYm);
    mEntry.ordersOpened++;
    mEntry.partsCost += pCost;
    mEntry.laborCost += lCost;
    mEntry.totalCost += pCost + lCost;

    if (wo.closed_at) {
      const closeYm = wo.closed_at.slice(0, 7);
      ensureMonth(closeYm).ordersClosed++;
    } else if (wo.status === 'finalizada' || wo.status === 'cerrada') {
      mEntry.ordersClosed++;
    }

    // 5. Tipo de mantenimiento
    maintTypeMap.set(wo.maintenance_type, (maintTypeMap.get(wo.maintenance_type) ?? 0) + 1);
  }

  // Sumar pendientes detectados (que no estén duplicados con una OR ya contada) al ranking de fallas y fallas frecuentes
  for (const p of pendingTasks) {
    if (p.work_order_id) continue; // ya contabilizado en su OR vinculada
    const meta = ensureVehMeta(p.vehicle_id, p.patente, p.nro_interno);
    const fRank = failureByVeh.get(p.vehicle_id) ?? {
      vehicle_id: p.vehicle_id,
      patente: meta.patente,
      nro_interno: meta.nro_interno,
      label: meta.label,
      correctiveOrders: 0,
      pendingCount: 0,
      totalFailures: 0,
    };
    fRank.pendingCount++;
    fRank.totalFailures++;
    failureByVeh.set(p.vehicle_id, fRank);

    const cat = classifyFailureCategory(`${p.task_title} ${p.description ?? ''}`);
    failureCategoryMap.set(cat, (failureCategoryMap.get(cat) ?? 0) + 1);
  }

  // 6. Repuestos más utilizados
  const partsMap = new Map<string, TopPartUsedItem>();
  for (const it of items) {
    const key = (it.part_code || it.description).trim().toUpperCase();
    const existing = partsMap.get(key) ?? {
      key,
      part_code: it.part_code || '—',
      description: it.description,
      unit: it.unit,
      totalQuantity: 0,
      totalCost: 0,
      ordersCount: 0,
    };
    existing.totalQuantity += Number(it.quantity);
    if (it.unit_cost != null) {
      existing.totalCost += Number(it.quantity) * Number(it.unit_cost);
    }
    existing.ordersCount++;
    partsMap.set(key, existing);
  }

  const topWorkshopEntries = Array.from(workshopByVeh.values()).sort((a, b) => b.totalOrders - a.totalOrders);
  const topFailureVehicles = Array.from(failureByVeh.values()).sort((a, b) => b.totalFailures - a.totalFailures);
  const frequentFailures = Array.from(failureCategoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
  const expensesByVehicle = Array.from(expenseByVeh.values())
    .map((e) => {
      const v = vehMap.get(e.vehicle_id);
      const km = v?.km_actual ?? null;
      const roundedTotal = Math.round(e.totalCost);
      const cpk = km && km > 0 && roundedTotal > 0 ? Number((roundedTotal / km).toFixed(2)) : null;
      return {
        ...e,
        partsCost: Math.round(e.partsCost),
        laborCost: Math.round(e.laborCost),
        totalCost: roundedTotal,
        km_actual: km,
        cpk,
      };
    })
    .sort((a, b) => b.totalCost - a.totalCost);

  const monthlySeries = Array.from(monthlyMap.values())
    .map((m) => ({
      ...m,
      partsCost: Math.round(m.partsCost),
      laborCost: Math.round(m.laborCost),
      totalCost: Math.round(m.totalCost),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const topPartsUsed = Array.from(partsMap.values())
    .map((p) => ({
      ...p,
      totalQuantity: Math.round(p.totalQuantity * 100) / 100,
      totalCost: Math.round(p.totalCost),
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  const byMaintenanceType: MaintenanceTypeDistribution[] = Array.from(maintTypeMap.entries())
    .map(([type, count]) => ({
      type,
      label: MAINTENANCE_TYPE_LABELS[type as keyof typeof MAINTENANCE_TYPE_LABELS] ?? type,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const totalFailures = topFailureVehicles.reduce((acc, f) => acc + f.totalFailures, 0);
  const totalCost = Math.round(totalPartsCost + totalLaborCost);
  const totalFleetKm = Array.from(vehMap.values()).reduce((acc, v) => acc + (Number(v.km_actual) || 0), 0);
  const averageFleetCpk = totalFleetKm > 0 && totalCost > 0 ? Number((totalCost / totalFleetKm).toFixed(2)) : null;

  return {
    totalCost,
    totalPartsCost: Math.round(totalPartsCost),
    totalLaborCost: Math.round(totalLaborCost),
    totalOrders: workOrders.length,
    completedOrders,
    totalFailures,
    totalFleetKm,
    averageFleetCpk,
    topWorkshopEntries,
    topFailureVehicles,
    frequentFailures,
    expensesByVehicle,
    monthlySeries,
    topPartsUsed,
    byMaintenanceType,
  };
}

export function exportAnalyticsToExcel(analytics: FleetAnalyticsResult, periodLabel: string) {
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    { Indicador: 'Período analizado', Valor: periodLabel },
    { Indicador: 'Órdenes de reparación totales', Valor: analytics.totalOrders },
    { Indicador: 'Órdenes finalizadas / cerradas', Valor: analytics.completedOrders },
    { Indicador: 'Fallas y novedades registradas', Valor: analytics.totalFailures },
    { Indicador: 'Costo total en repuestos ($)', Valor: analytics.totalPartsCost },
    { Indicador: 'Costo total en mano de obra ($)', Valor: analytics.totalLaborCost },
    { Indicador: 'Gasto total de mantenimiento ($)', Valor: analytics.totalCost },
    { Indicador: 'Kilometraje total acumulado flota (km)', Valor: analytics.totalFleetKm },
    { Indicador: 'Costo promedio por kilómetro - CPK ($/km)', Valor: analytics.averageFleetCpk ?? '—' },
  ];

  const expRows = analytics.expensesByVehicle.map((e) => ({
    Patente: e.patente,
    'N° Interno': e.nro_interno ?? '',
    Unidad: e.label,
    'Km Actual': e.km_actual ?? '',
    'CPK ($/km)': e.cpk ?? '',
    'Cantidad OR': e.ordersCount,
    'Costo Repuestos ($)': e.partsCost,
    'Mano de Obra ($)': e.laborCost,
    'Gasto Total ($)': e.totalCost,
  }));

  const monthRows = analytics.monthlySeries.map((m) => ({
    Mes: m.monthLabel,
    'OR Abiertas': m.ordersOpened,
    'OR Finalizadas': m.ordersClosed,
    'Costo Repuestos ($)': m.partsCost,
    'Mano de Obra ($)': m.laborCost,
    'Gasto Total ($)': m.totalCost,
  }));

  const workshopRows = analytics.topWorkshopEntries.map((w) => ({
    Patente: w.patente,
    'N° Interno': w.nro_interno ?? '',
    Unidad: w.label,
    'Total Ingresos (OR)': w.totalOrders,
    Preventivos: w.preventiveOrders,
    'Correctivos / Otros': w.correctiveOrders,
  }));

  const failVehRows = analytics.topFailureVehicles.map((f) => ({
    Patente: f.patente,
    'N° Interno': f.nro_interno ?? '',
    Unidad: f.label,
    'OR Correctivas / Fallas': f.correctiveOrders,
    'Pendientes adicionales': f.pendingCount,
    'Total Fallas': f.totalFailures,
  }));

  const freqFailRows = analytics.frequentFailures.map((f) => ({
    'Rubro / Tipo de falla': f.category,
    Cantidad: f.count,
  }));

  const partsRows = analytics.topPartsUsed.map((p) => ({
    Código: p.part_code,
    Descripción: p.description,
    'Cantidad Total': p.totalQuantity,
    Unidad: p.unit,
    'Órdenes en que se usó': p.ordersCount,
    'Costo Acumulado ($)': p.totalCost,
  }));

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Resumen Ejecutivo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows), 'Gastos por Unidad');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(monthRows), 'Gastos Mensuales');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(workshopRows), 'Mas Ingresos Taller');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(failVehRows), 'Unidades Mas Fallas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(freqFailRows), 'Fallas Frecuentes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(partsRows), 'Repuestos Mas Usados');

  XLSX.writeFile(wb, `Reporte_Estadistico_RVGroup_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

async function loadLogoDataUrl(): Promise<string | null> {
  for (const path of ['/logo-rvgroup.png', '/icons/icon-192.png']) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) continue;
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      /* continúa */
    }
  }
  return null;
}

export async function generateFleetReportPdf(analytics: FleetAnalyticsResult, periodLabel: string) {
  const logoDataUrl = await loadLogoDataUrl();

  const sectionTitle = (title: string): Content => ({
    text: title.toUpperCase(),
    fontSize: 9,
    bold: true,
    color: '#0f4c5c',
    margin: [0, 10, 0, 4],
  });

  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [30, 28, 30, 36],
    info: {
      title: 'Reporte Estadístico de Mantenimiento - RV GROUP SRL',
      author: 'RV GROUP SRL',
    },
    content: [
      {
        columns: [
          logoDataUrl
            ? { image: logoDataUrl, width: 48, margin: [0, 0, 10, 0] }
            : { text: 'RV GROUP', fontSize: 16, bold: true, color: '#0f4c5c', width: 85 },
          {
            stack: [
              { text: 'RV GROUP SRL', fontSize: 13, bold: true, color: '#0f4c5c' },
              { text: 'REPORTE ESTADÍSTICO Y ECONÓMICO DE MANTENIMIENTO', fontSize: 9, bold: true, color: '#334155' },
              { text: `Período: ${periodLabel}`, fontSize: 8.5, color: '#64748b' },
            ],
          },
          {
            alignment: 'right',
            stack: [
              { text: `Fecha: ${formatDate(new Date().toISOString())}`, fontSize: 8.5, color: '#475569' },
              { text: `Total OR: ${analytics.totalOrders}`, fontSize: 9, bold: true, color: '#0f4c5c' },
              { text: `Inversión Total: $ ${formatNumber(analytics.totalCost)}`, fontSize: 9, bold: true, color: '#0f4c5c' },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 535, y2: 6, lineWidth: 1.4, lineColor: '#0f4c5c' }], margin: [0, 0, 0, 8] },

      sectionTitle('1. Indicadores Generales del Período'),
      {
        table: {
          widths: ['*', '*', '*', '*'],
          body: [
            [
              { text: `Órdenes totales: ${analytics.totalOrders}`, fontSize: 8.5, bold: true, margin: [4, 4, 4, 4] },
              { text: `Finalizadas: ${analytics.completedOrders}`, fontSize: 8.5, bold: true, margin: [4, 4, 4, 4] },
              { text: `Repuestos: $ ${formatNumber(analytics.totalPartsCost)}`, fontSize: 8.5, bold: true, margin: [4, 4, 4, 4] },
              { text: `Mano de obra: $ ${formatNumber(analytics.totalLaborCost)}`, fontSize: 8.5, bold: true, margin: [4, 4, 4, 4] },
            ],
          ],
        },
        layout: { hLineColor: () => '#cbd5e1', vLineColor: () => '#cbd5e1' },
      },

      sectionTitle('2. Gastos Acumulados por Unidad'),
      analytics.expensesByVehicle.length > 0
        ? {
            table: {
              headerRows: 1,
              widths: [65, 55, '*', 45, 75, 75, 80],
              body: [
                [
                  { text: 'PATENTE', style: 'th' },
                  { text: 'INTERNO', style: 'th' },
                  { text: 'UNIDAD', style: 'th' },
                  { text: 'ORs', style: 'th', alignment: 'right' },
                  { text: 'REPUESTOS', style: 'th', alignment: 'right' },
                  { text: 'M. OBRA', style: 'th', alignment: 'right' },
                  { text: 'TOTAL ($)', style: 'th', alignment: 'right' },
                ],
                ...analytics.expensesByVehicle.slice(0, 25).map((e) => [
                  { text: e.patente, fontSize: 8, bold: true },
                  { text: e.nro_interno || '—', fontSize: 8 },
                  { text: e.label, fontSize: 8 },
                  { text: String(e.ordersCount), fontSize: 8, alignment: 'right' as const },
                  { text: `$ ${formatNumber(e.partsCost)}`, fontSize: 8, alignment: 'right' as const },
                  { text: `$ ${formatNumber(e.laborCost)}`, fontSize: 8, alignment: 'right' as const },
                  { text: `$ ${formatNumber(e.totalCost)}`, fontSize: 8, bold: true, alignment: 'right' as const },
                ]),
              ],
            },
            layout: 'lightHorizontalLines',
          }
        : { text: 'Sin gastos registrados.', fontSize: 8.5, color: '#64748b' },

      sectionTitle('3. Evolución Mensual de Gastos y Reparaciones'),
      analytics.monthlySeries.length > 0
        ? {
            table: {
              headerRows: 1,
              widths: ['*', 65, 65, 85, 85, 90],
              body: [
                [
                  { text: 'MES', style: 'th' },
                  { text: 'OR ABIERTAS', style: 'th', alignment: 'right' },
                  { text: 'OR CERRADAS', style: 'th', alignment: 'right' },
                  { text: 'REPUESTOS ($)', style: 'th', alignment: 'right' },
                  { text: 'MANO OBRA ($)', style: 'th', alignment: 'right' },
                  { text: 'GASTO MES ($)', style: 'th', alignment: 'right' },
                ],
                ...analytics.monthlySeries.map((m) => [
                  { text: m.monthLabel, fontSize: 8, bold: true },
                  { text: String(m.ordersOpened), fontSize: 8, alignment: 'right' as const },
                  { text: String(m.ordersClosed), fontSize: 8, alignment: 'right' as const },
                  { text: `$ ${formatNumber(m.partsCost)}`, fontSize: 8, alignment: 'right' as const },
                  { text: `$ ${formatNumber(m.laborCost)}`, fontSize: 8, alignment: 'right' as const },
                  { text: `$ ${formatNumber(m.totalCost)}`, fontSize: 8, bold: true, alignment: 'right' as const },
                ]),
              ],
            },
            layout: 'lightHorizontalLines',
          }
        : { text: 'Sin serie mensual disponible.', fontSize: 8.5, color: '#64748b' },

      sectionTitle('4. Vehículos con Más Ingresos al Taller y Mayor Cantidad de Fallas'),
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Más ingresos al taller', fontSize: 8, bold: true, margin: [0, 0, 0, 3] },
              analytics.topWorkshopEntries.length > 0
                ? {
                    table: {
                      headerRows: 1,
                      widths: [55, '*', 35, 35],
                      body: [
                        [
                          { text: 'PATENTE', style: 'th' },
                          { text: 'UNIDAD', style: 'th' },
                          { text: 'PREV.', style: 'th', alignment: 'right' },
                          { text: 'TOTAL', style: 'th', alignment: 'right' },
                        ],
                        ...analytics.topWorkshopEntries.slice(0, 12).map((w) => [
                          { text: w.patente, fontSize: 7.5, bold: true },
                          { text: w.label, fontSize: 7.5 },
                          { text: String(w.preventiveOrders), fontSize: 7.5, alignment: 'right' as const },
                          { text: String(w.totalOrders), fontSize: 7.5, bold: true, alignment: 'right' as const },
                        ]),
                      ],
                    },
                    layout: 'lightHorizontalLines',
                  }
                : { text: 'Sin datos.', fontSize: 8, color: '#64748b' },
            ],
          },
          { width: 14, text: '' },
          {
            width: '*',
            stack: [
              { text: 'Mayor cantidad de fallas', fontSize: 8, bold: true, margin: [0, 0, 0, 3] },
              analytics.topFailureVehicles.length > 0
                ? {
                    table: {
                      headerRows: 1,
                      widths: [55, '*', 40, 40],
                      body: [
                        [
                          { text: 'PATENTE', style: 'th' },
                          { text: 'UNIDAD', style: 'th' },
                          { text: 'CORR.', style: 'th', alignment: 'right' },
                          { text: 'FALLAS', style: 'th', alignment: 'right' },
                        ],
                        ...analytics.topFailureVehicles.slice(0, 12).map((f) => [
                          { text: f.patente, fontSize: 7.5, bold: true },
                          { text: f.label, fontSize: 7.5 },
                          { text: String(f.correctiveOrders), fontSize: 7.5, alignment: 'right' as const },
                          { text: String(f.totalFailures), fontSize: 7.5, bold: true, alignment: 'right' as const },
                        ]),
                      ],
                    },
                    layout: 'lightHorizontalLines',
                  }
                : { text: 'Sin datos.', fontSize: 8, color: '#64748b' },
            ],
          },
        ],
      },

      sectionTitle('5. Fallas Más Frecuentes y Repuestos Más Utilizados'),
      {
        columns: [
          {
            width: '42%',
            stack: [
              { text: 'Fallas más frecuentes por rubro', fontSize: 8, bold: true, margin: [0, 0, 0, 3] },
              analytics.frequentFailures.length > 0
                ? {
                    table: {
                      headerRows: 1,
                      widths: ['*', 45],
                      body: [
                        [
                          { text: 'RUBRO DE FALLA', style: 'th' },
                          { text: 'CASOS', style: 'th', alignment: 'right' },
                        ],
                        ...analytics.frequentFailures.map((f) => [
                          { text: f.category, fontSize: 7.5 },
                          { text: String(f.count), fontSize: 7.5, bold: true, alignment: 'right' as const },
                        ]),
                      ],
                    },
                    layout: 'lightHorizontalLines',
                  }
                : { text: 'Sin datos.', fontSize: 8, color: '#64748b' },
            ],
          },
          { width: 14, text: '' },
          {
            width: '*',
            stack: [
              { text: 'Repuestos más utilizados', fontSize: 8, bold: true, margin: [0, 0, 0, 3] },
              analytics.topPartsUsed.length > 0
                ? {
                    table: {
                      headerRows: 1,
                      widths: [55, '*', 45, 65],
                      body: [
                        [
                          { text: 'CÓDIGO', style: 'th' },
                          { text: 'REPUESTO', style: 'th' },
                          { text: 'CANT.', style: 'th', alignment: 'right' },
                          { text: 'COSTO ($)', style: 'th', alignment: 'right' },
                        ],
                        ...analytics.topPartsUsed.slice(0, 15).map((p) => [
                          { text: p.part_code, fontSize: 7.5 },
                          { text: p.description, fontSize: 7.5 },
                          { text: `${p.totalQuantity} ${p.unit}`, fontSize: 7.5, alignment: 'right' as const },
                          { text: `$ ${formatNumber(p.totalCost)}`, fontSize: 7.5, alignment: 'right' as const },
                        ]),
                      ],
                    },
                    layout: 'lightHorizontalLines',
                  }
                : { text: 'Sin datos.', fontSize: 8, color: '#64748b' },
            ],
          },
        ],
      },
    ],
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: 'RV GROUP SRL · Reporte Estadístico de Mantenimiento Vehicular', fontSize: 7.5, color: '#94a3b8' },
        { text: `Página ${currentPage} de ${pageCount}`, alignment: 'right', fontSize: 7.5, color: '#94a3b8' },
      ],
      margin: [30, 8, 30, 0],
    }),
    styles: {
      th: { fontSize: 7.5, bold: true, color: '#0f4c5c', fillColor: '#f1f5f9', margin: [2, 2, 2, 2] },
    },
  };

  pdfMake.createPdf(def).download(`Reporte_Estadistico_RVGroup_${new Date().toISOString().slice(0, 10)}.pdf`);
}
