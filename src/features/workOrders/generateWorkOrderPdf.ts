import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { supabase } from '@/lib/supabase';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber } from '@/lib/utils';
import type { Vehicle, WorkOrder, WorkOrderItem } from '@/types/db';

// Inicializa las fuentes embebidas de pdfMake
const vfsSource = pdfFonts as unknown as {
  pdfMake?: { vfs: Record<string, string> };
  vfs?: Record<string, string>;
};
(pdfMake as unknown as { vfs: Record<string, string> }).vfs =
  vfsSource.pdfMake?.vfs ?? vfsSource.vfs ?? {};

async function loadLogoDataUrl(): Promise<string | null> {
  for (const path of ['/logo-rvgroup.png', '/logo-rvgroup.png.png', '/icons/icon-192.png']) {
    try {
      const res = await fetch(path);
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return dataUrl;
    } catch {
      /* continúa */
    }
  }
  return null;
}

const DARK_HEADER = '#2b3c4e';
const SUB_HEADER = '#e5e7eb';
const BORDER_COLOR = '#64748b';

function sectionBar(title: string): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [
          {
            text: title,
            fillColor: DARK_HEADER,
            color: '#ffffff',
            bold: true,
            fontSize: 7.5,
            margin: [3, 1.5, 3, 1.5],
          },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 2.5, 0, 0],
  };
}

export function splitWorkLines(wo: WorkOrder): { text: string; hours: string }[] {
  const rawLines: string[] = [];
  if (wo.work_performed) {
    for (const line of wo.work_performed.split(/\r?\n/)) {
      const clean = line.replace(/^\s*\d+[\.\)\-]\s*/, '').trim();
      if (clean) rawLines.push(clean);
    }
  }
  if (wo.diagnosis && !rawLines.includes(wo.diagnosis.trim())) {
    rawLines.push(`Diagnóstico: ${wo.diagnosis.trim()}`);
  }
  if (wo.oil_type) {
    rawLines.push(
      `Aceite / Lubricante: ${wo.oil_type}${wo.oil_liters != null ? ` (${wo.oil_liters} L)` : ''}${
        wo.other_fluids ? ` · Otros fluidos: ${wo.other_fluids}` : ''
      }`,
    );
  } else if (wo.other_fluids) {
    rawLines.push(`Fluidos: ${wo.other_fluids}`);
  }
  if (wo.labor_detail && !rawLines.includes(wo.labor_detail.trim())) {
    rawLines.push(wo.labor_detail.trim());
  }

  // 5 filas ajustadas para garantizar una sola hoja exacta
  const rows: { text: string; hours: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const line = rawLines[i] ?? '';
    let text = line;
    let hours = '';
    const m = line.match(/^(.*?)\s*[\[\(](\d+(?:[.,]\d+)?)\s*h(?:s|oras)?[\]\)]\s*$/i);
    if (m) {
      text = m[1].trim();
      hours = `${m[2]} Hs`;
    } else if (i === 0 && wo.labor_hours != null && rawLines.length <= 1) {
      hours = `${wo.labor_hours} Hs`;
    }
    rows.push({ text, hours });
  }
  return rows;
}

export function detectCompletionChecks(wo: WorkOrder) {
  const obsLower = (wo.observations ?? '').toLowerCase();
  const isProvisorio = obsLower.includes('[reparado provisoriamente]') || obsLower.includes('provisori');
  const isRevisionPosterior =
    obsLower.includes('[requiere revisión posterior]') ||
    obsLower.includes('[requiere revision posterior]') ||
    obsLower.includes('revision posterior') ||
    obsLower.includes('revisión posterior');
  const isPendienteRepuesto =
    wo.status === 'pendiente_repuestos' || obsLower.includes('[pendiente de repuesto]');
  const isPendienteReparacion =
    wo.status === 'pendiente_autorizacion' || obsLower.includes('[pendiente de reparación]');
  const isReparadoFinalizado =
    !isProvisorio &&
    !isPendienteRepuesto &&
    !isPendienteReparacion &&
    (wo.status === 'finalizada' || wo.status === 'cerrada' || obsLower.includes('[reparado / finalizado]'));

  return {
    reparadoFinalizado: isReparadoFinalizado,
    reparadoProvisoriamente: isProvisorio,
    pendienteRepuesto: isPendienteRepuesto,
    pendienteReparacion: isPendienteReparacion,
    requiereRevisionPosterior: isRevisionPosterior,
  };
}

