// =============================================================================
// Edge Function: admin-users
// Alta de usuarios, cambio de contraseña y activación/desactivación.
// Requiere la clave service_role, que SOLO vive en los secretos de Supabase
// (nunca en el navegador). Despliegue: ver README.md
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = ['admin', 'gerencia', 'mecanico', 'invitado'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // Cliente con la identidad del usuario que llama (para verificar permisos)
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Sesión inválida' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Solicitud inválida' }, 400);
  }
  const action = String(body.action ?? '');

  const can = async (perm: string) => {
    const { data } = await asUser.rpc('has_permission', { p_module: 'users', p_action: perm });
    return data === true;
  };
  const { data: isAdmin } = await asUser.rpc('is_admin');

  try {
    if (action === 'create') {
      if (!(await can('create'))) return json({ error: 'No tiene permiso para crear usuarios' }, 403);
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const full_name = String(body.full_name ?? '').trim();
      const role = String(body.role ?? 'invitado');
      const phone = body.phone ? String(body.phone).trim() : null;

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Email inválido' }, 400);
      if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
      if (!full_name) return json({ error: 'El nombre es obligatorio' }, 400);
      if (!ROLES.includes(role)) return json({ error: 'Rol inválido' }, 400);
      if (role === 'admin' && !isAdmin) return json({ error: 'Solo un administrador puede crear administradores' }, 403);

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
        app_metadata: { role },
      });
      if (error) {
        const msg = /already|registered|exists/i.test(error.message) ? 'Ya existe un usuario con ese email' : error.message;
        return json({ error: msg }, 400);
      }
      await admin.from('profiles').update({ full_name, role, phone }).eq('id', data.user.id);
      await admin.from('audit_log').insert({
        table_name: 'profiles', record_id: data.user.id, action: 'INSERT',
        new_data: { email, full_name, role, phone }, changed_fields: null,
        user_id: userData.user.id, user_email: userData.user.email,
      });
      return json({ ok: true, id: data.user.id });
    }

    if (action === 'set_password') {
      if (!(await can('edit'))) return json({ error: 'No tiene permiso para modificar usuarios' }, 403);
      const id = String(body.user_id ?? '');
      const password = String(body.password ?? '');
      if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400);
      const { data: target } = await admin.from('profiles').select('role').eq('id', id).single();
      if (target?.role === 'admin' && !isAdmin) return json({ error: 'Solo un administrador puede modificar a otro administrador' }, 403);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'set_active') {
      if (!(await can('edit'))) return json({ error: 'No tiene permiso para modificar usuarios' }, 403);
      const id = String(body.user_id ?? '');
      const active = body.active === true;
      if (id === userData.user.id) return json({ error: 'No puede desactivarse a sí mismo' }, 400);
      const { data: target } = await admin.from('profiles').select('role').eq('id', id).single();
      if (target?.role === 'admin' && !isAdmin) return json({ error: 'Solo un administrador puede modificar a otro administrador' }, 403);
      // Bloquea/desbloquea el inicio de sesión en Auth y marca el perfil
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ active }).eq('id', id);
      // Registro de auditoría explícito (la llamada con service_role no tiene auth.uid())
      await admin.from('audit_log').insert({
        table_name: 'profiles', record_id: id, action: 'UPDATE',
        new_data: { active }, changed_fields: ['active'],
        user_id: userData.user.id, user_email: userData.user.email,
      });
      return json({ ok: true });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error inesperado' }, 500);
  }
});
