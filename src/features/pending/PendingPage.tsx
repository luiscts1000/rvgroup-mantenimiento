import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  Download,
  Search,
  FilterX,
  ClipboardList,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Wrench,
  Pencil,
  Paperclip,
  Eye,
  Lock,
} from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Modal, PageHeader, Spinner, StatCard } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useVehicles } from '@/features/vehicles/api';
import { friendlyError, supabase } from '@/lib/supabase';
import {
  PENDING_PRIORITY_COLORS,
  PENDING_PRIORITY_LABELS,
  PENDING_STATUS_COLORS,
  PENDING_STATUS_DOT,
  PENDING_STATUS_LABELS,
  PENDING_TASK_SUGGESTIONS,
} from '@/lib/constants';
import { formatPatente, normalizePatente } from '@/lib/patente';
import { formatDate, slug } from '@/lib/utils';
import type { PendingPriority, PendingStatus, PendingTask } from '@/types/db';
import {
  exportPendingToExcel,
  usePendingAttachments,
  usePendingTasks,
  useSavePendingTask,
  useUploadPendingAttachment,
} from './api';
import { AppointmentFormModal } from '@/features/appointments/AppointmentFormModal';

export function PendingStatusBadge({ status }: { status: PendingStatus }) {
  return (
    <Badge className={PENDING_STATUS_COLORS[status]} dot={PENDING_STATUS_DOT[status]}>
      {PENDING_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PendingPriorityBadge({ priority }: { priority: PendingPriority }) {
  return <Badge className={PENDING_PRIORITY_COLORS[priority]}>{PENDING_PRIORITY_LABELS[priority]}</Badge>;
}

export function PendingPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const { data: tasks = [], isLoading } = usePendingTasks();
  const save = useSavePendingTask();

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'activos' | 'solucionados' | 'todos' | PendingStatus>('activos');
  const [priorityFilter, setPriorityFilter] = useState<'' | PendingPriority>('');
  const [responsibleFilter, setResponsibleFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PendingTask | null>(null);
  const [detailTask, setDetailTask] = useState<PendingTask | null>(null);
  const [scheduleTask, setScheduleTask] = useState<PendingTask | null>(null);
  const [convertTask, setConvertTask] = useState<PendingTask | null>(null);
  const [converting, setConverting] = useState(false);

  const canWrite = can('pending', 'create') || can('pending', 'edit');

  const counts = useMemo(() => {
    const active = tasks.filter((t) => t.status !== 'reparado' && t.status !== 'cerrado').length;
    const urgent = tasks.filter((t) => t.status !== 'reparado' && t.status !== 'cerrado' && (t.priority === 'urgente' || t.priority === 'alta')).length;
    const withAppt = tasks.filter((t) => t.status !== 'reparado' && t.status !== 'cerrado' && t.has_appointment).length;
    const solved = tasks.filter((t) => t.status === 'reparado' || t.status === 'cerrado').length;
    return { active, urgent, withAppt, solved };
  }, [tasks]);

  const responsibles = useMemo(
    () => [...new Set(tasks.map((t) => t.responsible).filter(Boolean))].sort() as string[],
    [tasks],
  );

  const filtered = useMemo(() => {
    const term = slug(q);
    return tasks.filter((t) => {
      if (statusFilter === 'activos' && (t.status === 'reparado' || t.status === 'cerrado')) return false;
      if (statusFilter === 'solucionados' && t.status !== 'reparado' && t.status !== 'cerrado') return false;
      if (!['activos', 'solucionados', 'todos'].includes(statusFilter) && t.status !== statusFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (responsibleFilter && t.responsible !== responsibleFilter) return false;
      if (dateFrom && t.detected_at < dateFrom) return false;
      if (dateTo && t.detected_at > dateTo) return false;
      if (term) {
        const hay = slug(
          [
            t.patente,
            t.nro_interno,
            t.vehicle_label,
            t.task_title,
            t.description,
            t.provider_name,
            t.responsible,
            t.observations,
          ].join(' '),
        );
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [tasks, q, statusFilter, priorityFilter, responsibleFilter, dateFrom, dateTo]);

  const hasFilters = q || statusFilter !== 'activos' || priorityFilter || responsibleFilter || dateFrom || dateTo;
  const resetFilters = () => {
    setQ('');
    setStatusFilter('activos');
    setPriorityFilter('');
    setResponsibleFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const quickStatus = async (task: PendingTask, next: PendingStatus) => {
    try {
      await save.mutateAsync({ id: task.id, values: { status: next } });
      toast.success(`Estado actualizado: ${PENDING_STATUS_LABELS[next]}`);
    } catch (err) {
      toast.error(friendlyError(err));
    }
  };

  const handleConvert = async () => {
    if (!convertTask) return;
    setConverting(true);
    try {
      const { data: woId, error } = await supabase.rpc('convert_pending_to_work_order', {
        p_pending_id: convertTask.id,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ['pending-tasks'] });
      await qc.invalidateQueries({ queryKey: ['work-orders'] });
      await qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      toast.success('Pendiente convertido y vinculado a Orden de Reparación');
      setConvertTask(null);
      navigate(`/ordenes/${woId}`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pendientes generales"
        subtitle="Tablero central de trabajos a realizar por unidad (los trabajos solucionados se conservan en el historial)"
        actions={
          <>
            {can('pending', 'export') && (
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                disabled={!filtered.length}
                onClick={() => exportPendingToExcel(filtered)}
              >
                Exportar Excel
              </Button>
            )}
            {canWrite && (
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Nuevo pendiente
              </Button>
            )}
          </>
        }
      />

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Pendientes activos"
          value={counts.active}
          icon={<ClipboardList className="h-5 w-5" />}
          tone="brand"
          onClick={() => setStatusFilter('activos')}
        />
        <StatCard
          label="Prioridad alta / urgente"
          value={counts.urgent}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="red"
          onClick={() => {
            setStatusFilter('activos');
            setPriorityFilter(priorityFilter === 'urgente' ? '' : 'urgente');
          }}
        />
        <StatCard
          label="Con turno asignado"
          value={counts.withAppt}
          icon={<CalendarClock className="h-5 w-5" />}
          tone="amber"
          onClick={() => setStatusFilter('turno_confirmado')}
        />
        <StatCard
          label="Reparados / cerrados (historial)"
          value={counts.solved}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
          onClick={() => setStatusFilter('solucionados')}
        />
      </div>

      {/* Filtros por patente, estado, prioridad, fecha y responsable */}
      <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar patente, interno, trabajo, taller…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="activos">Activos (en curso)</option>
          <option value="solucionados">Reparados / Cerrados (historial)</option>
          <option value="todos">Todos (activos + historial)</option>
          {(Object.keys(PENDING_STATUS_LABELS) as PendingStatus[]).map((s) => (
            <option key={s} value={s}>
              {PENDING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select className="input" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as '' | PendingPriority)}>
          <option value="">Todas las prioridades</option>
          {(Object.keys(PENDING_PRIORITY_LABELS) as PendingPriority[]).map((p) => (
            <option key={p} value={p}>
              Prioridad {PENDING_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select className="input" value={responsibleFilter} onChange={(e) => setResponsibleFilter(e.target.value)}>
          <option value="">Todos los responsables</option>
          {responsibles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="flex gap-1.5">
          <input
            type="date"
            className="input text-xs"
            title="Detectado desde"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <input
            type="date"
            className="input text-xs"
            title="Detectado hasta"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          {hasFilters && (
            <Button variant="ghost" onClick={resetFilters} title="Limpiar filtros" className="px-2">
              <FilterX className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Tabla principal con todas las columnas solicitadas */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <Spinner />
        ) : !filtered.length ? (
          <EmptyState
            title={tasks.length ? 'No hay pendientes que coincidan con los filtros' : 'No hay trabajos pendientes registrados'}
            description="Registre aquí cualquier trabajo que deba realizarse en una unidad, aunque todavía no tenga una orden de reparación."
            action={
              tasks.length ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Limpiar filtros
                </Button>
              ) : canWrite ? (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                  Registrar primer pendiente
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Patente</th>
                  <th>Interno</th>
                  <th>Vehículo</th>
                  <th>Trabajo pendiente</th>
                  <th>Prioridad</th>
                  <th>Estado del trabajo</th>
                  <th>¿Tiene turno?</th>
                  <th>Fecha del turno</th>
                  <th>Taller o proveedor</th>
                  <th>Responsable</th>
                  <th>Observaciones</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td>
                      <button
                        onClick={() => navigate(`/unidades/${t.vehicle_id}`)}
                        className="font-mono font-bold text-brand-700 hover:underline dark:text-brand-300"
                      >
                        {formatPatente(t.patente)}
                      </button>
                    </td>
                    <td>{t.nro_interno || '—'}</td>
                    <td className="max-w-[160px] truncate">{t.vehicle_label || '—'}</td>
                    <td className="max-w-[230px]">
                      <p className="truncate font-semibold text-slate-900 dark:text-white">{t.task_title}</p>
                      <p className="truncate text-xs text-slate-500">Detectado: {formatDate(t.detected_at)}</p>
                    </td>
                    <td>
                      <PendingPriorityBadge priority={t.priority} />
                    </td>
                    <td>
                      <PendingStatusBadge status={t.status} />
                    </td>
                    <td>
                      <Badge
                        className={
                          t.has_appointment
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }
                      >
                        {t.has_appointment ? 'Sí' : 'No'}
                      </Badge>
                    </td>
                    <td>
                      {t.appointment_date ? (
                        <span>
                          {formatDate(t.appointment_date)}
                          {t.appointment_time ? ` ${t.appointment_time}` : ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="max-w-[160px] truncate">{t.provider_name || '—'}</td>
                    <td>{t.responsible || '—'}</td>
                    <td className="max-w-[200px] truncate text-xs text-slate-500">{t.observations || t.description || '—'}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Seguimiento, fotos y comprobantes" onClick={() => setDetailTask(t)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canWrite && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Asignar / gestionar turno externo"
                              onClick={() => setScheduleTask(t)}
                            >
                              <CalendarClock className="h-4 w-4 text-brand-600" />
                            </Button>
                            {t.work_order_id ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Ver Orden de Reparación vinculada"
                                onClick={() => navigate(`/ordenes/${t.work_order_id}`)}
                              >
                                <Wrench className="h-4 w-4 text-emerald-600" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Convertir en Orden de Reparación"
                                onClick={() => setConvertTask(t)}
                              >
                                <Wrench className="h-4 w-4" />
                              </Button>
                            )}
                            {t.status !== 'reparado' && t.status !== 'cerrado' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Marcar como Reparado"
                                onClick={() => void quickStatus(t, 'reparado')}
                              >
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              </Button>
                            )}
                            {t.status === 'reparado' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                title="Cerrar pendiente (permanece en el historial)"
                                onClick={() => void quickStatus(t, 'cerrado')}
                              >
                                <Lock className="h-3.5 w-3.5" /> Cerrar
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Editar"
                              onClick={() => {
                                setEditing(t);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PendingFormModal open={formOpen} onClose={() => setFormOpen(false)} task={editing} />
      <PendingDetailModal
        task={detailTask}
        onClose={() => setDetailTask(null)}
        onEdit={(t) => {
          setDetailTask(null);
          setEditing(t);
          setFormOpen(true);
        }}
        onConvert={(t) => {
          setDetailTask(null);
          setConvertTask(t);
        }}
      />
      <AppointmentFormModal
        open={!!scheduleTask}
        onClose={() => setScheduleTask(null)}
        defaultPending={scheduleTask}
      />
      <ConfirmDialog
        open={!!convertTask}
        onClose={() => setConvertTask(null)}
        loading={converting}
        title="Convertir pendiente en Orden de Reparación"
        confirmLabel="Generar Orden de Reparación"
        message={
          convertTask && (
            <>
              Se creará una Orden de Reparación para la unidad <b>{formatPatente(convertTask.patente)}</b> por el trabajo{' '}
              <b>«{convertTask.task_title}»</b>. Ambos registros quedarán vinculados para evitar duplicaciones y el pendiente se
              conservará en el historial.
            </>
          )
        }
        onConfirm={() => void handleConvert()}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
export function PendingFormModal({
  open,
  onClose,
  task,
  defaultVehicleId,
}: {
  open: boolean;
  onClose: () => void;
  task?: PendingTask | null;
  defaultVehicleId?: string;
}) {
  const { profile } = useAuth();
  const { data: vehicles = [] } = useVehicles();
  const save = useSavePendingTask();

  const [patenteInput, setPatenteInput] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [detectedAt, setDetectedAt] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<PendingPriority>('media');
  const [status, setStatus] = useState<PendingStatus>('pendiente');
  const [responsible, setResponsible] = useState('');
  const [estimatedAt, setEstimatedAt] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [providerName, setProviderName] = useState('');
  const [observations, setObservations] = useState('');
  const [lastKey, setLastKey] = useState<string | null>(null);

  const key = open ? (task?.id ?? defaultVehicleId ?? 'new') : null;
  if (key && key !== lastKey) {
    setLastKey(key);
    const today = new Date().toISOString().slice(0, 10);
    setVehicleId(task?.vehicle_id ?? defaultVehicleId ?? '');
    const v = vehicles.find((x) => x.id === (task?.vehicle_id ?? defaultVehicleId));
    setPatenteInput(task?.patente ?? v?.patente ?? '');
    setDetectedAt(task?.detected_at ?? today);
    setTaskTitle(task?.task_title ?? '');
    setDescription(task?.description ?? '');
    setPriority(task?.priority ?? 'media');
    setStatus(task?.status ?? 'pendiente');
    setResponsible(task?.responsible ?? profile?.full_name ?? profile?.email ?? '');
    setEstimatedAt(task?.estimated_resolution_at ?? '');
    setAppointmentDate(task?.appointment_date ?? '');
    setAppointmentTime(task?.appointment_time ?? '');
    setProviderName(task?.provider_name ?? '');
    setObservations(task?.observations ?? '');
  }
  if (!key && lastKey) setLastKey(null);

  const onPatenteChange = (raw: string) => {
    setPatenteInput(raw);
    const norm = normalizePatente(raw);
    const match = vehicles.find((v) => v.patente === norm || (v.nro_interno && v.nro_interno.toUpperCase() === raw.trim().toUpperCase()));
    if (match) setVehicleId(match.id);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!vehicleId) return toast.error('Seleccione una unidad de la flota');
    if (!taskTitle.trim()) return toast.error('Indique el trabajo pendiente');

    try {
      await save.mutateAsync({
        id: task?.id,
        values: {
          vehicle_id: vehicleId,
          detected_at: detectedAt || new Date().toISOString().slice(0, 10),
          task_title: taskTitle.trim(),
          description: description.trim() || null,
          priority,
          status,
          responsible: responsible.trim() || null,
          estimated_resolution_at: estimatedAt || null,
          appointment_date: appointmentDate || null,
          appointment_time: appointmentTime.trim() || null,
          provider_name: providerName.trim() || null,
          observations: observations.trim() || null,
        },
      });
      toast.success(task ? 'Pendiente actualizado' : 'Pendiente registrado');
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={task ? `Editar pendiente · ${formatPatente(task.patente)}` : 'Registrar trabajo pendiente'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Buscar patente / N° interno" required>
            <input
              className="input font-mono uppercase"
              value={patenteInput}
              onChange={(e) => onPatenteChange(e.target.value)}
              placeholder="Ej.: AI088SV"
            />
          </Field>
          <Field label="Unidad de RV Group" required className="sm:col-span-2">
            <select
              className="input"
              value={vehicleId}
              onChange={(e) => {
                setVehicleId(e.target.value);
                const v = vehicles.find((x) => x.id === e.target.value);
                if (v) setPatenteInput(v.patente);
              }}
              required
            >
              <option value="">— Seleccione una unidad —</option>
              {vehicles
                .filter((v) => v.status !== 'baja' || v.id === task?.vehicle_id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatPatente(v.patente)} {v.nro_interno ? `· Int. ${v.nro_interno}` : ''} ·{' '}
                    {[v.marca, v.modelo, v.version].filter(Boolean).join(' ')}
                  </option>
                ))}
            </select>
          </Field>

          <Field label="Trabajo pendiente" required className="sm:col-span-2">
            <input
              className="input"
              list="pending-task-suggestions"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Ej.: Reparación del aire acondicionado"
              required
            />
            <datalist id="pending-task-suggestions">
              {PENDING_TASK_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Fecha en que se detectó" required>
            <input type="date" className="input" value={detectedAt} onChange={(e) => setDetectedAt(e.target.value)} required />
          </Field>

          <Field label="Prioridad" required>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as PendingPriority)}>
              {(Object.keys(PENDING_PRIORITY_LABELS) as PendingPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PENDING_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estado del trabajo" required>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as PendingStatus)}>
              {(Object.keys(PENDING_STATUS_LABELS) as PendingStatus[]).map((s) => (
                <option key={s} value={s}>
                  {PENDING_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Responsable">
            <input className="input" value={responsible} onChange={(e) => setResponsible(e.target.value)} />
          </Field>

          <Field label="Taller o proveedor">
            <input className="input" value={providerName} onChange={(e) => setProviderName(e.target.value)} />
          </Field>
          <Field label="Fecha del turno (si tiene)">
            <input type="date" className="input" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} />
          </Field>
          <Field label="Fecha estimada de resolución">
            <input type="date" className="input" value={estimatedAt} onChange={(e) => setEstimatedAt(e.target.value)} />
          </Field>

          <Field label="Descripción detallada" className="sm:col-span-3">
            <textarea className="input min-h-[65px]" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Observaciones" className="sm:col-span-3">
            <textarea className="input min-h-[60px]" value={observations} onChange={(e) => setObservations(e.target.value)} />
          </Field>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
function PendingDetailModal({
  task,
  onClose,
  onEdit,
  onConvert,
}: {
  task: PendingTask | null;
  onClose: () => void;
  onEdit: (t: PendingTask) => void;
  onConvert: (t: PendingTask) => void;
}) {
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const { data: attachments = [], isLoading } = usePendingAttachments(task?.id);
  const upload = useUploadPendingAttachment();
  const save = useSavePendingTask();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'foto' | 'comprobante'>('foto');
  const [caption, setCaption] = useState('');

  if (!task) return null;
  const canWrite = can('pending', 'edit') || can('pending', 'create');

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync({
          pendingId: task.id,
          file,
          kind,
          caption,
          userEmail: profile?.email,
        });
        toast.success('Archivo adjuntado');
      } catch (err) {
        toast.error(friendlyError(err));
      }
    }
    setCaption('');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Modal
      open={!!task}
      onClose={onClose}
      size="lg"
      title={`Seguimiento de pendiente · ${formatPatente(task.patente)}`}
      footer={
        <>
          {canWrite && !task.work_order_id && (
            <Button variant="secondary" icon={<Wrench className="h-4 w-4" />} onClick={() => onConvert(task)}>
              Convertir en OR
            </Button>
          )}
          {task.work_order_id && (
            <Button
              variant="secondary"
              icon={<Wrench className="h-4 w-4" />}
              onClick={() => {
                onClose();
                navigate(`/ordenes/${task.work_order_id}`);
              }}
            >
              Abrir OR vinculada
            </Button>
          )}
          {canWrite && (
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(task)}>
              Editar
            </Button>
          )}
          <Button onClick={onClose}>Cerrar ventana</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">{task.task_title}</p>
            <p className="text-xs text-slate-500">
              Unidad {formatPatente(task.patente)} {task.nro_interno ? `· Int. ${task.nro_interno}` : ''} · {task.vehicle_label || ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PendingPriorityBadge priority={task.priority} />
            <PendingStatusBadge status={task.status} />
          </div>
        </div>

        {/* Cambio rápido de estado (incluye Reparado y luego Cerrado sin eliminar) */}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-slate-500">Cambiar estado:</span>
            {(Object.keys(PENDING_STATUS_LABELS) as PendingStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={async () => {
                  await save.mutateAsync({ id: task.id, values: { status: s } });
                  toast.success(`Estado: ${PENDING_STATUS_LABELS[s]}`);
                  onClose();
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  task.status === s ? 'ring-2 ring-brand-600 ' : ''
                }${PENDING_STATUS_COLORS[s]}`}
              >
                {PENDING_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">Fecha detectado</dt>
            <dd className="font-medium">{formatDate(task.detected_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Taller / proveedor</dt>
            <dd className="font-medium">{task.provider_name || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Fecha del turno</dt>
            <dd className="font-medium">{task.appointment_date ? formatDate(task.appointment_date) : 'Sin turno'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Responsable</dt>
            <dd className="font-medium">{task.responsible || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Fecha estimada resolución</dt>
            <dd className="font-medium">{task.estimated_resolution_at ? formatDate(task.estimated_resolution_at) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Fecha reparado / cerrado</dt>
            <dd className="font-medium">{formatDate(task.resolved_at || task.closed_at, true)}</dd>
          </div>
        </dl>

        {(task.description || task.observations) && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
            {task.description && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Descripción</p>
                <p className="whitespace-pre-wrap">{task.description}</p>
              </div>
            )}
            {task.observations && (
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Observaciones</p>
                <p className="whitespace-pre-wrap">{task.observations}</p>
              </div>
            )}
          </div>
        )}

        {/* Adjuntar fotografías y comprobantes */}
        <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Fotografías y comprobantes ({attachments.length})</p>
          {canWrite && (
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <select className="input text-xs" value={kind} onChange={(e) => setKind(e.target.value as 'foto' | 'comprobante')}>
                <option value="foto">Fotografía</option>
                <option value="comprobante">Comprobante / factura</option>
              </select>
              <input
                className="input text-xs sm:col-span-2"
                placeholder="Nota o descripción del adjunto…"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
              <Button
                size="sm"
                icon={<Paperclip className="h-3.5 w-3.5" />}
                loading={upload.isPending}
                onClick={() => fileRef.current?.click()}
              >
                Adjuntar archivo
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
              />
            </div>
          )}
          {isLoading ? (
            <Spinner />
          ) : !attachments.length ? (
            <p className="text-xs text-slate-400">Sin adjuntos registrados.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div>
                    <Badge className="mr-2 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {a.kind === 'comprobante' ? 'Comprobante' : 'Foto'}
                    </Badge>
                    <a href={a.signedUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">
                      {a.caption || a.file_name}
                    </a>
                  </div>
                  <span className="text-slate-400">{formatDate(a.created_at, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
