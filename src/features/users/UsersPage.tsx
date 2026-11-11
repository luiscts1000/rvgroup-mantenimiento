import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, Shield, KeyRound, Power, Pencil, Search, AlertCircle } from 'lucide-react';
import { Badge, Button, EmptyState, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase, friendlyError } from '@/lib/supabase';
import { MODULES, PERM_ACTIONS, ROLE_COLORS, ROLE_LABELS } from '@/lib/constants';
import { cn, formatDate, slug } from '@/lib/utils';
import type { AppRole, ModuleKey, Permission, Profile, UserPermissionOverride } from '@/types/db';

async function callAdminUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // Intenta recuperar el mensaje JSON de la función
    const ctx = (error as { context?: Response }).context;
    if (ctx) {
      try {
        const j = (await ctx.json()) as { error?: string };
        if (j?.error) throw new Error(j.error);
      } catch (e) {
        if (e instanceof Error && e.message !== error.message) throw e;
      }
    }
    if (/Failed to send|FunctionsFetchError|404/i.test(error.message)) {
      throw new Error(
        'La Edge Function "admin-users" aún no está desplegada en Supabase. Consulte el README para desplegarla o gestione el usuario desde el panel de Supabase > Authentication.',
      );
    }
    throw error;
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export function UsersPage() {
  const { profile: me, can, refresh } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | AppRole>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [pwdUser, setPwdUser] = useState<Profile | null>(null);
  const [permUser, setPermUser] = useState<Profile | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: rolePerms = [] } = useQuery({
    queryKey: ['role-permissions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('role_permissions').select('*');
      if (error) throw error;
      return data as (Permission & { role: AppRole })[];
    },
  });

  const filtered = useMemo(() => {
    const t = slug(q);
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (t && !slug(`${u.full_name} ${u.email} ${u.phone ?? ''}`).includes(t)) return false;
      return true;
    });
  }, [users, q, roleFilter]);

  const toggleActive = async (u: Profile) => {
    try {
      await callAdminUsers({ action: 'set_active', user_id: u.id, active: !u.active });
      toast.success(u.active ? 'Usuario desactivado' : 'Usuario activado');
      qc.invalidateQueries({ queryKey: ['profiles'] });
    } catch (err) {
      toast.error(friendlyError(err));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Usuarios y permisos"
        subtitle="Control de acceso por rol y permisos específicos por usuario"
        actions={
          can('users', 'create') && (
            <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
              Nuevo usuario
            </Button>
          )
        }
      />

      <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-3">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar por nombre, email o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as '' | AppRole)}>
          <option value="">Todos los roles</option>
          {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : !filtered.length ? (
          <EmptyState title="No se encontraron usuarios" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Alta</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium text-slate-900 dark:text-white">
                      {u.full_name || '—'}
                      {u.id === me?.id && <span className="ml-2 text-xs text-brand-600">(usted)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{u.phone ?? '—'}</td>
                    <td>
                      <Badge className={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    </td>
                    <td>
                      <Badge
                        className={
                          u.active
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                        }
                      >
                        {u.active ? 'Activo' : 'Desactivado'}
                      </Badge>
                    </td>
                    <td>{formatDate(u.created_at)}</td>
                    <td className="text-right">
                      {can('users', 'edit') && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" title="Editar datos y rol" onClick={() => setEditUser(u)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {u.role !== 'admin' && (
                            <Button size="sm" variant="ghost" title="Permisos específicos" onClick={() => setPermUser(u)}>
                              <Shield className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" title="Cambiar contraseña" onClick={() => setPwdUser(u)}>
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          {u.id !== me?.id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title={u.active ? 'Desactivar' : 'Activar'}
                              onClick={() => void toggleActive(u)}
                            >
                              <Power className={cn('h-4 w-4', u.active ? 'text-red-500' : 'text-emerald-500')} />
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Referencia de roles */}
      <div className="card p-4 text-xs text-slate-600 dark:text-slate-400">
        <p className="mb-2 font-semibold uppercase text-slate-500">Roles base del sistema</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div><b>Administrador:</b> Acceso total al sistema.</div>
          <div><b>Gerencia:</b> Consulta y exportación de flota, estadísticas, costos e historial.</div>
          <div><b>Mecánico:</b> Acceso a órdenes asignadas, carga de trabajos y consulta de unidades.</div>
          <div><b>Invitado:</b> Acceso limitado de consulta.</div>
        </div>
      </div>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        isAdmin={me?.role === 'admin'}
        onDone={() => qc.invalidateQueries({ queryKey: ['profiles'] })}
      />
      <EditUserModal
        user={editUser}
        isAdmin={me?.role === 'admin'}
        isSelf={editUser?.id === me?.id}
        onClose={() => setEditUser(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['profiles'] });
          void refresh();
        }}
      />
      <SetPasswordModal user={pwdUser} onClose={() => setPwdUser(null)} />
      <UserPermissionsModal
        user={permUser}
        rolePerms={rolePerms}
        onClose={() => setPermUser(null)}
        onDone={() => {
          if (permUser?.id === me?.id) void refresh();
        }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
function CreateUserModal({
  open,
  onClose,
  isAdmin,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  isAdmin: boolean;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AppRole>('mecanico');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setFullName('');
    setEmail('');
    setPhone('');
    setRole('mecanico');
    setPassword('');
    onClose();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await callAdminUsers({ action: 'create', full_name: fullName, email, phone, role, password });
      toast.success('Usuario creado correctamente');
      onDone();
      reset();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={reset}
      title="Nuevo usuario"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={reset}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={loading}>
            Crear usuario
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nombre y apellido" required>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field label="Email" required>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Teléfono">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Rol" required>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
            {(Object.keys(ROLE_LABELS) as AppRole[])
              .filter((r) => r !== 'admin' || isAdmin)
              .map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Contraseña inicial" required hint="Mínimo 8 caracteres">
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
function EditUserModal({
  user,
  isAdmin,
  isSelf,
  onClose,
  onDone,
}: {
  user: Profile | null;
  isAdmin: boolean;
  isSelf: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AppRole>('invitado');
  const [lastId, setLastId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (user && user.id !== lastId) {
    setLastId(user.id);
    setFullName(user.full_name);
    setPhone(user.phone ?? '');
    setRole(user.role);
  }
  if (!user && lastId) setLastId(null);

  async function save() {
    if (!user) return;
    setLoading(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null, role })
      .eq('id', user.id);
    setLoading(false);
    if (error) return toast.error(friendlyError(error));
    toast.success('Usuario actualizado');
    onDone();
    onClose();
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Editar usuario ${user?.email ?? ''}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={loading}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Nombre y apellido" required>
          <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field label="Teléfono">
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Rol" hint={isSelf && user?.role === 'admin' ? 'No puede quitarse a sí mismo el rol de administrador' : undefined}>
          <select
            className="input"
            value={role}
            disabled={isSelf && user?.role === 'admin'}
            onChange={(e) => setRole(e.target.value as AppRole)}
          >
            {(Object.keys(ROLE_LABELS) as AppRole[])
              .filter((r) => r !== 'admin' || isAdmin || user?.role === 'admin')
              .map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
function SetPasswordModal({ user, onClose }: { user: Profile | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function save() {
    if (!user) return;
    setLoading(true);
    try {
      await callAdminUsers({ action: 'set_password', user_id: user.id, password });
      toast.success('Contraseña actualizada');
      setPassword('');
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title={`Nueva contraseña para ${user?.full_name || user?.email || ''}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={loading}>
            Guardar
          </Button>
        </>
      }
    >
      <Field label="Nueva contraseña" required hint="Mínimo 8 caracteres">
        <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
type ActionKey = (typeof PERM_ACTIONS)[number]['key'];
type OverrideMap = Record<ModuleKey, Record<ActionKey, boolean | null>>;

function UserPermissionsModal({
  user,
  rolePerms,
  onClose,
  onDone,
}: {
  user: Profile | null;
  rolePerms: (Permission & { role: AppRole })[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [map, setMap] = useState<OverrideMap | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: overrides } = useQuery({
    queryKey: ['user-perms', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_permissions').select('*').eq('user_id', user!.id);
      if (error) throw error;
      return data as UserPermissionOverride[];
    },
  });

  if (user && overrides && loadedFor !== user.id) {
    const initial = {} as OverrideMap;
    for (const m of MODULES) {
      const row = overrides.find((o) => o.module === m.key);
      initial[m.key] = {
        can_view: row?.can_view ?? null,
        can_create: row?.can_create ?? null,
        can_edit: row?.can_edit ?? null,
        can_delete: row?.can_delete ?? null,
        can_export: row?.can_export ?? null,
      };
    }
    setMap(initial);
    setLoadedFor(user.id);
  }
  if (!user && loadedFor) {
    setLoadedFor(null);
    setMap(null);
  }

  const baseFor = (mod: ModuleKey, act: ActionKey): boolean => {
    const r = rolePerms.find((p) => p.role === user?.role && p.module === mod);
    return Boolean(r?.[act]);
  };

  // Ciclo al hacer clic: Heredar del rol (null) → Permitir (true) → Denegar (false)
  const cycle = (mod: ModuleKey, act: ActionKey) => {
    if (!map) return;
    const cur = map[mod][act];
    const next = cur === null ? true : cur === true ? false : null;
    setMap({ ...map, [mod]: { ...map[mod], [act]: next } });
  };

  async function save() {
    if (!user || !map) return;
    setSaving(true);
    try {
      const rows = MODULES.map((m) => ({ user_id: user.id, module: m.key, ...map[m.key] }));
      const { error } = await supabase.from('user_permissions').upsert(rows, { onConflict: 'user_id,module' });
      if (error) throw error;
      toast.success('Permisos guardados');
      onDone();
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      size="lg"
      title={`Permisos específicos: ${user?.full_name || user?.email || ''}`}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              if (!map) return;
              const cleared = {} as OverrideMap;
              MODULES.forEach((m) => (cleared[m.key] = { can_view: null, can_create: null, can_edit: null, can_delete: null, can_export: null }));
              setMap(cleared);
            }}
          >
            Restablecer al rol ({user ? ROLE_LABELS[user.role] : ''})
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Guardar permisos
          </Button>
        </>
      }
    >
      {!map ? (
        <Spinner />
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <AlertCircle className="h-4 w-4 shrink-0 text-brand-600" />
            Haga clic en cada celda para alternar entre: <b>Hereda del rol</b> → <b className="text-emerald-600">Permitido</b> →{' '}
            <b className="text-red-600">Denegado</b>. Los permisos se aplican también en la base de datos (RLS).
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Módulo</th>
                  {PERM_ACTIONS.map((a) => (
                    <th key={a.key} className="text-center">
                      {a.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {MODULES.map((m) => (
                  <tr key={m.key}>
                    <td className="font-medium">{m.label}</td>
                    {PERM_ACTIONS.map((a) => {
                      const val = map[m.key][a.key];
                      const base = baseFor(m.key, a.key);
                      const effective = val ?? base;
                      return (
                        <td key={a.key} className="text-center">
                          <button
                            type="button"
                            onClick={() => cycle(m.key, a.key)}
                            className={cn(
                              'rounded-md px-2.5 py-1 text-xs font-medium transition',
                              val === null && (base ? 'bg-slate-100 text-emerald-700 dark:bg-slate-800' : 'bg-slate-100 text-slate-400 dark:bg-slate-800'),
                              val === true && 'bg-emerald-600 text-white',
                              val === false && 'bg-red-600 text-white',
                            )}
                          >
                            {val === null ? (effective ? 'Rol: Sí' : 'Rol: No') : val ? 'Sí' : 'No'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
