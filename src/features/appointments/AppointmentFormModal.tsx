import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Paperclip } from 'lucide-react';
import { Button, Field, Modal } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useVehicles } from '@/features/vehicles/api';
import { useWorkOrders } from '@/features/workOrders/api';
import { usePendingTasks, useSaveAppointment } from '@/features/pending/api';
import { friendlyError } from '@/lib/supabase';
import { APPOINTMENT_STATUS_LABELS, formatOrderNumber } from '@/lib/constants';
import { formatPatente, normalizePatente } from '@/lib/patente';
import type { Appointment, AppointmentStatus, PendingTask } from '@/types/db';

export function AppointmentFormModal({
  open,
  onClose,
  appointment,
  defaultPending,
  defaultVehicleId,
}: {
  open: boolean;
  onClose: () => void;
  appointment?: Appointment | null;
  defaultPending?: PendingTask | null;
  defaultVehicleId?: string;
}) {
  const { profile } = useAuth();
  const { data: vehicles = [] } = useVehicles();
  const { data: pendingList = [] } = usePendingTasks();
  const { data: workOrders = [] } = useWorkOrders();
  const save = useSaveAppointment();

  const fileRef = useRef<HTMLInputElement>(null);
  const [patenteInput, setPatenteInput] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [reason, setReason] = useState('');
  const [providerName, setProviderName] = useState('');
  const [address, setAddress] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('');
  const [responsible, setResponsible] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<AppointmentStatus>('a_gestionar');
  const [pendingTaskId, setPendingTaskId] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [observations, setObservations] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);

  const key = open ? (appointment?.id ?? defaultPending?.id ?? defaultVehicleId ?? 'new') : null;
  if (key && key !== lastKey) {
    setLastKey(key);
    const vId = appointment?.vehicle_id ?? defaultPending?.vehicle_id ?? defaultVehicleId ?? '';
    const v = vehicles.find((x) => x.id === vId);
    setVehicleId(vId);
    setPatenteInput(appointment?.patente ?? defaultPending?.patente ?? v?.patente ?? '');
    setReason(appointment?.reason ?? defaultPending?.task_title ?? '');
    setProviderName(appointment?.provider_name ?? defaultPending?.provider_name ?? '');
    setAddress(appointment?.address ?? '');
    setAppointmentDate(
      appointment?.appointment_date ?? defaultPending?.appointment_date ?? new Date().toISOString().slice(0, 10),
    );
    setAppointmentTime(appointment?.appointment_time ?? defaultPending?.appointment_time ?? '09:00');
    setResponsible(appointment?.responsible ?? defaultPending?.responsible ?? profile?.full_name ?? profile?.email ?? '');
    setPhone(appointment?.phone ?? '');
    setStatus(appointment?.status ?? 'solicitado');
    setPendingTaskId(appointment?.pending_task_id ?? defaultPending?.id ?? '');
    setWorkOrderId(appointment?.work_order_id ?? defaultPending?.work_order_id ?? '');
    setObservations(appointment?.observations ?? '');
    setReceiptFile(null);
  }
  if (!key && lastKey) setLastKey(null);

  const onPatenteChange = (raw: string) => {
    setPatenteInput(raw);
    const norm = normalizePatente(raw);
    const match = vehicles.find((v) => v.patente === norm || (v.nro_interno && v.nro_interno.toUpperCase() === raw.trim().toUpperCase()));
    if (match) setVehicleId(match.id);
  };

  const vehiclePendings = pendingList.filter(
    (p) => p.vehicle_id === vehicleId && (p.status !== 'cerrado' || p.id === pendingTaskId),
  );
  const vehicleOrders = workOrders.filter(
    (w) => w.vehicle_id === vehicleId && (w.status !== 'cerrada' || w.id === workOrderId),
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!vehicleId) return toast.error('Seleccione una unidad');
    if (!reason.trim() || !providerName.trim() || !appointmentDate) {
      return toast.error('Complete motivo, taller/proveedor y fecha del turno');
    }

    try {
      await save.mutateAsync({
        id: appointment?.id,
        values: {
          vehicle_id: vehicleId,
          reason: reason.trim(),
          provider_name: providerName.trim(),
          address: address.trim() || null,
          appointment_date: appointmentDate,
          appointment_time: appointmentTime.trim() || null,
          responsible: responsible.trim() || null,
          phone: phone.trim() || null,
          status,
          pending_task_id: pendingTaskId || null,
          work_order_id: workOrderId || null,
          observations: observations.trim() || null,
        },
        receiptFile,
      });
      toast.success(appointment ? 'Turno actualizado' : 'Turno registrado');
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
      title={appointment ? `Editar turno · ${formatPatente(appointment.patente)}` : 'Nuevo turno con proveedor externo'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Guardar turno
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Buscar patente / interno" required>
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
                .filter((v) => v.status !== 'baja' || v.id === appointment?.vehicle_id)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatPatente(v.patente)} {v.nro_interno ? `· Int. ${v.nro_interno}` : ''} ·{' '}
                    {[v.marca, v.modelo, v.version].filter(Boolean).join(' ')}
                  </option>
                ))}
            </select>
          </Field>

          <Field label="Motivo del turno" required className="sm:col-span-2">
            <input
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: Reparación de aire acondicionado"
              required
            />
          </Field>
          <Field label="Estado del turno" required>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
              {(Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {APPOINTMENT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Taller / proveedor" required>
            <input className="input" value={providerName} onChange={(e) => setProviderName(e.target.value)} required />
          </Field>
          <Field label="Dirección del taller" className="sm:col-span-2">
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>

          <Field label="Fecha del turno" required>
            <input type="date" className="input" value={appointmentDate} onChange={(e) => setAppointmentDate(e.target.value)} required />
          </Field>
          <Field label="Hora">
            <input type="time" className="input" value={appointmentTime} onChange={(e) => setAppointmentTime(e.target.value)} />
          </Field>
          <Field label="Responsable de llevar / gestionar">
            <input className="input" value={responsible} onChange={(e) => setResponsible(e.target.value)} />
          </Field>

          <Field label="Teléfono (WhatsApp)" hint="Con código de país/área para enviar el mensaje directo">
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej.: 5492994000000" />
          </Field>
          <Field label="Vincular con Pendiente de la unidad">
            <select className="input" value={pendingTaskId} onChange={(e) => setPendingTaskId(e.target.value)}>
              <option value="">— Sin vincular —</option>
              {vehiclePendings.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.task_title} ({formatPatente(p.patente)})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vincular con Orden de Reparación">
            <select className="input" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
              <option value="">— Sin vincular —</option>
              {vehicleOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {formatOrderNumber(w.order_number)} · {w.failure_description || w.requested_work || 'OR'}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Observaciones" className="sm:col-span-2">
            <textarea className="input min-h-[60px]" value={observations} onChange={(e) => setObservations(e.target.value)} />
          </Field>
          <Field label="Comprobante / constancia">
            <div className="space-y-1">
              <Button
                size="sm"
                variant="secondary"
                icon={<Paperclip className="h-3.5 w-3.5" />}
                onClick={() => fileRef.current?.click()}
              >
                {receiptFile ? receiptFile.name : appointment?.receipt_name || 'Adjuntar comprobante'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </Field>
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