function buildDefinition(
  wo: WorkOrder,
  vehicle: Vehicle | null | undefined,
  items: WorkOrderItem[],
  logoDataUrl: string | null,
): TDocumentDefinitions {
  const otNumberFormatted = `N° 00 00-${String(wo.order_number ?? 0).padStart(4, '0')}`;
  const fechaTrabajo = wo.opened_at ? formatDate(wo.opened_at) : '____ / ____ / 202___';
  const fechaSalida = wo.closed_at ? formatDate(wo.closed_at) : '____ / ____ / 202___';
  const kmText = wo.kilometraje != null ? `${formatNumber(wo.kilometraje)} km` : '';
  const nextServiceKm =
    vehicle?.next_service_km != null
      ? `${formatNumber(vehicle.next_service_km)} km`
      : wo.kilometraje != null && wo.maintenance_type === 'preventivo'
        ? `${formatNumber(wo.kilometraje + 10000)} km`
        : '';

  const chk = (active: boolean, label: string) => `[ ${active ? 'X' : ' '} ] ${label}`;

  // Motivo / trabajo solicitado (2 renglones compactos)
  const motivoText = [wo.requested_work, wo.failure_description]
    .filter((x) => x && x.trim())
    .join(' — ');
  const motivoLines = motivoText ? motivoText.split(/\r?\n/) : [];

  // 5 filas de trabajo realizado
  const workRows = splitWorkLines(wo);

  // 5 filas de repuestos e insumos (óptimo para 1 sola hoja física)
  const totalPartRows = Math.max(5, items.length);
  const partTableBody: TableCell[][] = [
    [
      {
        text: 'CANTIDAD',
        bold: true,
        fontSize: 7,
        alignment: 'center',
        fillColor: SUB_HEADER,
        margin: [2, 2, 2, 2],
      },
      {
        text: 'DESCRIPCIÓN DEL REPUESTO / MATERIAL / INSUMO',
        bold: true,
        fontSize: 7,
        fillColor: SUB_HEADER,
        margin: [4, 2, 4, 2],
      },
      {
        text: 'N° DE REPUESTO / CODIGO',
        bold: true,
        fontSize: 7,
        fillColor: SUB_HEADER,
        margin: [4, 2, 4, 2],
      },
    ],
  ];

  for (let i = 0; i < totalPartRows; i++) {
    const it = items[i];
    partTableBody.push([
      {
        text: it ? `${it.quantity} ${it.unit || ''}`.trim() : ' ',
        alignment: 'center',
        fontSize: 7.5,
        margin: [2, 2, 2, 2],
      },
      {
        text: it ? it.description : ' ',
        fontSize: 7.5,
        margin: [4, 2, 4, 2],
      },
      {
        text: it?.part_code || ' ',
        fontSize: 7.5,
        margin: [4, 2, 4, 2],
      },
    ]);
  }

  const completion = detectCompletionChecks(wo);
  const cleanObs = (wo.observations ?? '')
    .replace(
      /\[(reparado \/ finalizado|reparado provisoriamente|pendiente de repuesto|pendiente de reparación|requiere revisión posterior)\]\s*/gi,
      '',
    )
    .trim();

  const gridLayout = {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => BORDER_COLOR,
    vLineColor: () => BORDER_COLOR,
  };

  return {
    pageSize: 'A4',
    pageMargins: [20, 16, 20, 16],
    defaultStyle: { fontSize: 8, color: '#0f172a' },
    content: [
      // CABECERA OFICIAL F02-PGV-02 rev0
      {
        table: {
          widths: [130, '*', 155],
          body: [
            [
              logoDataUrl
                ? {
                    image: logoDataUrl,
                    fit: [120, 36],
                    alignment: 'center',
                    margin: [2, 1, 2, 1],
                  }
                : {
                    stack: [
                      { text: 'Rv Group', bold: true, fontSize: 14, color: '#14559b' },
                      { text: 'Transporte', italics: true, fontSize: 8, color: '#7cd100' },
                    ],
                    alignment: 'center',
                    margin: [0, 4, 0, 0],
                  },
              {
                stack: [
                  {
                    table: {
                      widths: ['*'],
                      body: [
                        [
                          {
                            text: 'REGISTRO DE TRABAJO MECÁNICO',
                            fillColor: DARK_HEADER,
                            color: '#ffffff',
                            bold: true,
                            fontSize: 9.5,
                            alignment: 'center',
                            margin: [2, 3, 2, 3],
                          },
                        ],
                      ],
                    },
                    layout: 'noBorders',
                  },
                  {
                    text: 'SERVICIOS DE MANTENIMIENTO',
                    alignment: 'center',
                    fontSize: 7,
                    color: '#334155',
                    bold: true,
                    margin: [0, 3, 0, 0],
                  },
                ],
                margin: [3, 0, 3, 0],
              },
              {
                table: {
                  widths: ['*'],
                  body: [
                    [
                      {
                        text: 'F02-PGV-02 rev0',
                        alignment: 'center',
                        bold: true,
                        fontSize: 8.5,
                        fillColor: SUB_HEADER,
                        margin: [3, 2, 3, 2],
                      },
                    ],
                    [
                      {
                        text: `N.º ORDEN DE TRABAJO (OT) ${otNumberFormatted}`,
                        alignment: 'center',
                        bold: true,
                        fontSize: 8,
                        margin: [3, 2.5, 3, 2.5],
                      },
                    ],
                  ],
                },
                layout: gridLayout,
              },
            ],
          ],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 3],
      },

      // TABLA DE FECHAS, PATENTE, INTERNO Y KILOMETRAJE
      {
        table: {
          widths: ['34%', '33%', '33%'],
          body: [
            [
              {
                columns: [
                  { text: 'FECHA TRABAJO:', bold: true, fontSize: 7, width: 68, margin: [0, 1.5, 0, 0] },
                  { text: fechaTrabajo, bold: true, fontSize: 8.5 },
                ],
                margin: [3, 2.5, 3, 2.5],
              },
              {
                columns: [
                  { text: 'PATENTE / DOMINIO:', bold: true, fontSize: 7, width: 78, margin: [0, 1.5, 0, 0] },
                  { text: formatPatente(wo.patente), bold: true, fontSize: 9 },
                ],
                margin: [3, 2.5, 3, 2.5],
              },
              {
                columns: [
                  { text: 'N.º INTERNO:', bold: true, fontSize: 7, width: 58, margin: [0, 1.5, 0, 0] },
                  { text: wo.nro_interno || '—', bold: true, fontSize: 9 },
                ],
                margin: [3, 2.5, 3, 2.5],
              },
            ],
            [
              {
                columns: [
                  { text: 'FECHA DE SALIDA:', bold: true, fontSize: 7, width: 68, margin: [0, 1.5, 0, 0] },
                  { text: fechaSalida, fontSize: 8 },
                ],
                margin: [3, 2.5, 3, 2.5],
              },
              {
                columns: [
                  { text: 'KILOMETRAJE / HS:', bold: true, fontSize: 7, width: 78, margin: [0, 1.5, 0, 0] },
                  { text: kmText, bold: true, fontSize: 8.5 },
                ],
                margin: [3, 2.5, 3, 2.5],
              },
              {
                columns: [
                  {
                    stack: [
                      { text: 'PROXIMO SERVICE', bold: true, fontSize: 6.5 },
                      { text: 'KILOMETRAJE / HS:', bold: true, fontSize: 6.5 },
                    ],
                    width: 72,
                  },
                  { text: nextServiceKm, bold: true, fontSize: 8.5, margin: [0, 1.5, 0, 0] },
                ],
                margin: [3, 2, 3, 2],
              },
            ],
          ],
        },
        layout: gridLayout,
      },

      // 1. TIPO DE MANTENIMIENTO (MARCAR CON X)
      sectionBar('1. TIPO DE MANTENIMIENTO (MARCAR CON X)'),
      {
        table: {
          widths: ['18%', '18%', '24%', '18%', '22%'],
          body: [
            [
              {
                text: chk(wo.maintenance_type === 'preventivo', 'Preventivo'),
                bold: true,
                fontSize: 7.5,
                alignment: 'center',
                margin: [0, 2.5, 0, 2.5],
              },
              {
                text: chk(wo.maintenance_type === 'correctivo', 'Correctivo'),
                bold: true,
                fontSize: 7.5,
                alignment: 'center',
                margin: [0, 2.5, 0, 2.5],
              },
              {
                text: chk(wo.maintenance_type === 'rto', 'Revisión / Inspección'),
                bold: true,
                fontSize: 7.5,
                alignment: 'center',
                margin: [0, 2.5, 0, 2.5],
              },
              {
                text: chk(wo.maintenance_type === 'otro', 'Reparación'),
                bold: true,
                fontSize: 7.5,
                alignment: 'center',
                margin: [0, 2.5, 0, 2.5],
              },
              {
                text: chk(wo.maintenance_type === 'emergencia', 'Emergencia / Auxilio'),
                bold: true,
                fontSize: 7.5,
                alignment: 'center',
                margin: [0, 2.5, 0, 2.5],
              },
            ],
          ],
        },
        layout: 'noBorders',
      },

      // 2. MOTIVO / TRABAJO SOLICITADO
      sectionBar('2. MOTIVO / TRABAJO SOLICITADO'),
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                text: motivoLines[0] || motivoText || ' ',
                fontSize: 8,
                margin: [4, 2.5, 4, 2.5],
              },
            ],
            [
              {
                text: motivoLines.slice(1).join(' · ') || ' ',
                fontSize: 8,
                margin: [4, 2.5, 4, 2.5],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: (i: number) => (i === 0 || i === 2 ? BORDER_COLOR : '#94a3b8'),
          vLineColor: () => BORDER_COLOR,
          hLineStyle: (i: number) => (i === 1 ? { dash: { length: 2, space: 2 } } : null),
        },
      },

      // 3. DETALLE DE TRABAJO REALIZADO Y TIEMPO / HORAS OCUPADAS
      sectionBar('3. DETALLE DE TRABAJO REALIZADO Y TIEMPO / HORAS OCUPADAS'),
      {
        table: {
          widths: ['*', 90],
          body: [
            [
              {
                text: 'DESCRIPCIÓN DEL TRABAJO REALIZADO (REVISIÓN, REPARACIÓN, AJUSTE, RECAMBIO)',
                bold: true,
                fontSize: 7,
                fillColor: SUB_HEADER,
                margin: [4, 2, 4, 2],
              },
              {
                text: 'HORAS OCUPADAS',
                bold: true,
                fontSize: 7,
                alignment: 'center',
                fillColor: SUB_HEADER,
                margin: [2, 2, 2, 2],
              },
            ],
            ...workRows.map((row, idx) => [
              {
                text: [
                  { text: `${idx + 1}.  `, bold: true },
                  { text: row.text || ' ' },
                ],
                fontSize: 7.5,
                margin: [4, 2, 4, 2] as [number, number, number, number],
              },
              {
                text: row.hours || ' ',
                alignment: 'center' as const,
                fontSize: 7.5,
                margin: [2, 2, 2, 2] as [number, number, number, number],
              },
            ]),
            [
              {
                text: 'TOTAL HORAS TRABAJADAS:',
                bold: true,
                fontSize: 7.5,
                alignment: 'right',
                fillColor: '#f8fafc',
                margin: [4, 2, 6, 2],
              },
              {
                text: wo.labor_hours != null ? `${wo.labor_hours} Hs` : '______ Hs',
                bold: true,
                fontSize: 7.5,
                alignment: 'center',
                fillColor: '#f8fafc',
                margin: [2, 2, 2, 2],
              },
            ],
          ],
        },
        layout: gridLayout,
      },

      // 4. REPUESTOS Y MATERIALES UTILIZADOS
      sectionBar('4. REPUESTOS Y MATERIALES UTILIZADOS'),
      {
        table: {
          widths: [65, '*', 125],
          body: partTableBody,
        },
        layout: gridLayout,
      },

      // 5. ESTADO DEL TRABAJO AL FINALIZAR
      sectionBar('5. ESTADO DEL TRABAJO AL FINALIZAR'),
      {
        table: {
          widths: ['34%', '34%', '32%'],
          body: [
            [
              {
                text: chk(completion.reparadoFinalizado, 'Reparado / Finalizado'),
                bold: true,
                fontSize: 7.5,
                margin: [8, 2, 0, 1.5],
              },
              {
                text: chk(completion.reparadoProvisoriamente, 'Reparado provisoriamente'),
                bold: true,
                fontSize: 7.5,
                margin: [6, 2, 0, 1.5],
              },
              {
                text: chk(completion.pendienteRepuesto, 'Pendiente de repuesto'),
                bold: true,
                fontSize: 7.5,
                margin: [6, 2, 0, 1.5],
              },
            ],
            [
              {
                text: chk(completion.pendienteReparacion, 'Pendiente de reparación'),
                bold: true,
                fontSize: 7.5,
                margin: [8, 1.5, 0, 2],
              },
              {
                text: chk(completion.requiereRevisionPosterior, 'Requiere revisión posterior'),
                bold: true,
                fontSize: 7.5,
                margin: [6, 1.5, 0, 2],
              },
              { text: '' },
            ],
          ],
        },
        layout: 'noBorders',
      },

      // 6. OBSERVACIONES Y RECOMENDACIONES
      sectionBar('6. OBSERVACIONES Y RECOMENDACIONES'),
      {
        table: {
          widths: ['*'],
          body: [
            [
              {
                text: cleanObs.split(/\r?\n/)[0] || cleanObs || ' ',
                fontSize: 7.5,
                margin: [4, 2, 4, 2],
              },
            ],
            [
              {
                text: cleanObs.split(/\r?\n/).slice(1).join(' · ') || ' ',
                fontSize: 7.5,
                margin: [4, 2, 4, 2],
              },
            ],
          ],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: (i: number) => (i === 0 || i === 2 ? BORDER_COLOR : '#94a3b8'),
          vLineColor: () => BORDER_COLOR,
          hLineStyle: (i: number) => (i === 1 ? { dash: { length: 2, space: 2 } } : null),
        },
      },

      // BLOQUE DE FIRMAS: MECÁNICO / TALLER Y CONTROL MANTENIMIENTO
      {
        table: {
          widths: ['50%', '50%'],
          body: [
            [
              {
                text: 'MECÁNICO / TALLER',
                bold: true,
                fontSize: 7.5,
                fillColor: SUB_HEADER,
                margin: [4, 2, 4, 2],
              },
              {
                text: 'CONTROL MANTENIMIENTO (CARGA OT DIGITAL)',
                bold: true,
                fontSize: 7.5,
                fillColor: SUB_HEADER,
                margin: [4, 2, 4, 2],
              },
            ],
            [
              {
                stack: [
                  {
                    text: [
                      { text: 'Realizado por: ', bold: true },
                      {
                        text:
                          wo.mechanic_name ||
                          '.......................................................',
                      },
                    ],
                    margin: [0, 2, 0, 8],
                  },
                  {
                    text: [
                      { text: 'Firma: ', bold: true },
                      {
                        text:
                          wo.status === 'finalizada' || wo.status === 'cerrada'
                            ? `${wo.mechanic_name || 'Completado en Taller Móvil'} (Digital)`
                            : '.....................................................................',
                      },
                    ],
                  },
                ],
                margin: [4, 2.5, 4, 3],
              },
              {
                stack: [
                  {
                    text: [
                      { text: 'Revisado por: ', bold: true },
                      {
                        text:
                          wo.approved_by_name ||
                          '.......................................................',
                      },
                    ],
                    margin: [0, 2, 0, 8],
                  },
                  {
                    text: [
                      { text: 'Fecha revisión: ', bold: true },
                      {
                        text: wo.approved_at
                          ? formatDate(wo.approved_at)
                          : '____ / ____ / 202___',
                      },
                    ],
                  },
                ],
                margin: [4, 2.5, 4, 3],
              },
            ],
          ],
        },
        layout: gridLayout,
        margin: [0, 2.5, 0, 3],
      },

      {
        text: 'Documento interno de registro operativo - RV GROUP SRL. Una vez completado a mano, entregar a Mantenimiento para su carga en OT Digital.',
        italics: true,
        fontSize: 6.5,
        color: '#475569',
        alignment: 'center',
      },
    ],
  };
}

