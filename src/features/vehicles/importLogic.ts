import * as XLSX from 'xlsx';
import { checkPatente, normalizePatente } from '@/lib/patente';
import { slug } from '@/lib/utils';
import type { VehicleCategory, VehicleStatus } from '@/types/db';

// -----------------------------------------------------------------------------
// Campos del sistema disponibles para importar
// -----------------------------------------------------------------------------
export type ImportFieldKey =
  | 'registro_nro'
  | 'patente'
  | 'nro_interno'
  | 'marca'
  | 'modelo'
  | 'version'
  | 'anio'
  | 'chasis'
  | 'motor'
  | 'km_actual'
  | 'vehicle_type'
  | 'category'
  | 'tire_type_size'
  | 'tire_count'
  | 'status'
  | 'observaciones';

export interface ImportField {
  key: ImportFieldKey;
  label: string;
  required?: boolean;
  aliases: string[];
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: 'registro_nro', label: 'N° de orden / registro', aliases: ['numerodeorden', 'nroorden', 'orden', 'registro', 'nroregistro', 'numeroregistro', 'nro', 'numero', 'n'] },
  { key: 'patente', label: 'Patente', required: true, aliases: ['patente', 'dominio', 'matricula', 'placa'] },
  { key: 'nro_interno', label: 'N° interno', aliases: ['numerointerno', 'nrointerno', 'interno', 'ninterno', 'movil', 'unidad'] },
  { key: 'marca', label: 'Marca', aliases: ['marca'] },
  { key: 'modelo', label: 'Modelo', aliases: ['modelo'] },
  { key: 'version', label: 'Versión', aliases: ['version'] },
  { key: 'anio', label: 'Año', aliases: ['ano', 'anio', 'year', 'modeloano', 'anomodelo'] },
  { key: 'chasis', label: 'N° de chasis', aliases: ['chasis', 'numerodechasis', 'nrochasis', 'vin'] },
  { key: 'motor', label: 'N° de motor', aliases: ['motor', 'numerodemotor', 'nromotor'] },
  { key: 'km_actual', label: 'Kilometraje', aliases: ['kilometraje', 'km', 'kms', 'kmactual', 'odometro'] },
  { key: 'vehicle_type', label: 'Tipo de vehículo', aliases: ['tipodevehiculo', 'tipovehiculo', 'tipo'] },
  { key: 'category', label: 'Categoría', aliases: ['categoria', 'grupo', 'flota'] },
  { key: 'tire_type_size', label: 'Tipo / medida de cubiertas', aliases: ['medidadecubiertas', 'medidacubiertas', 'cubiertas', 'medida', 'neumaticos', 'rodado', 'tipoymedidadecubiertas'] },
  { key: 'tire_count', label: 'Cantidad de cubiertas', aliases: ['cantidaddecubiertas', 'cantcubiertas', 'cantidadcubiertas', 'cantneumaticos'] },
  { key: 'status', label: 'Estado', aliases: ['estado', 'estadooperativo', 'situacion'] },
  { key: 'observaciones', label: 'Observaciones', aliases: ['observaciones', 'obs', 'comentarios', 'notas'] },
];

export type ColumnMapping = Partial<Record<ImportFieldKey, number | null>>;

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

// -----------------------------------------------------------------------------
// Lectura del archivo
// -----------------------------------------------------------------------------
export async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
}

/** Lee una hoja. headerRow es el índice (0-based) de la fila de encabezados. */
export function readSheet(wb: XLSX.WorkBook, sheetName: string, headerRow = 0): ParsedSheet {
  const ws = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false, blankrows: false });
  const headerLine = (matrix[headerRow] ?? []) as unknown[];
  const width = Math.max(headerLine.length, ...matrix.slice(headerRow + 1).map((r) => (r as unknown[]).length));
  const headers = Array.from({ length: width }, (_, i) => String(headerLine[i] ?? '').trim() || `Columna ${i + 1}`);
  const rows = matrix
    .slice(headerRow + 1)
    .map((r) => Array.from({ length: width }, (_, i) => String((r as unknown[])[i] ?? '').trim()))
    .filter((r) => r.some((c) => c !== ''));
  return { headers, rows };
}

