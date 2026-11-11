/** Normaliza una patente: mayúsculas, sin espacios, guiones ni puntos. */
export function normalizePatente(value: unknown): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const OLD_FORMAT = /^[A-Z]{3}[0-9]{3}$/; // AAA123 (formato anterior)
const MERCOSUR_FORMAT = /^[A-Z]{2}[0-9]{3}[A-Z]{2}$/; // AA123BB (Mercosur)

export type PatenteCheck = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * Valida una patente argentina.
 * - Formatos estándar: AAA123 y AA123BB.
 * - Otros formatos alfanuméricos de 5 a 10 caracteres se aceptan con advertencia
 *   (casos especiales: patentes antiguas, extranjeras o provisorias).
 */
export function checkPatente(raw: unknown): PatenteCheck {
  const p = normalizePatente(raw);
  if (!p) return { ok: false, error: 'La patente es obligatoria' };
  if (p.length < 5 || p.length > 10) return { ok: false, error: 'La patente debe tener entre 5 y 10 caracteres' };
  if (OLD_FORMAT.test(p) || MERCOSUR_FORMAT.test(p)) return { ok: true };
  return { ok: true, warning: 'Formato no estándar (se esperaba AAA123 o AA123BB)' };
}

/** Muestra la patente con formato legible: AB 123 CD / ABC 123. */
export function formatPatente(p: string | null | undefined): string {
  if (!p) return '';
  if (MERCOSUR_FORMAT.test(p)) return `${p.slice(0, 2)} ${p.slice(2, 5)} ${p.slice(5)}`;
  if (OLD_FORMAT.test(p)) return `${p.slice(0, 3)} ${p.slice(3)}`;
  return p;
}