/**
 * Genera el PDF con formato oficial F02-PGV-02 rev0 (REGISTRO DE TRABAJO MECÁNICO),
 * lo descarga en el dispositivo y guarda una copia en Supabase Storage.
 */
export async function generateWorkOrderPdf(
  wo: WorkOrder,
  vehicle: Vehicle | null | undefined,
  items: WorkOrderItem[],
  _opts?: { download?: boolean; saveToCloud?: boolean },
): Promise<string> {
  const logoDataUrl = await loadLogoDataUrl();
  const def = buildDefinition(wo, vehicle, items, logoDataUrl);
  const filename = `OT-${String(wo.order_number).padStart(4, '0')}-${wo.patente}.pdf`;

  const blob: Blob = await new Promise((resolve) => {
    const doc = pdfMake.createPdf(def);
    doc.getBlob((b: Blob) => resolve(b));
  });

  // 1. Descarga inmediata en el navegador / celular
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  // 2. Respaldo en Supabase Storage
  const path = `${wo.id}/${filename}`;
  const { error: upErr } = await supabase.storage
    .from('work-order-pdfs')
    .upload(path, blob, { contentType: 'application/pdf', upsert: true });
  if (!upErr) {
    await supabase.from('work_orders').update({ pdf_path: path }).eq('id', wo.id);
  }
  return path;
}
