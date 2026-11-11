import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Sparkles, History, FolderTree, FileSpreadsheet, AlertTriangle, RotateCcw } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase, friendlyError } from '@/lib/supabase';
import { formatDate } from '@/lib/utils';
import { useCategories, useFleetStats, useImportBatches } from '@/features/vehicles/api';
import type { AuditEntry, VehicleCategory } from '@/types/db';

// Unidades FICTICIAS de demostración. Se registran con is_demo = true y la etiqueta [DATO DE DEMOSTRACIÓN].
const DEMO_VEHICLES = [
  { patente: 'AE101AA', nro_interno: 'DEMO-01', marca: 'Ford', modelo: 'Ranger', version: '2.2', anio: 2021, km_actual: 98400, vehicle_type: 'Pick-up', status: 'operativo' },
  { patente: 'AF202BB', nro_interno: 'DEMO-02', marca: 'Ford', modelo: 'Ranger', version: '2.0', anio: 2023, km_actual: 41200, vehicle_type: 'Pick-up', status: 'operativo' },
  { patente: 'AD303CC', nro_interno: 'DEMO-03', marca: 'Mercedes-Benz', modelo: 'Sprinter', version: '414', anio: 2020, km_actual: 162000, vehicle_type: 'Furgón', status: 'operativo' },
  { patente: 'AE404DD', nro_interno: 'DEMO-04', marca: 'Mercedes-Benz', modelo: 'Sprinter', version: '416', anio: 2021, km_actual: 134500, vehicle_type: 'Minibús', status: 'en_taller' },
  { patente: 'AC505EE', nro_interno: 'DEMO-05', marca: 'Mercedes-Benz', modelo: 'Sprinter', version: '515', anio: 2019, km_actual: 215000, vehicle_type: 'Minibús', status: 'operativo' },
  { patente: 'AF606FF', nro_interno: 'DEMO-06', marca: 'Mercedes-Benz', modelo: 'Sprinter', version: '516', anio: 2022, km_actual: 87300, vehicle_type: 'Minibús', status: 'operativo' },
  { patente: 'AG707GG', nro_interno: 'DEMO-07', marca: 'Mercedes-Benz', modelo: 'Sprinter', version: '517', anio: 2024, km_actual: 19800, vehicle_type: 'Minibús', status: 'operativo' },
  { patente: 'AD808HH', nro_interno: 'DEMO-08', marca: 'Iveco', modelo: 'Daily', version: 'Minibús', anio: 2020, km_actual: 178900, vehicle_type: 'Minibús', status: 'fuera_de_servicio' },
];

