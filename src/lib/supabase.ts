import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('xxxxxxxx'));

export const supabase = createClient(url || 'http://localhost', anonKey || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Convierte errores de Supabase/PostgreSQL en mensajes comprensibles en español. */
export function friendlyError(err: unknown): string {
  if (!err) return 'Error desconocido';
  const e = err as { message?: string; code?: string; details?: string };
  const msg = e.message ?? String(err);
  if (e.code === '23505' || /duplicate key/i.test(msg)) {
    if (/patente/i.test(msg)) return 'Ya existe una unidad con esa patente.';
    if (/nro_interno/i.test(msg)) return 'Ya existe una unidad activa con ese número interno.';
    if (/chasis/i.test(msg)) return 'Ya existe una unidad con ese número de chasis.';
    if (/name/i.test(msg)) return 'Ya existe un registro con ese nombre.';
    return 'El registro ya existe (dato duplicado).';
  }
  if (e.code === '42501' || /row-level security|permission denied/i.test(msg))
    return 'No tiene permisos para realizar esta operación.';
  if (e.code === '23514') return 'Algún dato no cumple las validaciones (revise año, kilometraje o patente).';
  if (/Invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'El email aún no fue confirmado.';
  if (/banned/i.test(msg)) return 'El usuario está desactivado. Contacte al administrador.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sin conexión con el servidor. Verifique su conexión a internet.';
  return msg;
}
