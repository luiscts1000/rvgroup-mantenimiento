import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import {
  APPOINTMENT_STATUS_LABELS,
  formatOrderNumber,
  MAINTENANCE_TYPE_LABELS,
  PENDING_STATUS_LABELS,
  STATUS_LABELS,
  WO_STATUS_LABELS,
} from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber } from '@/lib/utils';
import type { Appointment, PendingTask, PreventiveInspection, Vehicle, WorkOrder } from '@/types/db';
import type { EnrichedWorkOrderItem, KeyInterventionRecord } from './api';

const vfsSource = pdfFonts as unknown as { pdfMake?: { vfs: Record<string, string> }; vfs?: Record<string, string> };
(pdfMake as unknown as { vfs: Record<string, string> }).vfs = vfsSource.pdfMake?.vfs ?? vfsSource.vfs ?? {};

async function loadLogoDataUrl(): Promise<string | null> {
  for (const path of ['/logo-rvgroup.png', '/logo-rvgroup.png.png', '/icons/icon-192.png']) {
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

export async function generateVehicleHistoryPdf(params: {
  vehicle: Vehicle | null;
  workOrders: WorkOrder[];
  items: EnrichedWorkOrderItem[];
  interventions: KeyInterventionRecord[];
  pendingTasks: PendingTask[];
  appointments: Appointment[];
  inspections: PreventiveInspection[];
}) {
  const { vehicle, workOrders, items, interventions, pendingTasks, appointments, inspections } = params;
  const logoDataUrl = await loadLogoDataUrl();

  const itemsCostByWo = new Map<string, number>();
  let totalPartsCost = 0;
  for (const it of items) {
    if (it.unit_cost != null) {
      const sub = Number(it.quantity) * Number(it.unit_cost);
      totalPartsCost += sub;
      itemsCostByWo.set(it.work_order_id, (itemsCostByWo.get(it.work_order_id) ?? 0) + sub);
    }
  }
  const totalLaborCost = workOrders.reduce((acc, w) => acc + Number(w.labor_cost ?? 0), 0);
  const grandTotal = totalPartsCost + totalLaborCost;

  const kv = (label: string, val: string) => ({
    stack: [
      { text: label.toUpperCase(), fontSize: 7.5, color: '#64748b', bold: true },
      { text: val || '—', fontSize: 9.5, color: '#0f172a', margin: [0, 1, 0, 0] as [number, number, number, number] },
    ],
    margin: [0, 2, 0, 3] as [number, number, number, number],
  });

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
      title: vehicle
        ? `Historial Mantenimiento - ${formatPatente(vehicle.patente)} - RV GROUP SRL`
        : 'Historial General de Mantenimiento - RV GROUP SRL',
      author: 'RV GROUP SRL - Mantenimiento Vehicular',
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
              { text: 'FICHA HISTÓRICA DE MANTENIMIENTO VEHICULAR', fontSize: 9, bold: true, color: '#334155' },
              {
                text: vehicle
                  ? `Unidad: ${formatPatente(vehicle.patente)}${vehicle.nro_interno ? ` · Interno ${vehicle.nro_interno}` : ''} · ${[vehicle.marca, vehicle.modelo, vehicle.version].filter(Boolean).join(' ')}`
                  : 'Alcance: Todas las unidades filtradas de la flota',
                fontSize: 8.5,
                color: '#64748b',
              },
            ],
          },
          {
            alignment: 'right',
            stack: [
              { text: `Emitido: ${formatDate(new Date().toISOString())}`, fontSize: 8.5, color: '#475569' },
              { text: `Órdenes: ${workOrders.length}`, fontSize: 9, bold: true, color: '#0f4c5c' },
              { text: `Total invertido: $ ${formatNumber(Math.round(grandTotal))}`, fontSize: 9, bold: true, color: '#0f4c5c' },
            ],
          },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 535, y2: 6, lineWidth: 1.4, lineColor: '#0f4c5c' }], margin: [0, 0, 0, 8] },

      ...(vehicle
        ? [
            {
              table: {
                widths: ['*', '*', '*', '*'],
                body: [
                  [
                    kv('Patente', formatPatente(vehicle.patente)),
                    kv('N° Interno', vehicle.nro_interno || '—'),
                    kv('Marca / Modelo / Versión', [vehicle.marca, vehicle.modelo, vehicle.version].filter(Boolean).join(' ') || '—'),
                    kv('Estado actual', STATUS_LABELS[vehicle.status]),
                  ],
                  [
                    kv('Año', vehicle.anio ? String(vehicle.anio) : '—'),
                    kv('Kilometraje actual', vehicle.km_actual != null ? `${formatNumber(vehicle.km_actual)} km` : '—'),
                    kv('Medida cubiertas', vehicle.tire_type_size || '—'),
                    kv('Vencimiento RTO', vehicle.rto_due_date ? formatDate(vehicle.rto_due_date) : '—'),
                  ],
                ],
              },
              layout: { hLineColor: () => '#e2e8f0', vLineColor: () => '#e2e8f0' },
            } as Content,
          ]
        : []),

      // Resumen económico y operativo
      sectionTitle('Resumen acumulado de mantenimiento y gastos'),
      {
        table: {
          widths: ['*', '*', '*', '*'],
          body: [
            [
              kv('Órdenes de reparación', `${workOrders.length} registradas`),
              kv('Repuestos utilizados', `${items.length} ítems ($ ${formatNumber(Math.round(totalPartsCost))})`),
              kv('Mano de obra acumulada', `$ ${formatNumber(Math.round(totalLaborCost))}`),
              kv('Gasto total acumulado', `$ ${formatNumber(Math.round(grandTotal))}`),
            ],
          ],
        },
        layout: { hLineColor: () => '#cbd5e1', vLineColor: () => '#cbd5e1' },
      },

      // Servicios y reparaciones (OR)
      sectionTitle(`Servicios y reparaciones realizadas (${workOrders.length})`),
      workOrders.length > 0
        ? {
            table: {
              headerRows: 1,
              widths: [52, 52, 52, 65, '*', 55, 60],
              body: [
                [
                  { text: 'N° OR', style: 'th' },
                  { text: 'FECHA', style: 'th' },
                  { text: 'PATENTE', style: 'th' },
                  { text: 'TIPO', style: 'th' },
                  { text: 'TRABAJO REALIZADO / FALLA', style: 'th' },
                  { text: 'ESTADO', style: 'th' },
                  { text: 'TOTAL ($)', style: 'th', alignment: 'right' },
                ],
                ...workOrders.map((wo) => {
                  const tot = Math.round((itemsCostByWo.get(wo.id) ?? 0) + Number(wo.labor_cost ?? 0));
                  return [
                    { text: formatOrderNumber(wo.order_number), fontSize: 8, bold: true },
                    { text: formatDate(wo.opened_at), fontSize: 8 },
                    { text: formatPatente(wo.patente), fontSize: 8 },
                    { text: MAINTENANCE_TYPE_LABELS[wo.maintenance_type], fontSize: 8 },
                    { text: wo.work_performed || wo.requested_work || wo.failure_description || '—', fontSize: 8 },
                    { text: WO_STATUS_LABELS[wo.status], fontSize: 8 },
                    { text: tot > 0 ? `$ ${formatNumber(tot)}` : '—', fontSize: 8, alignment: 'right' as const },
                  ];
                }),
              ],
            },
            layout: 'lightHorizontalLines',
          }
        : { text: 'Sin órdenes de reparación en el período seleccionado.', fontSize: 8.5, color: '#64748b' },

      // Intervenciones clave (cubiertas, frenos, amortiguadores, parabrisas)
      sectionTitle(`Cambios de cubiertas, frenos, amortiguadores y parabrisas (${interventions.length})`),
      interventions.length > 0
        ? {
            table: {
              headerRows: 1,
              widths: [85, 52, 52, 55, '*', 65],
              body: [
                [
                  { text: 'RUBRO', style: 'th' },
                  { text: 'FECHA', style: 'th' },
                  { text: 'PATENTE', style: 'th' },
                  { text: 'KM', style: 'th' },
                  { text: 'DETALLE DE LA INTERVENCIÓN', style: 'th' },
                  { text: 'ORIGEN', style: 'th' },
                ],
                ...interventions.map((r) => [
                  { text: r.kind.toUpperCase(), fontSize: 8, bold: true },
                  { text: formatDate(r.date), fontSize: 8 },
                  { text: formatPatente(r.patente), fontSize: 8 },
                  { text: r.kilometraje != null ? `${formatNumber(r.kilometraje)}` : '—', fontSize: 8 },
                  { text: r.detail, fontSize: 8 },
                  { text: r.sourceLabel, fontSize: 8 },
                ]),
              ],
            },
            layout: 'lightHorizontalLines',
          }
        : { text: 'Sin intervenciones registradas en estos rubros específicos.', fontSize: 8.5, color: '#64748b' },

      // Repuestos utilizados
      sectionTitle(`Repuestos e insumos colocados (${items.length})`),
      items.length > 0
        ? {
            table: {
              headerRows: 1,
              widths: [52, 52, 65, '*', 40, 65],
              body: [
                [
                  { text: 'FECHA', style: 'th' },
                  { text: 'OR', style: 'th' },
                  { text: 'CÓDIGO', style: 'th' },
                  { text: 'DESCRIPCIÓN', style: 'th' },
                  { text: 'CANT.', style: 'th', alignment: 'right' },
                  { text: 'SUBTOTAL', style: 'th', alignment: 'right' },
                ],
                ...items.slice(0, 80).map((it) => {
                  const sub = it.unit_cost != null ? Math.round(Number(it.quantity) * Number(it.unit_cost)) : null;
                  return [
                    { text: formatDate(it.work_orders?.opened_at ?? it.created_at), fontSize: 8 },
                    { text: formatOrderNumber(it.work_orders?.order_number), fontSize: 8 },
                    { text: it.part_code || '—', fontSize: 8 },
                    { text: it.description, fontSize: 8 },
                    { text: `${it.quantity} ${it.unit}`, fontSize: 8, alignment: 'right' as const },
                    { text: sub != null ? `$ ${formatNumber(sub)}` : '—', fontSize: 8, alignment: 'right' as const },
                  ];
                }),
              ],
            },
            layout: 'lightHorizontalLines',
          }
        : { text: 'Sin repuestos registrados.', fontSize: 8.5, color: '#64748b' },

      // Pendientes actuales y solucionados + Turnos + Inspecciones RTO
      sectionTitle(`Pendientes actuales y solucionados (${pendingTasks.length})`),
      pendingTasks.length > 0
        ? {
            table: {
              headerRows: 1,
              widths: [55, 55, '*', 75, 65],
              body: [
                [
                  { text: 'DETECTADO', style: 'th' },
                  { text: 'PATENTE', style: 'th' },
                  { text: 'TRABAJO PENDIENTE / SOLUCIONADO', style: 'th' },
                  { text: 'PROVEEDOR', style: 'th' },
                  { text: 'ESTADO', style: 'th' },
                ],
                ...pendingTasks.map((p) => [
                  { text: formatDate(p.detected_at), fontSize: 8 },
                  { text: formatPatente(p.patente), fontSize: 8 },
                  { text: `${p.task_title}${p.description ? ` — ${p.description}` : ''}`, fontSize: 8 },
                  { text: p.provider_name || '—', fontSize: 8 },
                  { text: PENDING_STATUS_LABELS[p.status], fontSize: 8 },
                ]),
              ],
            },
            layout: 'lightHorizontalLines',
          }
        : { text: 'Sin registros de pendientes.', fontSize: 8.5, color: '#64748b' },

      ...(appointments.length > 0
        ? [
            sectionTitle(`Turnos con proveedores (${appointments.length})`),
            {
              table: {
                headerRows: 1,
                widths: [65, 55, '*', 110, 65],
                body: [
                  [
                    { text: 'FECHA Y HORA', style: 'th' },
                    { text: 'PATENTE', style: 'th' },
                    { text: 'MOTIVO', style: 'th' },
                    { text: 'PROVEEDOR / TALLER', style: 'th' },
                    { text: 'ESTADO', style: 'th' },
                  ],
                  ...appointments.map((a) => [
                    { text: `${formatDate(a.appointment_date)} ${a.appointment_time ?? ''}`, fontSize: 8 },
                    { text: formatPatente(a.patente), fontSize: 8 },
                    { text: a.reason, fontSize: 8 },
                    { text: a.provider_name, fontSize: 8 },
                    { text: APPOINTMENT_STATUS_LABELS[a.status], fontSize: 8 },
                  ]),
                ],
              },
              layout: 'lightHorizontalLines',
            } as Content,
          ]
        : []),

      ...(inspections.length > 0
        ? [
            sectionTitle(`Inspecciones previas a RTO (${inspections.length})`),
            {
              table: {
                headerRows: 1,
                widths: [55, 55, 55, 85, '*'],
                body: [
                  [
                    { text: 'FECHA', style: 'th' },
                    { text: 'PATENTE', style: 'th' },
                    { text: 'KM', style: 'th' },
                    { text: 'RESULTADO', style: 'th' },
                    { text: 'OBSERVACIONES', style: 'th' },
                  ],
                  ...inspections.map((i) => [
                    { text: formatDate(i.inspected_at), fontSize: 8 },
                    { text: formatPatente(i.patente), fontSize: 8 },
                    { text: i.kilometraje != null ? formatNumber(i.kilometraje) : '—', fontSize: 8 },
                    { text: i.overall_ready_for_rto ? 'Apta para RTO' : 'Requiere trabajos', fontSize: 8 },
                    { text: i.observations || '—', fontSize: 8 },
                  ]),
                ],
              },
              layout: 'lightHorizontalLines',
            } as Content,
          ]
        : []),
    ],
    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: `RV GROUP SRL · Ficha Histórica de Mantenimiento${vehicle ? ` · ${formatPatente(vehicle.patente)}` : ''}`,
          fontSize: 7.5,
          color: '#94a3b8',
        },
        { text: `Página ${currentPage} de ${pageCount}`, alignment: 'right', fontSize: 7.5, color: '#94a3b8' },
      ],
      margin: [30, 8, 30, 0],
    }),
    styles: {
      th: { fontSize: 7.5, bold: true, color: '#0f4c5c', fillColor: '#f1f5f9', margin: [2, 2, 2, 2] },
    },
  };

  const suffix = vehicle ? formatPatente(vehicle.patente) : 'Flota_RVGroup';
  pdfMake.createPdf(def).download(`Ficha_Historica_${suffix}_${new Date().toISOString().slice(0, 10)}.pdf`);
}
