import type { PreventiveInspection, Vehicle } from '@/types/db';

const STORAGE_KEY_VEHICLES = 'rvgroup_rto_provincial_vehicles_v1';
const STORAGE_KEY_INSPECTIONS = 'rvgroup_rto_provincial_inspections_v1';
const RTO_PROV_TAG_REGEX = /\s*\[RTO_PROV:([^\]]*)\]\s*/g;
const RTO_PROV_TAG_MATCH = /\[RTO_PROV:([^\]]*)\]/;

function readMap(key: string): Record<string, string | null> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string | null>;
  } catch {
    return {};
  }
}

function writeMap(key: string, map: Record<string, string | null>) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function setLocalProvincialRto(vehicleId: string, date: string | null | undefined) {
  if (!vehicleId) return;
  const map = readMap(STORAGE_KEY_VEHICLES);
  map[vehicleId] = date || null;
  writeMap(STORAGE_KEY_VEHICLES, map);
}

export function getLocalProvincialRto(vehicleId: string): string | null | undefined {
  if (!vehicleId) return undefined;
  const map = readMap(STORAGE_KEY_VEHICLES);
  return map[vehicleId];
}

export function setLocalInspectionProvincialRto(inspectionId: string, date: string | null | undefined) {
  if (!inspectionId) return;
  const map = readMap(STORAGE_KEY_INSPECTIONS);
  map[inspectionId] = date || null;
  writeMap(STORAGE_KEY_INSPECTIONS, map);
}

export function getLocalInspectionProvincialRto(inspectionId: string): string | null | undefined {
  if (!inspectionId) return undefined;
  const map = readMap(STORAGE_KEY_INSPECTIONS);
  return map[inspectionId];
}

/**
 * Extrae la fecha de RTO Provincial embebida en observaciones (si la columna nativa aún no existe en Supabase)
 * y devuelve las observaciones limpias para mostrar en la interfaz.
 */
export function parseTextWithProvincialRto(
  rawText: string | null | undefined,
  nativeColumnValue?: string | null,
  recordId?: string,
  isInspection = false,
): { cleanText: string | null; rtoProvincialDueDate: string | null } {
  const text = rawText ?? '';
  const match = text.match(RTO_PROV_TAG_MATCH);
  const tagDate = match ? (match[1]?.trim() || null) : undefined;
  const cleaned = text.replace(RTO_PROV_TAG_REGEX, '\n').trim();
  const cleanText = cleaned.length > 0 ? cleaned : null;

  let resolved: string | null = null;
  if (nativeColumnValue !== undefined && nativeColumnValue !== null && nativeColumnValue !== '') {
    resolved = nativeColumnValue;
  } else if (tagDate !== undefined) {
    resolved = tagDate;
  } else if (recordId) {
    const localVal = isInspection ? getLocalInspectionProvincialRto(recordId) : getLocalProvincialRto(recordId);
    if (localVal !== undefined) {
      resolved = localVal;
    }
  }

  if (recordId && resolved !== null) {
    if (isInspection) {
      setLocalInspectionProvincialRto(recordId, resolved);
    } else {
      setLocalProvincialRto(recordId, resolved);
    }
  }

  return { cleanText, rtoProvincialDueDate: resolved };
}

/**
 * Inserta o actualiza el marcador [RTO_PROV:YYYY-MM-DD] dentro del campo observaciones
 * para persistir en la nube de Supabase cuando la columna rto_provincial_due_date aún no fue migrada.
 */
export function injectProvincialRtoInText(
  rawText: string | null | undefined,
  rtoProvincialDate: string | null | undefined,
): string | null {
  const base = (rawText ?? '').replace(RTO_PROV_TAG_REGEX, '\n').trim();
  const cleanDate = rtoProvincialDate?.trim() || '';
  if (!cleanDate) {
    return base.length > 0 ? base : null;
  }
  const tag = `[RTO_PROV:${cleanDate}]`;
  return base.length > 0 ? `${base}\n${tag}` : tag;
}

export function normalizeVehicleProvincialRto<T extends Vehicle>(v: T): T {
  const { cleanText, rtoProvincialDueDate } = parseTextWithProvincialRto(
    v.observaciones,
    v.rto_provincial_due_date,
    v.id,
    false,
  );
  return {
    ...v,
    observaciones: cleanText,
    rto_provincial_due_date: rtoProvincialDueDate,
  };
}

export function normalizeInspectionProvincialRto<T extends PreventiveInspection>(insp: T): T {
  const { cleanText, rtoProvincialDueDate } = parseTextWithProvincialRto(
    insp.observations,
    insp.rto_provincial_due_date,
    insp.id,
    true,
  );
  return {
    ...insp,
    observations: cleanText,
    rto_provincial_due_date: rtoProvincialDueDate,
  };
}

export function isMissingProvincialRtoColumnError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { message?: string; code?: string; details?: string };
  const msg = `${e.message ?? ''} ${e.details ?? ''}`.toLowerCase();
  return msg.includes('rto_provincial_due_date');
}