export function SettingsPage() {
  const { profile, can } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'categorias' | 'importaciones' | 'auditoria' | 'demo'>('categorias');
  const { data: categories = [], isLoading: catLoading } = useCategories();
  const { data: batches = [], isLoading: batchLoading } = useImportBatches();
  const { data: stats } = useFleetStats();
  const [editingCat, setEditingCat] = useState<VehicleCategory | 'new' | null>(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [confirmClearDemo, setConfirmClearDemo] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  const isAdmin = profile?.role === 'admin';
  const canEdit = can('settings', 'edit');

  const { data: audit = [], isLoading: auditLoading } = useQuery({
    queryKey: ['audit-all'],
    enabled: tab === 'auditoria' && isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data as AuditEntry[];
    },
  });

  async function loadDemo() {
    setDemoLoading(true);
    try {
      const byName = (part: string) => categories.find((c) => c.name.toLowerCase().includes(part.toLowerCase()))?.id ?? null;
      const rows = DEMO_VEHICLES.map((v) => ({
        ...v,
        category_id:
          v.modelo === 'Ranger' ? byName(`Ranger ${v.version}`) : v.modelo === 'Sprinter' ? byName(`Sprinter ${v.version}`) : byName('Minibuses'),
        observaciones: '[DATO DE DEMOSTRACIÓN – FICTICIO]',
      }));
      const { data, error } = await supabase.rpc('import_vehicles', {
        p_file_name: 'DEMO_FICTICIO',
        p_mapping: {},
        p_rows: rows,
        p_is_demo: true,
      });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      toast.success(`Se cargaron ${(data as { inserted: number }).inserted} unidades de demostración`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setDemoLoading(false);
    }
  }

  async function clearDemo() {
    setDemoLoading(true);
    try {
      const { data, error } = await supabase.rpc('delete_demo_data');
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      toast.success(`Se eliminaron ${data} unidades de demostración`);
      setConfirmClearDemo(false);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setDemoLoading(false);
    }
  }

  const tabs = [
    { key: 'categorias', label: 'Categorías de unidades', icon: FolderTree },
    { key: 'importaciones', label: 'Historial de importaciones', icon: FileSpreadsheet },
    ...(isAdmin ? [{ key: 'auditoria', label: 'Registro de auditoría', icon: History }] : []),
    ...(isAdmin ? [{ key: 'demo', label: 'Datos de demostración', icon: Sparkles }] : []),
  ] as const;

  return (
    <div className="space-y-5">
      <PageHeader title="Configuración" subtitle="Parámetros del sistema, categorías, importaciones y auditoría" />

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === t.key ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Categorías */}
      {tab === 'categorias' && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
            <div>
              <h2 className="font-semibold">Categorías de vehículos</h2>
              <p className="text-xs text-slate-500">
                En la Etapa 3 cada categoría se vinculará con sus servicios predefinidos y compatibilidad de filtros/repuestos.
              </p>
            </div>
            {canEdit && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditingCat('new')}>
                Nueva categoría
              </Button>
            )}
          </div>
          {catLoading ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Nombre</th>
                    <th>Marca</th>
                    <th>Modelo</th>
                    <th>Versión</th>
                    <th>Estado</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {categories.map((c) => (
                    <tr key={c.id}>
                      <td>{c.sort_order}</td>
                      <td className="font-medium text-slate-900 dark:text-white">{c.name}</td>
                      <td>{c.brand ?? '—'}</td>
                      <td>{c.model ?? '—'}</td>
                      <td>{c.version ?? '—'}</td>
                      <td>
                        <Badge className={c.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}>
                          {c.active ? 'Activa' : 'Inactiva'}
                        </Badge>
                      </td>
                      <td className="text-right">
                        {canEdit && (
                          <Button size="sm" variant="ghost" onClick={() => setEditingCat(c)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Lotes de importación */}
      {tab === 'importaciones' && (
        <div className="card overflow-hidden">
          {batchLoading ? (
            <Spinner />
          ) : !batches.length ? (
            <EmptyState title="Aún no se realizaron importaciones" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Archivo</th>
                    <th>Filas</th>
                    <th>Registradas</th>
                    <th>Omitidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td>{formatDate(b.created_at, true)}</td>
                      <td className="font-medium">{b.file_name}</td>
                      <td>{b.total_rows}</td>
                      <td className="font-semibold text-emerald-600">{b.inserted}</td>
                      <td>{b.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Auditoría */}
      {tab === 'auditoria' && isAdmin && (
        <div className="card overflow-hidden">
          {auditLoading ? (
            <Spinner />
          ) : !audit.length ? (
            <EmptyState title="Sin registros de auditoría" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Tabla</th>
                    <th>Acción</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {audit.map((a) => (
                    <tr key={a.id}>
                      <td>{formatDate(a.created_at, true)}</td>
                      <td>{a.user_email ?? 'Sistema'}</td>
                      <td className="font-mono text-xs">{a.table_name}</td>
                      <td>
                        <Badge
                          className={
                            a.action === 'INSERT'
                              ? 'bg-emerald-100 text-emerald-800'
                              : a.action === 'DELETE'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-blue-100 text-blue-800'
                          }
                        >
                          {a.action}
                        </Badge>
                      </td>
                      <td className="max-w-md truncate text-xs text-slate-500">
                        {(a.new_data?.patente as string) || (a.old_data?.patente as string) || (a.new_data?.email as string) || a.record_id}{' '}
                        {a.changed_fields?.length ? `(${a.changed_fields.join(', ')})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Datos de demostración y Reseteo de pruebas (exclusivo Administrador) */}
      {tab === 'demo' && isAdmin && (
        <div className="space-y-5">
          <div className="card max-w-2xl space-y-4 p-5">
            <h2 className="font-semibold">Datos de demostración (solo para pruebas)</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Permite cargar 8 unidades <b>ficticias</b> (una por cada categoría precargada) para probar el panel, los filtros y la
              exportación antes de importar la flota real. Todas quedan identificadas con la etiqueta <b>DEMO</b> y pueden eliminarse por
              completo en cualquier momento sin afectar las unidades reales.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button icon={<Sparkles className="h-4 w-4" />} loading={demoLoading} onClick={() => void loadDemo()}>
                Cargar 8 unidades de demostración
              </Button>
              {(stats?.demo ?? 0) > 0 && (
                <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmClearDemo(true)}>
                  Eliminar datos de demostración ({stats?.demo})
                </Button>
              )}
            </div>
          </div>

          <div className="card max-w-2xl space-y-4 border-red-300 p-5 dark:border-red-900/60">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="font-semibold">Resetear todo el sistema (modo de prueba · solo Administrador)</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Elimina de una sola vez <b>todas las unidades cargadas</b>, <b>todas las órdenes de reparación</b>, el historial de
              importaciones y el registro de auditoría, reiniciando el contador de órdenes en <code>OR-00001</code>.
              <br />
              <b>Se conservan intactos:</b> los usuarios, los permisos y las 8 categorías iniciales de RV Group.
            </p>
            <div>
              <Button
                variant="danger"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={() => {
                  setResetPassword('');
                  setResetOpen(true);
                }}
              >
                Resetear todos los datos cargados…
              </Button>
            </div>
          </div>
        </div>
      )}

      <CategoryModal
        category={editingCat}
        onClose={() => setEditingCat(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['categories'] })}
      />
      <ConfirmDialog
        open={confirmClearDemo}
        onClose={() => setConfirmClearDemo(false)}
        danger
        loading={demoLoading}
        title="Eliminar datos de demostración"
        confirmLabel="Eliminar"
        message="Se eliminarán únicamente las unidades marcadas como DEMO. Las unidades reales de RV Group no se tocan."
        onConfirm={() => void clearDemo()}
      />

      {isAdmin && (
        <Modal
          open={resetOpen}
          onClose={() => !resetLoading && setResetOpen(false)}
          size="sm"
          title="Confirmar reseteo total de datos"
          footer={
            <>
              <Button variant="secondary" disabled={resetLoading} onClick={() => setResetOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                loading={resetLoading}
                disabled={!resetPassword}
                onClick={async () => {
                  setResetLoading(true);
                  try {
                    const { data, error } = await supabase.rpc('admin_reset_system_data', {
                      p_admin_password: resetPassword,
                    });
                    if (error) throw error;
                    const res = data as { deleted_vehicles: number; deleted_work_orders: number };
                    await qc.invalidateQueries();
                    toast.success(
                      `Sistema reseteado: ${res.deleted_vehicles} unidades y ${res.deleted_work_orders} órdenes eliminadas.`,
                    );
                    setResetOpen(false);
                    setResetPassword('');
                  } catch (err) {
                    toast.error(friendlyError(err));
                  } finally {
                    setResetLoading(false);
                  }
                }}
              >
                Vaciar datos ahora
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
              Esta acción vaciará todas las unidades, órdenes de reparación e importaciones registradas hasta el momento.
            </div>
            <Field label={`Contraseña de administrador (${profile?.email ?? ''})`} required>
              <input
                type="password"
                className="input"
                autoFocus
                placeholder="Ingrese su contraseña actual para autorizar"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
              />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CategoryModal({
  category,
  onClose,
  onSaved,
}: {
  category: VehicleCategory | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = category === 'new';
  const c = isNew ? null : category;
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [version, setVersion] = useState('');
  const [sortOrder, setSortOrder] = useState('100');
  const [active, setActive] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const key = category === 'new' ? 'new' : category?.id ?? null;
  if (key && key !== lastKey) {
    setLastKey(key);
    setName(c?.name ?? '');
    setBrand(c?.brand ?? '');
    setModel(c?.model ?? '');
    setVersion(c?.version ?? '');
    setSortOrder(String(c?.sort_order ?? 100));
    setActive(c?.active ?? true);
  }
  if (!key && lastKey) setLastKey(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error('El nombre es obligatorio');
    setLoading(true);
    const payload = {
      name: name.trim(),
      brand: brand.trim() || null,
      model: model.trim() || null,
      version: version.trim() || null,
      sort_order: parseInt(sortOrder, 10) || 100,
      active,
    };
    const { error } = isNew
      ? await supabase.from('vehicle_categories').insert(payload)
      : await supabase.from('vehicle_categories').update(payload).eq('id', c!.id);
    setLoading(false);
    if (error) return toast.error(friendlyError(error));
    toast.success(isNew ? 'Categoría creada' : 'Categoría actualizada');
    onSaved();
    onClose();
  }

  return (
    <Modal
      open={!!category}
      onClose={onClose}
      size="sm"
      title={isNew ? 'Nueva categoría' : 'Editar categoría'}
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
      <form onSubmit={save} className="space-y-3">
        <Field label="Nombre" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Ej.: Ford Ranger 2.2" />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Marca">
            <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="Modelo">
            <input className="input" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <Field label="Versión">
            <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Orden">
            <input className="input" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
          <Field label="Estado">
            <select className="input" value={active ? '1' : '0'} onChange={(e) => setActive(e.target.value === '1')}>
              <option value="1">Activa</option>
              <option value="0">Inactiva</option>
            </select>
          </Field>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