/** Relaciona automáticamente encabezados con campos del sistema por similitud de nombre. */
export function autoMap(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const slugs = headers.map(slug);
  // Primero coincidencias exactas, luego parciales
  for (const pass of ['exact', 'partial'] as const) {
    for (const field of IMPORT_FIELDS) {
      if (mapping[field.key] !== undefined && mapping[field.key] !== null) continue;
      const idx = slugs.findIndex((h, i) => {
        if (used.has(i) || !h) return false;
        return pass === 'exact'
          ? field.aliases.includes(h)
          : field.aliases.some((a) => a.length >= 6 && a !== 'numero' && h.includes(a));
      });
      if (idx >= 0) {
        mapping[field.key] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

// -----------------------------------------------------------------------------
// Conversión y validación
// -----------------------------------------------------------------------------
export type RawValues = Record<ImportFieldKey, string>;

export interface ImportRow {
  rowNumber: number; // fila en el Excel (1-based, incluye encabezado)
  values: RawValues;
  excluded: boolean;
  errors: string[];
  warnings: string[];
  dupInFile: boolean;
  existsInDb: boolean;
  categoryId: string | null;
  status: VehicleStatus | null;
}

export interface ExistingKeys {
  patentes: Set<string>;
  internos: Set<string>;
  chasis: Set<string>;
}

export function extractValues(row: string[], mapping: ColumnMapping): RawValues {
  const out = {} as RawValues;
  for (const f of IMPORT_FIELDS) {
    const idx = mapping[f.key];
    out[f.key] = idx === null || idx === undefined ? '' : (row[idx] ?? '').trim();
  }
  return out;
}

/** Convierte números con separadores de miles argentinos: "125.000", "125,000 km". */
export function parseInteger(value: string): number | null | 'invalid' {
  const v = value.trim();
  if (!v) return null;
  const cleaned = v.replace(/km|kms|\s/gi, '').replace(/[.,](?=\d{3}(\D|$))/g, '');
  const n = Number(cleaned.replace(',', '.'));
  if (!Number.isFinite(n)) return 'invalid';
  return Math.round(n);
}

export function parseStatus(value: string): VehicleStatus | null | 'invalid' {
  if (!value.trim()) return null;
  const s = slug(value);
  if (!s) return 'invalid';
  if (['operativo', 'operativa', 'op', 'activo', 'activa', 'enservicio', 'ok', 'disponible'].includes(s)) return 'operativo';
  if (s.includes('fuera') || ['fs', 'inactivo', 'inactiva', 'nooperativo', 'parado', 'detenido'].includes(s)) return 'fuera_de_servicio';
  if (s.includes('taller') || s === 'reparacion' || s === 'enreparacion') return 'en_taller';
  if (s.includes('baja') || s === 'vendido' || s === 'desafectado') return 'baja';
  return 'invalid';
}

/** Busca la categoría por nombre explícito o deduciéndola de marca + modelo + versión / tipo. */
export function matchCategory(values: RawValues, categories: VehicleCategory[]): string | null {
  const explicit = slug(values.category);
  if (explicit) {
    const c = categories.find((c) => slug(c.name) === explicit);
    if (c) return c.id;
  }
  const full = slug(`${values.marca} ${values.modelo} ${values.version} ${values.category}`);
  if (full) {
    const c = categories.find((c) => {
      if (!c.model || !c.version) return false;
      const model = slug(c.model);
      const version = slug(c.version);
      const brandOk = !c.brand || full.includes(slug(c.brand).slice(0, 4));
      return brandOk && full.includes(model) && full.includes(version);
    });
    if (c) return c.id;
  }
  const type = slug(`${values.vehicle_type} ${values.modelo} ${values.category}`);
  if (type.includes('minibus')) {
    const c = categories.find((c) => slug(c.name).startsWith('minibus'));
    if (c) return c.id;
  }
  return null;
}

export function validateRows(
  rows: ImportRow[],
  existing: ExistingKeys,
  categories: VehicleCategory[],
): ImportRow[] {
  const currentYear = new Date().getFullYear();
  // Conteo de patentes / internos / chasis dentro del archivo (solo filas no excluidas)
  const countBy = (key: (r: ImportRow) => string) => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      if (r.excluded) return;
      const k = key(r);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  };
  const patCount = countBy((r) => normalizePatente(r.values.patente));
  const intCount = countBy((r) => r.values.nro_interno.trim().toUpperCase());
  const chaCount = countBy((r) => r.values.chasis.trim().toUpperCase());

  return rows.map((r) => {
    const v = r.values;
    const errors: string[] = [];
    const warnings: string[] = [];
    const pat = normalizePatente(v.patente);

    const pc = checkPatente(v.patente);
    if (!pc.ok) errors.push(pc.error);
    else if (pc.warning) warnings.push(pc.warning);

    const dupInFile = !!pat && (patCount.get(pat) ?? 0) > 1;
    if (dupInFile && !r.excluded) errors.push('Patente repetida dentro del archivo');
    const existsInDb = !!pat && existing.patentes.has(pat);
    if (existsInDb) errors.push('La patente ya existe en el sistema (no se duplicará)');

    const interno = v.nro_interno.trim().toUpperCase();
    if (interno) {
      if ((intCount.get(interno) ?? 0) > 1 && !r.excluded) errors.push('N° interno repetido dentro del archivo');
      else if (existing.internos.has(interno) && !existsInDb) errors.push('N° interno ya asignado a otra unidad activa');
    }
    const chasis = v.chasis.trim().toUpperCase();
    if (chasis) {
      if ((chaCount.get(chasis) ?? 0) > 1 && !r.excluded) errors.push('N° de chasis repetido dentro del archivo');
      else if (existing.chasis.has(chasis) && !existsInDb) errors.push('N° de chasis ya registrado en otra unidad');
    }

    const anio = parseInteger(v.anio);
    if (anio === 'invalid') errors.push('Año inválido');
    else if (anio !== null && (anio < 1950 || anio > currentYear + 1)) errors.push(`Año fuera de rango (1950-${currentYear + 1})`);

    const km = parseInteger(v.km_actual);
    if (km === 'invalid') errors.push('Kilometraje inválido');
    else if (km !== null && km < 0) errors.push('El kilometraje no puede ser negativo');

    const tires = parseInteger(v.tire_count);
    if (tires === 'invalid') errors.push('Cantidad de cubiertas inválida');
    else if (tires !== null && (tires < 0 || tires > 30)) errors.push('Cantidad de cubiertas fuera de rango (0-30)');

    const status = parseStatus(v.status);
    if (status === 'invalid') errors.push(`Estado no reconocido: "${v.status}" (use Operativo, Fuera de servicio, En taller o Baja)`);

    // Registros incompletos (advertencias, no bloquean)
    const missing = [
      !v.marca && 'marca',
      !v.modelo && 'modelo',
      !v.nro_interno && 'n° interno',
      !v.anio && 'año',
    ].filter(Boolean);
    if (missing.length) warnings.push(`Incompleto: falta ${missing.join(', ')}`);

    const categoryId = matchCategory(v, categories);
    if (v.category && !categoryId) warnings.push(`Categoría "${v.category}" no encontrada (quedará sin categoría)`);

    return {
      ...r,
      errors,
      warnings,
      dupInFile,
      existsInDb,
      categoryId,
      status: status === 'invalid' ? null : status,
    };
  });
}

/** Arma el registro a enviar a la base de datos. */
export function toPayload(r: ImportRow) {
  const v = r.values;
  const int = (s: string) => {
    const n = parseInteger(s);
    return n === 'invalid' ? null : n;
  };
  const txt = (s: string) => (s.trim() === '' ? null : s.trim());
  return {
    registro_nro: txt(v.registro_nro),
    patente: normalizePatente(v.patente),
    nro_interno: txt(v.nro_interno),
    marca: txt(v.marca),
    modelo: txt(v.modelo),
    version: txt(v.version),
    anio: int(v.anio),
    chasis: txt(v.chasis)?.toUpperCase() ?? null,
    motor: txt(v.motor)?.toUpperCase() ?? null,
    km_actual: int(v.km_actual),
    vehicle_type: txt(v.vehicle_type),
    category_id: r.categoryId,
    tire_type_size: txt(v.tire_type_size),
    tire_count: int(v.tire_count),
    status: r.status ?? 'operativo',
    observaciones: txt(v.observaciones),
  };
}

/** Descarga una planilla modelo vacía con los encabezados sugeridos. */
export function downloadTemplate() {
  const headers = IMPORT_FIELDS.map((f) => f.label);
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Flota');
  XLSX.writeFile(wb, 'Plantilla_Flota_RVGroup.xlsx');
}
