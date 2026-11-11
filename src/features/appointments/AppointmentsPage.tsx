import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Plus,
  Download,
  Search,
  FilterX,
  Calendar as CalendarIcon,
  List,
  MessageCircle,
  Bell,
  Pencil,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
} from 'lucide-react';
import { Badge, Button, EmptyState, Modal, PageHeader, Spinner, StatCard } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { friendlyError, supabase } from '@/lib/supabase';
import { APPOINTMENT_STATUS_COLORS, APPOINTMENT_STATUS_LABELS } from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { cn, formatDate, slug } from '@/lib/utils';
import type { Appointment, AppointmentStatus } from '@/types/db';
import {
  buildAppointmentWhatsAppText,
  exportAppointmentsToExcel,
  openWhatsAppWithAppointment,
  useAppointments,
  useSaveAppointment,
} from '@/features/pending/api';
import { AppointmentFormModal } from './AppointmentFormModal';

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return <Badge className={APPOINTMENT_STATUS_COLORS[status]}>{APPOINTMENT_STATUS_LABELS[status]}</Badge>;
}

export function AppointmentsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: appointments = [], isLoading } = useAppointments();
  const save = useSaveAppointment();

  const [view, setView] = useState<'lista' | 'calendario'>('lista');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'proximos' | 'todos' | AppointmentStatus>('proximos');
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [waTarget, setWaTarget] = useState<Appointment | null>(null);

  const canWrite = can('appointments', 'create') || can('appointments', 'edit');
  const todayStr = new Date().toISOString().slice(0, 10);
  const in7DaysStr = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);

  // Recordatorios de turnos próximos (hoy y próximos 7 días)
  const upcomingReminders = useMemo(
    () =>
      appointments.filter(
        (a) =>
          a.status !== 'cancelado' &&
          a.status !== 'realizado' &&
          a.appointment_date >= todayStr &&
          a.appointment_date <= in7DaysStr,
      ),
    [appointments, todayStr, in7DaysStr],
  );

  const filtered = useMemo(() => {
    const term = slug(q);
    return appointments.filter((a) => {
      if (statusFilter === 'proximos' && (a.status === 'cancelado' || a.status === 'realizado')) return false;
      if (statusFilter !== 'proximos' && statusFilter !== 'todos' && a.status !== statusFilter) return false;
      if (term) {
        const hay = slug(
          [a.patente, a.nro_interno, a.vehicle_label, a.reason, a.provider_name, a.address, a.responsible].join(' '),
        );
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [appointments, q, statusFilter]);

  const changeStatus = async (a: Appointment, status: AppointmentStatus) => {
    try {
      await save.mutateAsync({ id: a.id, values: { status } });
      toast.success(`Turno: ${APPOINTMENT_STATUS_LABELS[status]}`);
    } catch (err) {
      toast.error(friendlyError(err));
    }
  };

  const openReceipt = async (path: string) => {
    const { data } = await supabase.storage.from('work-orders').createSignedUrl(path, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Turnos y proveedores"
        subtitle="Administración de turnos externos, calendario, recordatorios y mensajes de WhatsApp"
        actions={
          <>
            <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700">
              <button
                onClick={() => setView('lista')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                  view === 'lista' ? 'bg-brand-700 text-white' : 'text-slate-600 dark:text-slate-300',
                )}
              >
                <List className="h-3.5 w-3.5" /> Lista
              </button>
              <button
                onClick={() => setView('calendario')}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                  view === 'calendario' ? 'bg-brand-700 text-white' : 'text-slate-600 dark:text-slate-300',
                )}
              >
                <CalendarIcon className="h-3.5 w-3.5" /> Calendario
              </button>
            </div>
            {can('appointments', 'export') && (
              <Button
                variant="secondary"
                icon={<Download className="h-4 w-4" />}
                disabled={!filtered.length}
                onClick={() => exportAppointmentsToExcel(filtered)}
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
                Nuevo turno
              </Button>
            )}
          </>
        }
      />

      {/* Recordatorios de próximos turnos */}
      {upcomingReminders.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
            <Bell className="h-4 w-4" /> Recordatorio de próximos turnos (próximos 7 días: {upcomingReminders.length})
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {upcomingReminders.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white p-2.5 text-xs shadow-sm dark:bg-slate-900"
              >
                <div className="min-w-0">
                  <p className="font-mono font-bold">
                    {formatPatente(a.patente)} · {formatDate(a.appointment_date)} {a.appointment_time ?? ''}
                  </p>
                  <p className="truncate text-slate-600 dark:text-slate-300">
                    {a.reason} — <b>{a.provider_name}</b>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <AppointmentStatusBadge status={a.status} />
                  <button
                    onClick={() => setWaTarget(a)}
                    className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                    title="Generar mensaje de WhatsApp"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Turnos a gestionar / solicitados"
          value={appointments.filter((a) => a.status === 'a_gestionar' || a.status === 'solicitado').length}
          icon={<CalendarIcon className="h-5 w-5" />}
          tone="amber"
          onClick={() => setStatusFilter('solicitado')}
        />
        <StatCard
          label="Turnos confirmados"
          value={appointments.filter((a) => a.status === 'confirmado').length}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="brand"
          onClick={() => setStatusFilter('confirmado')}
        />
        <StatCard
          label="Próximos 7 días"
          value={upcomingReminders.length}
          icon={<Bell className="h-5 w-5" />}
          tone="red"
          onClick={() => setStatusFilter('proximos')}
        />
        <StatCard
          label="Realizados"
          value={appointments.filter((a) => a.status === 'realizado').length}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="green"
          onClick={() => setStatusFilter('realizado')}
        />
      </div>

      {/* Buscador y filtros */}
      <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-3">
        <div className="relative sm:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="Buscar por patente, taller/proveedor, motivo, responsable…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="proximos">Activos (sin realizados/cancelados)</option>
            <option value="todos">Todos los turnos</option>
            {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map((s) => (
              <option key={s} value={s}>
                {APPOINTMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {(q || statusFilter !== 'proximos') && (
            <Button
              variant="ghost"
              onClick={() => {
                setQ('');
                setStatusFilter('proximos');
              }}
              title="Limpiar filtros"
            >
              <FilterX className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {view === 'lista' ? (
        <div className="card overflow-hidden">
          {isLoading ? (
            <Spinner />
          ) : !filtered.length ? (
            <EmptyState
              title="No hay turnos que coincidan con la vista actual"
              description="Registre turnos con talleres o proveedores externos y vincúlelos con pendientes u órdenes de reparación."
              action={
                canWrite && (
                  <Button icon={<Plus className="h-4 w-4" />} onClick={() => setFormOpen(true)}>
                    Agendar turno
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Fecha / Hora</th>
                    <th>Patente</th>
                    <th>Motivo</th>
                    <th>Taller / Proveedor</th>
                    <th>Dirección</th>
                    <th>Responsable / Tel.</th>
                    <th>Estado</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="font-medium">
                        {formatDate(a.appointment_date)}
                        {a.appointment_time && <span className="ml-1.5 font-mono text-xs text-slate-500">{a.appointment_time}</span>}
                      </td>
                      <td>
                        <button
                          onClick={() => navigate(`/unidades/${a.vehicle_id}`)}
                          className="font-mono font-bold text-brand-700 hover:underline dark:text-brand-300"
                        >
                          {formatPatente(a.patente)}
                        </button>
                        {a.nro_interno && <span className="ml-1 text-xs text-slate-500">({a.nro_interno})</span>}
                      </td>
                      <td className="max-w-[220px] truncate font-medium">{a.reason}</td>
                      <td className="max-w-[180px] truncate">{a.provider_name}</td>
                      <td className="max-w-[180px] truncate text-xs text-slate-500">{a.address || '—'}</td>
                      <td className="text-xs">
                        {a.responsible || '—'}
                        {a.phone && <span className="block text-slate-400">{a.phone}</span>}
                      </td>
                      <td>
                        {canWrite ? (
                          <select
                            className="input py-1 text-xs"
                            value={a.status}
                            onChange={(e) => void changeStatus(a, e.target.value as AppointmentStatus)}
                          >
                            {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map((s) => (
                              <option key={s} value={s}>
                                {APPOINTMENT_STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <AppointmentStatusBadge status={a.status} />
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Generar mensaje de WhatsApp (no confirma automáticamente el turno)"
                            onClick={() => setWaTarget(a)}
                          >
                            <MessageCircle className="h-4 w-4 text-emerald-600" />
                          </Button>
                          {a.receipt_path && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Ver comprobante adjunto"
                              onClick={() => void openReceipt(a.receipt_path!)}
                            >
                              <FileText className="h-4 w-4 text-brand-600" />
                            </Button>
                          )}
                          {canWrite && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Editar turno"
                              onClick={() => {
                                setEditing(a);
                                setFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
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
      ) : (
        <CalendarMonthView
          month={monthCursor}
          onChangeMonth={setMonthCursor}
          appointments={filtered}
          onSelect={(a) => {
            setEditing(a);
            setFormOpen(true);
          }}
        />
      )}

      <AppointmentFormModal open={formOpen} onClose={() => setFormOpen(false)} appointment={editing} />
      <WhatsAppModal appointment={waTarget} onClose={() => setWaTarget(null)} />
    </div>
  );
}

// -----------------------------------------------------------------------------
function CalendarMonthView({
  month,
  onChangeMonth,
  appointments,
  onSelect,
}: {
  month: Date;
  onChangeMonth: (d: Date) => void;
  appointments: Appointment[];
  onSelect: (a: Appointment) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDay = new Date(year, m, 1);
  const startWeekday = (firstDay.getDay() + 6) % 7; // Lunes = 0
  const daysInMonth = new Date(year, m + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const byDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const list = map.get(a.appointment_date) ?? [];
      list.push(a);
      map.set(a.appointment_date, list);
    }
    return map;
  }, [appointments]);

  const monthLabel = month.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  return (
    <div className="card p-4">
      <div className="mb-4 flex items-center justify-between">
        <Button size="sm" variant="secondary" onClick={() => onChangeMonth(new Date(year, m - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="font-semibold capitalize">{monthLabel}</h2>
        <Button size="sm" variant="secondary" onClick={() => onChangeMonth(new Date(year, m + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase text-slate-500">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (!day) return <div key={idx} className="min-h-[92px] rounded-lg bg-slate-50/50 dark:bg-slate-900/40" />;
          const iso = `${year}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const list = byDate.get(iso) ?? [];
          return (
            <div
              key={iso}
              className="min-h-[92px] rounded-lg border border-slate-200 p-1.5 text-xs dark:border-slate-800"
            >
              <div className="mb-1 font-semibold text-slate-500">{day}</div>
              <div className="space-y-1">
                {list.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => onSelect(a)}
                    className={cn(
                      'block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium',
                      APPOINTMENT_STATUS_COLORS[a.status],
                    )}
                    title={`${formatPatente(a.patente)} · ${a.reason} (${a.provider_name})`}
                  >
                    {a.appointment_time ? `${a.appointment_time} ` : ''}
                    <b>{a.patente}</b> · {a.provider_name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
function WhatsAppModal({ appointment, onClose }: { appointment: Appointment | null; onClose: () => void }) {
  if (!appointment) return null;
  const text = buildAppointmentWhatsAppText(appointment);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    toast.success('Mensaje copiado al portapapeles');
  };

  return (
    <Modal
      open={!!appointment}
      onClose={onClose}
      size="sm"
      title="Mensaje de WhatsApp con información del turno"
      footer={
        <>
          <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copy()}>
            Copiar texto
          </Button>
          <Button
            variant="success"
            icon={<MessageCircle className="h-4 w-4" />}
            onClick={() => openWhatsAppWithAppointment(appointment)}
          >
            Abrir en WhatsApp
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          La generación o envío de este mensaje <b>no modifica ni confirma automáticamente</b> el estado del turno (permanece en{' '}
          <b>{APPOINTMENT_STATUS_LABELS[appointment.status]}</b> hasta que mantenimiento lo confirme).
        </p>
        <pre className="whitespace-pre-wrap rounded-lg bg-slate-100 p-3 font-sans text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          {text}
        </pre>
      </div>
    </Modal>
  );
}
