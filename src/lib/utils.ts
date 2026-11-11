import { clsx, type ClassValue } from 'clsx';

export const cn = (...inputs: ClassValue[]) => clsx(inputs);

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('es-AR');
}

/** Convierte cadenas vacías en null. */
export function emptyToNull<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? v.trim() : v;
  }
  return out as T;
}

/** Normaliza texto para comparaciones (sin acentos, minúsculas, sin símbolos). */
export function slug(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Retorna el Nombre y Apellido formal del usuario en lugar del correo crudo.
 * Si no tiene nombre cargado, formatea el correo a nombre propio (ej: luis.rodriguez@... -> "Luis Rodriguez").
 */
export function getUserDisplayName(
  profile?: { full_name?: string | null; email?: string | null } | null,
  fallbackEmail?: string | null,
): string {
  if (profile?.full_name && profile.full_name.trim().length > 0) {
    return profile.full_name.trim();
  }
  const email = profile?.email || fallbackEmail || '';
  if (!email) return 'Usuario';

  const userPart = email.split('@')[0];
  if (!userPart) return 'Usuario';

  return userPart
    .split(/[._-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
