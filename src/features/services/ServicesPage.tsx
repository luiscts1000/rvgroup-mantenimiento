import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, ListChecks, FolderTree, Truck, Info } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Modal, PageHeader, Spinner } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories, useVehicles } from '@/features/vehicles/api';
import { useParts } from '@/features/inventory/api';
import { friendlyError, supabase } from '@/lib/supabase';
import { FILTER_ROLE_SUGGESTIONS, MAINTENANCE_TYPE_LABELS } from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { cn } from '@/lib/utils';
import type { MaintenanceType, ServiceTemplate, ServiceType } from '@/types/db';

export function useServiceTypes() {
  return useQuery({
    queryKey: ['service-types'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_types').select('*').order('sort_order').order('name');
      if (error) throw error;
      return data as ServiceType[];
    },
  });
}

export function useServiceTemplates() {
  return useQuery({
    queryKey: ['service-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_templates')
        .select(
          '*, service_types(name), vehicle_categories(name), vehicles(patente, nro_interno, marca, modelo, version), service_template_items(*)',
        )
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as ServiceTemplate[];
    },
  });
}

export function ServicesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: serviceTypes = [], isLoading: stLoading } = useServiceTypes();
  const { data: templates = [], isLoading: tplLoading } = useServiceTemplates();
  const { data: categories = [] } = useCategories();

  const [scopeTab, setScopeTab] = useState<'categoria' | 'patente' | 'tipos'>('categoria');
  const [filterCat, setFilterCat] = useState('');
  const [filterService, setFilterService] = useState('');
  const [editingTpl, setEditingTpl] = useState<ServiceTemplate | 'new-cat' | 'new-veh' | null>(null);
  const [deleteTpl, setDeleteTpl] = useState<ServiceTemplate | null>(null);
  const [newServiceOpen, setNewServiceOpen] = useState(false);

  const canEdit = can('services', 'edit') || can('services', 'create');

  const categoryTemplates = useMemo(
    () =>
      templates.filter(
        (t) =>
          t.category_id !== null &&
          (!filterCat || t.category_id === filterCat) &&
          (!filterService || t.service_type_id === filterService),
      ),
    [templates, filterCat, filterService],
  );

  const vehicleTemplates = useMemo(
    () => templates.filter((t) => t.vehicle_id !== null && (!filterService || t.service_type_id === filterService)),
    [templates, filterService],
  );

  const delMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('service_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-templates'] });
      toast.success('Configuración eliminada');
      setDeleteTpl(null);
    },
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Servicios predefinidos y configuración de repuestos"
        subtitle="Configuración de filtros, lubricantes y repuestos por modelo/categoría y por patente individual"
        actions={
          canEdit && (
            <>
              <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setNewServiceOpen(true)}>
                Nuevo tipo de servicio
              </Button>
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => setEditingTpl(scopeTab === 'patente' ? 'new-veh' : 'new-cat')}
              >
                {scopeTab === 'patente' ? 'Configurar para una patente' : 'Configurar para un modelo'}
              </Button>
            </>
          )
        }
      />

      <div className="flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50/70 p-3.5 text-xs text-brand-900 dark:border-brand-900/50 dark:bg-brand-950/30 dark:text-brand-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <b>Cómo funciona al abrir una Orden de Reparación:</b> cuando seleccione una patente y un servicio (por ejemplo,{' '}
          <i>Servicio básico</i> en una <i>Ford Ranger 2.2</i> o en una <i>Sprinter 516</i>), el sistema buscará primero si esa{' '}
          <b>patente individual</b> tiene una configuración propia; si no, aplicará automáticamente la configuración de su{' '}
          <b>modelo/categoría</b> proponiendo filtros, códigos, cantidades y litros de aceite.
        </div>
      </div>

      {/* Pestañas */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
        <button
          onClick={() => setScopeTab('categoria')}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
            scopeTab === 'categoria'
              ? 'bg-brand-700 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          <FolderTree className="h-4 w-4" /> Por modelo / categoría ({templates.filter((t) => t.category_id).length})
        </button>
        <button
          onClick={() => setScopeTab('patente')}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
            scopeTab === 'patente'
              ? 'bg-brand-700 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          <Truck className="h-4 w-4" /> Por patente individual ({templates.filter((t) => t.vehicle_id).length})
        </button>
        <button
          onClick={() => setScopeTab('tipos')}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium',
            scopeTab === 'tipos'
              ? 'bg-brand-700 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          <ListChecks className="h-4 w-4" /> Catálogo de servicios ({serviceTypes.length})
        </button>
      </div>

      {scopeTab !== 'tipos' && (
        <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
          {scopeTab === 'categoria' && (
            <select className="input" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
              <option value="">Todos los modelos / categorías</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <select className="input" value={filterService} onChange={(e) => setFilterService(e.target.value)}>
            <option value="">Todos los servicios</option>
            {serviceTypes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Listado de configuraciones por modelo o por patente */}
      {(scopeTab === 'categoria' || scopeTab === 'patente') && (
        <div>
          {tplLoading ? (
            <Spinner />
          ) : !(scopeTab === 'categoria' ? categoryTemplates : vehicleTemplates).length ? (
            <div className="card">
              <EmptyState
                title={
                  scopeTab === 'categoria'
                    ? 'Aún no hay servicios configurados por modelo/categoría'
                    : 'Aún no hay configuraciones específicas por patente'
                }
                description={
                  scopeTab === 'categoria'
                    ? 'Configure qué filtros, repuestos y litros de aceite utiliza cada modelo (Ford Ranger 2.2, Ranger 2.0, Sprinter 414/416/515/516/517, Minibuses).'
                    : 'Use esta pestaña cuando una unidad particular utilice repuestos o filtros distintos a los del resto de su modelo.'
                }
                action={
                  canEdit && (
                    <Button
                      icon={<Plus className="h-4 w-4" />}
                      onClick={() => setEditingTpl(scopeTab === 'patente' ? 'new-veh' : 'new-cat')}
                    >
                      Crear primera configuración
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {(scopeTab === 'categoria' ? categoryTemplates : vehicleTemplates).map((tpl) => {
                const items = [...(tpl.service_template_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
                return (
                  <div key={tpl.id} className="card flex flex-col justify-between p-4">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                              {tpl.service_types?.name}
                            </Badge>
                            {tpl.vehicle_categories ? (
                              <span className="font-semibold text-slate-900 dark:text-white">{tpl.vehicle_categories.name}</span>
                            ) : tpl.vehicles ? (
                              <span className="font-mono font-bold text-slate-900 dark:text-white">
                                {formatPatente(tpl.vehicles.patente)}{' '}
                                <span className="font-sans text-xs font-normal text-slate-500">
                                  {[tpl.vehicles.marca, tpl.vehicles.modelo, tpl.vehicles.version].filter(Boolean).join(' ')}
                                </span>
                              </span>
                            ) : null}
                          </div>
                          {(tpl.oil_type || tpl.oil_liters != null) && (
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                              Aceite: <b>{tpl.oil_type || 'Seg/especificación'}</b>
                              {tpl.oil_liters != null ? ` · ${tpl.oil_liters} litros` : ''}
                              {tpl.other_fluids ? ` · Fluidos: ${tpl.other_fluids}` : ''}
                            </p>
                          )}
                        </div>
                        {canEdit && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setEditingTpl(tpl)} title="Editar">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleteTpl(tpl)} title="Eliminar">
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        )}
                      </div>

                      {items.length > 0 ? (
                        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 px-3 py-1 text-xs dark:divide-slate-800 dark:border-slate-800">
                          {items.map((it) => (
                            <li key={it.id} className="flex items-center justify-between py-1.5">
                              <div>
                                {it.role_label && <b className="text-brand-700 dark:text-brand-300">{it.role_label}: </b>}
                                <span>{it.description}</span>
                                {it.part_code && <span className="ml-1.5 font-mono text-slate-500">[{it.part_code}]</span>}
                                {it.optional && <span className="ml-1.5 italic text-amber-600">(según servicio)</span>}
                              </div>
                              <span className="font-mono font-semibold">
                                {it.quantity} {it.unit}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">Sin repuestos asociados en la lista.</p>
                      )}
                      {tpl.notes && <p className="mt-2 text-xs text-slate-500">{tpl.notes}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Catálogo de tipos de servicio */}
      {scopeTab === 'tipos' && (
        <div className="card overflow-hidden">
          {stLoading ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Servicio</th>
                    <th>Tipo de mantenimiento por defecto</th>
                    <th>Configuraciones activas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {serviceTypes.map((s) => (
                    <tr key={s.id}>
                      <td>{s.sort_order}</td>
                      <td className="font-semibold text-slate-900 dark:text-white">{s.name}</td>
                      <td>{MAINTENANCE_TYPE_LABELS[s.default_maint_type]}</td>
                      <td>{templates.filter((t) => t.service_type_id === s.id).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <TemplateFormModal
        target={editingTpl}
        serviceTypes={serviceTypes}
        onClose={() => setEditingTpl(null)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['service-templates'] })}
      />

      <NewServiceTypeModal
        open={newServiceOpen}
        onClose={() => setNewServiceOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ['service-types'] })}
      />

      <ConfirmDialog
        open={!!deleteTpl}
        onClose={() => setDeleteTpl(null)}
        danger
        loading={delMutation.isPending}
        title="Eliminar configuración de servicio"
        confirmLabel="Eliminar"
        message="¿Desea eliminar esta plantilla de configuración? Las órdenes de reparación ya emitidas no se ven afectadas."
        onConfirm={() => deleteTpl && delMutation.mutate(deleteTpl.id)}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
interface DraftTemplateItem {
  role_label: string;
  part_id: string;
  part_code: string;
  description: string;
  quantity: string;
  unit: string;
  optional: boolean;
}

function TemplateFormModal({
  target,
  serviceTypes,
  onClose,
  onSaved,
}: {
  target: ServiceTemplate | 'new-cat' | 'new-veh' | null;
  serviceTypes: ServiceType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: categories = [] } = useCategories();
  const { data: vehicles = [] } = useVehicles();
  const { data: parts = [] } = useParts();

  const existing = typeof target === 'object' && target ? target : null;
  const [scope, setScope] = useState<'categoria' | 'patente'>('categoria');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [oilType, setOilType] = useState('');
  const [oilLiters, setOilLiters] = useState('');
  const [otherFluids, setOtherFluids] = useState('');
  const [defaultWork, setDefaultWork] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftTemplateItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const key = target ? (typeof target === 'string' ? target : target.id) : null;
  if (key && key !== lastKey) {
    setLastKey(key);
    if (existing) {
      setScope(existing.vehicle_id ? 'patente' : 'categoria');
      setServiceTypeId(existing.service_type_id);
      setCategoryId(existing.category_id ?? '');
      setVehicleId(existing.vehicle_id ?? '');
      setOilType(existing.oil_type ?? '');
      setOilLiters(existing.oil_liters != null ? String(existing.oil_liters) : '');
      setOtherFluids(existing.other_fluids ?? '');
      setDefaultWork(existing.default_work ?? '');
      setNotes(existing.notes ?? '');
      setItems(
        (existing.service_template_items ?? []).map((i) => ({
          role_label: i.role_label ?? '',
          part_id: i.part_id ?? '',
          part_code: i.part_code ?? '',
          description: i.description,
          quantity: String(i.quantity),
          unit: i.unit,
          optional: i.optional,
        })),
      );
    } else {
      setScope(target === 'new-veh' ? 'patente' : 'categoria');
      setServiceTypeId(serviceTypes[0]?.id ?? '');
      setCategoryId(categories[0]?.id ?? '');
      setVehicleId('');
      setOilType('');
      setOilLiters('');
      setOtherFluids('');
      setDefaultWork('');
      setNotes('');
      setItems([
        { role_label: 'Filtro de aceite', part_id: '', part_code: '', description: '', quantity: '1', unit: 'un.', optional: false },
        { role_label: 'Filtro de aire', part_id: '', part_code: '', description: '', quantity: '1', unit: 'un.', optional: false },
        { role_label: 'Filtro de combustible', part_id: '', part_code: '', description: '', quantity: '1', unit: 'un.', optional: true },
        { role_label: 'Filtro de habitáculo', part_id: '', part_code: '', description: '', quantity: '1', unit: 'un.', optional: false },
      ]);
    }
  }
  if (!key && lastKey) setLastKey(null);

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { role_label: '', part_id: '', part_code: '', description: '', quantity: '1', unit: 'un.', optional: false },
    ]);

  const updateItem = (idx: number, patch: Partial<DraftTemplateItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const onSelectPart = (idx: number, partId: string) => {
    const p = parts.find((x) => x.id === partId);
    if (!p) {
      updateItem(idx, { part_id: '' });
      return;
    }
    updateItem(idx, {
      part_id: p.id,
      part_code: p.internal_code,
      description: p.description,
      unit: p.unit,
    });
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!serviceTypeId) return toast.error('Seleccione el tipo de servicio');
    if (scope === 'categoria' && !categoryId) return toast.error('Seleccione la categoría / modelo');
    if (scope === 'patente' && !vehicleId) return toast.error('Seleccione la unidad (patente)');

    const cleanItems = items
      .filter((i) => i.description.trim() !== '' || i.role_label.trim() !== '')
      .map((i, idx) => ({
        part_id: i.part_id || null,
        role_label: i.role_label.trim() || null,
        part_code: i.part_code.trim().toUpperCase() || null,
        description: i.description.trim() || i.role_label.trim(),
        quantity: Math.max(0.01, Number(i.quantity.replace(',', '.')) || 1),
        unit: i.unit.trim() || 'un.',
        optional: i.optional,
        sort_order: idx,
      }));

    setSaving(true);
    try {
      const payload = {
        service_type_id: serviceTypeId,
        category_id: scope === 'categoria' ? categoryId : null,
        vehicle_id: scope === 'patente' ? vehicleId : null,
        oil_type: oilType.trim() || null,
        oil_liters: oilLiters.trim() === '' ? null : Number(oilLiters.replace(',', '.')),
        other_fluids: otherFluids.trim() || null,
        default_work: defaultWork.trim() || null,
        notes: notes.trim() || null,
        active: true,
      };

      let tplId = existing?.id;
      if (tplId) {
        const { error } = await supabase.from('service_templates').update(payload).eq('id', tplId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('service_templates').insert(payload).select('id').single();
        if (error) throw error;
        tplId = data.id;
      }

      await supabase.from('service_template_items').delete().eq('template_id', tplId!);
      if (cleanItems.length) {
        const { error: itErr } = await supabase
          .from('service_template_items')
          .insert(cleanItems.map((c) => ({ ...c, template_id: tplId })));
        if (itErr) throw itErr;
      }

      toast.success('Configuración de servicio guardada');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      size="xl"
      title={existing ? 'Editar configuración de servicio' : 'Nueva configuración de servicio y repuestos'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving}>
            Guardar configuración
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Alcance de la configuración" required>
            <select
              className="input"
              value={scope}
              disabled={!!existing}
              onChange={(e) => setScope(e.target.value as 'categoria' | 'patente')}
            >
              <option value="categoria">Por modelo / categoría</option>
              <option value="patente">Por patente individual (prioritaria)</option>
            </select>
          </Field>

          {scope === 'categoria' ? (
            <Field label="Modelo / categoría de RV Group" required>
              <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="">— Seleccione categoría —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Unidad (patente individual)" required>
              <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
                <option value="">— Seleccione patente —</option>
                {vehicles
                  .filter((v) => v.status !== 'baja')
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {formatPatente(v.patente)} · {[v.marca, v.modelo, v.version].filter(Boolean).join(' ')}
                    </option>
                  ))}
              </select>
            </Field>
          )}

          <Field label="Servicio" required>
            <select className="input" value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)} required>
              {serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Aceite de motor (especificación)">
            <input className="input" value={oilType} onChange={(e) => setOilType(e.target.value)} placeholder="Ej.: 5W-30 Sintético" />
          </Field>
          <Field label="Cantidad de aceite (litros)">
            <input className="input" inputMode="decimal" value={oilLiters} onChange={(e) => setOilLiters(e.target.value)} placeholder="Ej.: 8.5" />
          </Field>
          <Field label="Otros fluidos">
            <input className="input" value={otherFluids} onChange={(e) => setOtherFluids(e.target.value)} />
          </Field>
        </div>

        {/* Lista de filtros y repuestos */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Filtros y repuestos que utiliza este servicio</label>
            <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={addItem}>
              Agregar ítem (ej.: 2° filtro habitáculo)
            </Button>
          </div>
          <datalist id="filter-roles">
            {FILTER_ROLE_SUGGESTIONS.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                <div className="col-span-12 sm:col-span-3">
                  <input
                    className="input text-xs"
                    list="filter-roles"
                    placeholder="Función (ej.: Filtro de aceite)"
                    value={it.role_label}
                    onChange={(e) => updateItem(idx, { role_label: e.target.value })}
                  />
                </div>
                <div className="col-span-12 sm:col-span-3">
                  <select
                    className="input text-xs"
                    value={it.part_id}
                    onChange={(e) => onSelectPart(idx, e.target.value)}
                  >
                    <option value="">— Vincular con inventario (opcional) —</option>
                    {parts.map((p) => (
                      <option key={p.id} value={p.id}>
                        [{p.internal_code}] {p.description} (Stock: {p.quantity})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <input
                    className="input font-mono text-xs uppercase"
                    placeholder="Código"
                    value={it.part_code}
                    onChange={(e) => updateItem(idx, { part_code: e.target.value })}
                  />
                </div>
                <div className="col-span-8 sm:col-span-2">
                  <input
                    className="input text-xs"
                    placeholder="Descripción / medida"
                    value={it.description}
                    onChange={(e) => updateItem(idx, { description: e.target.value })}
                  />
                </div>
                <div className="col-span-4 sm:col-span-1">
                  <input
                    className="input text-xs"
                    inputMode="decimal"
                    placeholder="Cant."
                    value={it.quantity}
                    onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                  />
                </div>
                <div className="col-span-8 flex items-center justify-end gap-2 sm:col-span-1">
                  <label className="flex items-center gap-1 text-[11px] text-slate-500" title="Opcional según servicio">
                    <input
                      type="checkbox"
                      checked={it.optional}
                      onChange={(e) => updateItem(idx, { optional: e.target.checked })}
                    />
                    Opc.
                  </label>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="rounded p-1 text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Tareas por defecto a proponer en la OR">
            <textarea
              className="input min-h-[60px]"
              value={defaultWork}
              onChange={(e) => setDefaultWork(e.target.value)}
              placeholder="Ej.: Cambio de aceite y filtros, revisión de niveles y puntos de seguridad…"
            />
          </Field>
          <Field label="Notas técnicas (ej.: cantidad de filtros de habitáculo según versión)">
            <textarea className="input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

function NewServiceTypeModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [maintType, setMaintType] = useState<MaintenanceType>('preventivo');
  const [loading, setLoading] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    const { error } = await supabase
      .from('service_types')
      .insert({ name: name.trim(), default_maint_type: maintType, sort_order: 200 });
    setLoading(false);
    if (error) return toast.error(friendlyError(error));
    toast.success('Servicio agregado');
    setName('');
    onSaved();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Nuevo tipo de servicio"
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
        <Field label="Nombre del servicio" required>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Servicio 10.000 km" required />
        </Field>
        <Field label="Tipo de mantenimiento">
          <select className="input" value={maintType} onChange={(e) => setMaintType(e.target.value as MaintenanceType)}>
            {(Object.keys(MAINTENANCE_TYPE_LABELS) as MaintenanceType[]).map((m) => (
              <option key={m} value={m}>
                {MAINTENANCE_TYPE_LABELS[m]}
              </option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
