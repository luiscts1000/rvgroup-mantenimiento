import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Search, Sparkles } from 'lucide-react';
import { Button, Field, Modal } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useVehicles } from '@/features/vehicles/api';
import { useParts } from '@/features/inventory/api';
import { useServiceTypes } from '@/features/services/ServicesPage';
import { friendlyError, supabase } from '@/lib/supabase';
import { formatOrderNumber, MAINTENANCE_TYPE_LABELS, WO_STATUS_LABELS } from '@/lib/constants';
import { formatPatente, normalizePatente } from '@/lib/patente';
import { formatNumber } from '@/lib/utils';
import type { MaintenanceType, Vehicle, WorkOrder, WorkOrderStatus } from '@/types/db';
import { useMechanics, useSaveWorkOrder, useWorkOrderItems, type ItemDraft } from './api';

export function WorkOrderFormModal({
  open,
  onClose,
  workOrder,
  defaultVehicle,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  workOrder?: WorkOrder | null;
  defaultVehicle?: Vehicle | null;
  onSaved?: (wo: WorkOrder) => void;
}) {
  const { profile, can } = useAuth();
  const { data: vehicles = [] } = useVehicles();
  const { data: mechanics = [] } = useMechanics();
  const { data: parts = [] } = useParts();
  const { data: serviceTypes = [] } = useServiceTypes();
  const { data: existingItems = [] } = useWorkOrderItems(workOrder?.id);
  const save = useSaveWorkOrder();

  const [patenteQuery, setPatenteQuery] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [resolvedScope, setResolvedScope] = useState<string | null>(null);
  const [kilometraje, setKilometraje] = useState('');
  const [maintenanceType, setMaintenanceType] = useState<MaintenanceType>('correctivo');
  const [requesterName, setRequesterName] = useState('');
  const [mechanicId, setMechanicId] = useState('');
  const [mechanicName, setMechanicName] = useState('');
  const [status, setStatus] = useState<WorkOrderStatus>('abierta');
  const [failureDescription, setFailureDescription] = useState('');
  const [requestedWork, setRequestedWork] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [workPerformed, setWorkPerformed] = useState('');
  const [oilType, setOilType] = useState('');
  const [oilLiters, setOilLiters] = useState('');
  const [otherFluids, setOtherFluids] = useState('');
  const [laborDetail, setLaborDetail] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [laborCost, setLaborCost] = useState('');
  const [observations, setObservations] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [updateVehicleStatus, setUpdateVehicleStatus] = useState(false);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === vehicleId) ?? null,
    [vehicles, vehicleId],
  );

  // Cuando el usuario tipea una patente exacta, selecciona automáticamente la unidad
  const onPatenteInput = (raw: string) => {
    setPatenteQuery(raw);
    const norm = normalizePatente(raw);
    const match = vehicles.find((v) => v.patente === norm || (v.nro_interno && v.nro_interno.toUpperCase() === raw.trim().toUpperCase()));
    if (match) {
      setVehicleId(match.id);
      if (!workOrder && match.km_actual != null) setKilometraje(String(match.km_actual));
      if (serviceTypeId) void applyServiceTemplate(match.id, serviceTypeId);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (workOrder) {
      setVehicleId(workOrder.vehicle_id);
      setServiceTypeId(workOrder.service_type_id ?? '');
      setResolvedScope(null);
      setPatenteQuery(workOrder.patente);
      setKilometraje(workOrder.kilometraje != null ? String(workOrder.kilometraje) : '');
      setMaintenanceType(workOrder.maintenance_type);
      setRequesterName(workOrder.requester_name ?? '');
      setMechanicId(workOrder.mechanic_id ?? '');
      setMechanicName(workOrder.mechanic_name ?? '');
      setStatus(workOrder.status);
      setFailureDescription(workOrder.failure_description ?? '');
      setRequestedWork(workOrder.requested_work ?? '');
      setDiagnosis(workOrder.diagnosis ?? '');
      setWorkPerformed(workOrder.work_performed ?? '');
      setOilType(workOrder.oil_type ?? '');
      setOilLiters(workOrder.oil_liters != null ? String(workOrder.oil_liters) : '');
      setOtherFluids(workOrder.other_fluids ?? '');
      setLaborDetail(workOrder.labor_detail ?? '');
      setLaborHours(workOrder.labor_hours != null ? String(workOrder.labor_hours) : '');
      setLaborCost(workOrder.labor_cost != null ? String(workOrder.labor_cost) : '');
      setObservations(workOrder.observations ?? '');
      setUpdateVehicleStatus(false);
    } else {
      const v = defaultVehicle ?? null;
      setVehicleId(v?.id ?? '');
      setServiceTypeId('');
      setResolvedScope(null);
      setPatenteQuery(v?.patente ?? '');
      setKilometraje(v?.km_actual != null ? String(v.km_actual) : '');
      setMaintenanceType('correctivo');
      setRequesterName(profile?.full_name || profile?.email || '');
      setMechanicId('');
      setMechanicName('');
      setStatus('abierta');
      setFailureDescription('');
      setRequestedWork('');
      setDiagnosis('');
      setWorkPerformed('');
      setOilType('');
      setOilLiters('');
      setOtherFluids('');
      setLaborDetail('');
      setLaborHours('');
      setLaborCost('');
      setObservations('');
      setItems([]);
      setUpdateVehicleStatus(true);
    }
  }, [open, workOrder, defaultVehicle, profile]);

  useEffect(() => {
    if (open && workOrder) {
      setItems(
        existingItems.map((it) => ({
          id: it.id,
          part_id: it.part_id ?? null,
          part_code: it.part_code ?? '',
          description: it.description,
          quantity: String(it.quantity),
          unit: it.unit,
          unit_cost: it.unit_cost != null ? String(it.unit_cost) : '',
        })),
      );
    }
  }, [open, workOrder, existingItems]);

  const canApproveClose = can('work_orders', 'create') || profile?.role === 'admin';
  const statusOptions = (Object.keys(WO_STATUS_LABELS) as WorkOrderStatus[]).filter(
    (s) => s !== 'cerrada' || canApproveClose || workOrder?.status === 'cerrada',
  );

  const addItem = () =>
    setItems((prev) => [...prev, { part_id: null, part_code: '', description: '', quantity: '1', unit: 'un.', unit_cost: '' }]);
  const updateItem = (idx: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const onSelectCatalogPart = (idx: number, partId: string) => {
    const p = parts.find((x) => x.id === partId);
    if (!p) return updateItem(idx, { part_id: null });
    updateItem(idx, {
      part_id: p.id,
      part_code: p.internal_code,
      description: p.description,
      unit: p.unit,
      unit_cost: p.purchase_price != null ? String(p.purchase_price) : '',
    });
  };

  // Aplica automáticamente la configuración del servicio para la patente / modelo seleccionado
  const applyServiceTemplate = async (vId: string, sId: string) => {
    if (!vId || !sId) {
      setResolvedScope(null);
      return;
    }
    const st = serviceTypes.find((s) => s.id === sId);
    if (st) setMaintenanceType(st.default_maint_type);

    const { data, error } = await supabase.rpc('resolve_service_for_vehicle', {
      p_vehicle_id: vId,
      p_service_type_id: sId,
    });
    if (error || !data?.found) {
      setResolvedScope('none');
      return;
    }
    setResolvedScope(data.scope === 'patente' ? 'Configuración específica de la patente' : 'Configuración del modelo/categoría');
    if (data.oil_type) setOilType(data.oil_type);
    if (data.oil_liters != null) setOilLiters(String(data.oil_liters));
    if (data.other_fluids) setOtherFluids(data.other_fluids);
    if (data.default_work && !requestedWork.trim()) setRequestedWork(data.default_work);

    const proposed: ItemDraft[] = (data.items ?? []).map(
      (it: {
        part_id: string | null;
        role_label: string | null;
        part_code: string | null;
        description: string;
        quantity: number;
        unit: string;
        unit_cost: number | null;
      }) => ({
        part_id: it.part_id,
        part_code: it.part_code ?? '',
        description: it.role_label && !it.description.toLowerCase().includes(it.role_label.toLowerCase())
          ? `${it.role_label}: ${it.description}`
          : it.description,
        quantity: String(it.quantity ?? 1),
        unit: it.unit ?? 'un.',
        unit_cost: it.unit_cost != null ? String(it.unit_cost) : '',
      }),
    );
    if (proposed.length) {
      setItems(proposed);
      toast.success(`Se propusieron ${proposed.length} repuestos/filtros según la configuración de la unidad`);
    }
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!vehicleId || !selectedVehicle) {
      return toast.error('Seleccione una unidad válida ingresando su patente o eligiéndola de la lista');
    }
    const numOrNull = (s: string) => {
      const t = s.trim().replace(',', '.');
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const intOrNull = (s: string) => {
      const t = s.trim().replace(/\./g, '');
      if (!t) return null;
      const n = parseInt(t, 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const txt = (s: string) => (s.trim() === '' ? null : s.trim());

    try {
      const saved = await save.mutateAsync({
        id: workOrder?.id,
        values: {
          vehicle_id: vehicleId,
          service_type_id: serviceTypeId || null,
          patente: selectedVehicle.patente,
          nro_interno: selectedVehicle.nro_interno,
          marca_modelo: [selectedVehicle.marca, selectedVehicle.modelo, selectedVehicle.version].filter(Boolean).join(' ') || null,
          kilometraje: intOrNull(kilometraje),
          maintenance_type: maintenanceType,
          requester_name: txt(requesterName),
          mechanic_id: mechanicId || null,
          mechanic_name: mechanicId
            ? mechanics.find((m) => m.id === mechanicId)?.full_name || mechanics.find((m) => m.id === mechanicId)?.email || null
            : txt(mechanicName),
          failure_description: txt(failureDescription),
          requested_work: txt(requestedWork),
          diagnosis: txt(diagnosis),
          work_performed: txt(workPerformed),
          oil_type: txt(oilType),
          oil_liters: numOrNull(oilLiters),
          other_fluids: txt(otherFluids),
          labor_detail: txt(laborDetail),
          labor_hours: numOrNull(laborHours),
          labor_cost: numOrNull(laborCost),
          observations: txt(observations),
          status,
        },
        items,
      });

      if (updateVehicleStatus && can('vehicles', 'edit')) {
        const nextVehStatus = status === 'finalizada' || status === 'cerrada' ? 'operativo' : 'en_taller';
        await supabase.from('vehicles').update({ status: nextVehStatus }).eq('id', vehicleId);
      }

      toast.success(
        workOrder ? `${formatOrderNumber(saved.order_number)} actualizada` : `${formatOrderNumber(saved.order_number)} creada`,
      );
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={workOrder ? `Editar ${formatOrderNumber(workOrder.order_number)} · ${formatPatente(workOrder.patente)}` : 'Nueva Orden de Reparación'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={save.isPending} icon={<Save className="h-4 w-4" />}>
            {workOrder ? 'Guardar cambios' : 'Crear Orden de Reparación'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {/* 1. Unidad y apertura */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-brand-700 dark:text-brand-300">1. Unidad y asignación</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Buscar por patente o N° interno" required hint="Al ingresar la patente se recuperan los datos de la unidad">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  className="input pl-9 font-mono uppercase"
                  list="wo-patentes-list"
                  placeholder="Ej.: AB123CD"
                  value={patenteQuery}
                  onChange={(e) => onPatenteInput(e.target.value)}
                />
                <datalist id="wo-patentes-list">
                  {vehicles
                    .filter((v) => v.status !== 'baja')
                    .map((v) => (
                      <option
                        key={v.id}
                        value={v.patente}
                        label={`${v.nro_interno ? `Int. ${v.nro_interno} · ` : ''}${[v.marca, v.modelo, v.version].filter(Boolean).join(' ')}`}
                      />
                    ))}
                </datalist>
              </div>
            </Field>

            <Field label="Seleccionar unidad de la flota" required className="sm:col-span-2">
              <select
                className="input"
                value={vehicleId}
                onChange={(e) => {
                  const id = e.target.value;
                  setVehicleId(id);
                  const v = vehicles.find((x) => x.id === id);
                  if (v) {
                    setPatenteQuery(v.patente);
                    if (!workOrder && v.km_actual != null) setKilometraje(String(v.km_actual));
                    if (serviceTypeId) void applyServiceTemplate(v.id, serviceTypeId);
                  }
                }}
                required
              >
                <option value="">— Seleccione una unidad —</option>
                {vehicles
                  .filter((v) => v.status !== 'baja' || v.id === workOrder?.vehicle_id)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {formatPatente(v.patente)} {v.nro_interno ? `· Int. ${v.nro_interno}` : ''} ·{' '}
                      {[v.marca, v.modelo, v.version].filter(Boolean).join(' ') || 'Sin modelo'}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          {/* Ficha rápida recuperada automáticamente */}
          {selectedVehicle && (
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-brand-50/70 p-3 text-xs dark:bg-brand-950/30 sm:grid-cols-5">
              <div>
                <span className="text-slate-500">Patente:</span>{' '}
                <b className="font-mono">{formatPatente(selectedVehicle.patente)}</b>
              </div>
              <div>
                <span className="text-slate-500">Interno:</span> <b>{selectedVehicle.nro_interno || '—'}</b>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500">Vehículo:</span>{' '}
                <b>{[selectedVehicle.marca, selectedVehicle.modelo, selectedVehicle.version].filter(Boolean).join(' ') || '—'}</b>
              </div>
              <div>
                <span className="text-slate-500">Km registrado:</span>{' '}
                <b>{selectedVehicle.km_actual != null ? `${formatNumber(selectedVehicle.km_actual)} km` : '—'}</b>
              </div>
            </div>
          )}

          {/* Selector de Servicio Predefinido (propone filtros y aceite según patente/modelo) */}
          <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-900/50 dark:bg-brand-950/20">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field
                label="Servicio predefinido (opcional)"
                className="sm:col-span-2"
                hint={
                  resolvedScope === 'none'
                    ? 'Este modelo aún no tiene repuestos preconfigurados para ese servicio (puede configurarlos en «Servicios predefinidos»).'
                    : resolvedScope
                      ? `Aplicado: ${resolvedScope}. Puede modificar cantidades, agregar o quitar repuestos antes de guardar.`
                      : 'Al elegir un servicio, el sistema propone automáticamente los filtros y aceite configurados para la unidad.'
                }
              >
                <select
                  className="input"
                  value={serviceTypeId}
                  onChange={(e) => {
                    const sId = e.target.value;
                    setServiceTypeId(sId);
                    if (vehicleId && sId) void applyServiceTemplate(vehicleId, sId);
                  }}
                >
                  <option value="">— Sin servicio predefinido / carga manual —</option>
                  {serviceTypes
                    .filter((s) => s.active)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </Field>
              <div className="flex items-end">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!vehicleId || !serviceTypeId}
                  icon={<Sparkles className="h-4 w-4" />}
                  onClick={() => void applyServiceTemplate(vehicleId, serviceTypeId)}
                >
                  Volver a proponer repuestos
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Kilometraje al ingreso">
              <input className="input" inputMode="numeric" value={kilometraje} onChange={(e) => setKilometraje(e.target.value)} />
            </Field>
            <Field label="Tipo de mantenimiento" required>
              <select className="input" value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value as MaintenanceType)}>
                {(Object.keys(MAINTENANCE_TYPE_LABELS) as MaintenanceType[]).map((t) => (
                  <option key={t} value={t}>
                    {MAINTENANCE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Responsable de solicitud">
              <input className="input" value={requesterName} onChange={(e) => setRequesterName(e.target.value)} />
            </Field>
            <Field label="Estado de la OR" required>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as WorkOrderStatus)}>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {WO_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mecánico asignado (usuario del sistema)">
              <select
                className="input"
                value={mechanicId}
                onChange={(e) => {
                  setMechanicId(e.target.value);
                  const m = mechanics.find((x) => x.id === e.target.value);
                  if (m) setMechanicName(m.full_name || m.email);
                }}
              >
                <option value="">— Sin usuario asignado / taller externo —</option>
                {mechanics.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name || m.email} ({m.email})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nombre del mecánico o taller interviniente">
              <input
                className="input"
                value={mechanicName}
                onChange={(e) => setMechanicName(e.target.value)}
                placeholder="Ej.: Juan Pérez / Taller Externo"
              />
            </Field>
          </div>

          {can('vehicles', 'edit') && (
            <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={updateVehicleStatus}
                onChange={(e) => setUpdateVehicleStatus(e.target.checked)}
                className="rounded border-slate-300"
              />
              Actualizar automáticamente el estado de la unidad ({status === 'finalizada' || status === 'cerrada' ? 'pasará a Operativo' : 'pasará a En taller'})
            </label>
          )}
        </section>

        {/* 2. Falla, diagnóstico y reparación */}
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-brand-700 dark:text-brand-300">
              2. Falla, diagnóstico y trabajos
            </h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-slate-400">Carga rápida de rubro:</span>
              {[
                { label: 'Service (Aceite y Filtros)', type: 'preventivo' as MaintenanceType, text: 'Service completo: cambio de aceite y filtros' },
                { label: 'Cambio de Pastillas de Freno', type: 'preventivo' as MaintenanceType, text: 'Cambio de pastillas de freno' },
                { label: 'Cambio de Discos de Freno', type: 'preventivo' as MaintenanceType, text: 'Cambio de discos y pastillas de freno' },
                { label: 'Cambio de Amortiguadores', type: 'preventivo' as MaintenanceType, text: 'Cambio de amortiguadores y control de suspensión' },
                { label: 'Cambio de Cintas', type: 'preventivo' as MaintenanceType, text: 'Cambio de cintas de freno traseras' },
                { label: 'Cambio de Cubiertas', type: 'preventivo' as MaintenanceType, text: 'Cambio de cubiertas, alineación y balanceo' },
                { label: 'Cambio de Correas', type: 'preventivo' as MaintenanceType, text: 'Cambio de kit de correas y tensores' },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setMaintenanceType(preset.type);
                    setRequestedWork((prev) =>
                      prev.trim() ? `${prev.trim()} · ${preset.text}` : preset.text,
                    );
                  }}
                  className="rounded-lg border border-brand-200 bg-brand-50/70 px-2.5 py-1 text-xs font-semibold text-brand-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-600 hover:text-white dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300"
                >
                  + {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Descripción de la falla">
              <textarea
                className="input min-h-[75px]"
                value={failureDescription}
                onChange={(e) => setFailureDescription(e.target.value)}
                placeholder="Síntoma o falla detectada en la unidad…"
              />
            </Field>
            <Field label="Trabajo solicitado">
              <textarea
                className="input min-h-[75px]"
                value={requestedWork}
                onChange={(e) => setRequestedWork(e.target.value)}
                placeholder="Tareas solicitadas al mecánico / taller…"
              />
            </Field>
            <Field label="Diagnóstico técnico">
              <textarea
                className="input min-h-[85px]"
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="Revisión y causa determinada por el mecánico…"
              />
            </Field>
            <Field label="Reparación realizada">
              <textarea
                className="input min-h-[85px]"
                value={workPerformed}
                onChange={(e) => setWorkPerformed(e.target.value)}
                placeholder="Detalle completo de los trabajos ejecutados…"
              />
            </Field>
          </div>
        </section>

        {/* 3. Repuestos utilizados */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-brand-700 dark:text-brand-300">3. Repuestos utilizados</h3>
            <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={addItem}>
              Agregar repuesto
            </Button>
          </div>
          {!items.length ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
              Sin repuestos cargados. Haga clic en «Agregar repuesto» para registrar códigos y cantidades.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-800"
                >
                  <div className="col-span-12 sm:col-span-3">
                    <select
                      className="input text-xs"
                      value={it.part_id ?? ''}
                      onChange={(e) => onSelectCatalogPart(idx, e.target.value)}
                    >
                      <option value="">— Del inventario (descuenta stock) —</option>
                      {parts
                        .filter((p) => p.active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            [{p.internal_code}] {p.description} (Disp.: {p.quantity} {p.unit})
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
                  <div className="col-span-8 sm:col-span-3">
                    <input
                      className="input text-xs"
                      placeholder="Descripción del repuesto *"
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
                  <div className="col-span-3 sm:col-span-1">
                    <input
                      className="input text-xs"
                      placeholder="Unid."
                      value={it.unit}
                      onChange={(e) => updateItem(idx, { unit: e.target.value })}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-1">
                    <input
                      className="input text-xs"
                      inputMode="decimal"
                      placeholder="$ Unit."
                      value={it.unit_cost}
                      onChange={(e) => updateItem(idx, { unit_cost: e.target.value })}
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="rounded p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                      title="Quitar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4. Lubricantes, fluidos, mano de obra y observaciones */}
        <section>
          <h3 className="mb-3 text-sm font-semibold text-brand-700 dark:text-brand-300">4. Fluidos, mano de obra y observaciones</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Tipo / viscosidad de aceite">
              <input className="input" value={oilType} onChange={(e) => setOilType(e.target.value)} placeholder="Ej.: Sintético 5W-30" />
            </Field>
            <Field label="Litros de aceite">
              <input className="input" inputMode="decimal" value={oilLiters} onChange={(e) => setOilLiters(e.target.value)} />
            </Field>
            <Field label="Otros fluidos utilizados">
              <input
                className="input"
                value={otherFluids}
                onChange={(e) => setOtherFluids(e.target.value)}
                placeholder="Refrigerante, líquido de frenos, urea…"
              />
            </Field>
            <Field label="Detalle de mano de obra">
              <input className="input" value={laborDetail} onChange={(e) => setLaborDetail(e.target.value)} placeholder="Propia / tercerizada" />
            </Field>
            <Field label="Horas de mano de obra">
              <input className="input" inputMode="decimal" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} />
            </Field>
            <Field label="Costo de mano de obra ($)">
              <input className="input" inputMode="decimal" value={laborCost} onChange={(e) => setLaborCost(e.target.value)} />
            </Field>
            <Field label="Observaciones" className="sm:col-span-3">
              <textarea className="input min-h-[65px]" value={observations} onChange={(e) => setObservations(e.target.value)} />
            </Field>
          </div>
        </section>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
