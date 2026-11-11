import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import {
  APPOINTMENT_STATUS_LABELS,
  PENDING_PRIORITY_LABELS,
  PENDING_STATUS_LABELS,
} from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { formatDate } from '@/lib/utils';
import type { Appointment, PendingTask, PendingTaskAttachment } from '@/types/db';

const PAGE = 500;

async function fetchAllPending(): Promise<PendingTask[]> {
  const out: PendingTask[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('pending_tasks')
      .select('*')
      .order('detected_at', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as PendingTask[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function usePendingTasks() {
  return useQuery({ queryKey: ['pending-tasks'], queryFn: fetchAllPending });
}

export function useVehiclePendingTasks(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['pending-tasks', 'vehicle', vehicleId],
    enabled: !!vehicleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_tasks')
        .select('*')
        .eq('vehicle_id', vehicleId!)
        .order('detected_at', { ascending: false });
      if (error) throw error;
      return data as PendingTask[];
    },
  });
}

export function usePendingAttachments(pendingId: string | undefined) {
  return useQuery({
    queryKey: ['pending-attachments', pendingId],
    enabled: !!pendingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pending_task_attachments')
        .select('*')
        .eq('pending_task_id', pendingId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as PendingTaskAttachment[];
      const withUrls = await Promise.all(
        rows.map(async (a) => {
          const { data: signed } = await supabase.storage.from('work-orders').createSignedUrl(a.storage_path, 3600);
          return { ...a, signedUrl: signed?.signedUrl ?? '' };
        }),
      );
      return withUrls as (PendingTaskAttachment & { signedUrl: string })[];
    },
  });
}

export function useSavePendingTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
    }: {
      id?: string;
      values: Partial<Omit<PendingTask, 'id' | 'created_at' | 'updated_at'>>;
    }) => {
      if (id) {
        const { data, error } = await supabase.from('pending_tasks').update(values).eq('id', id).select().single();
        if (error) throw error;
        return data as PendingTask;
      }
      const { data, error } = await supabase.from('pending_tasks').insert(values).select().single();
      if (error) throw error;
      return data as PendingTask;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['pending-tasks'] });
      qc.invalidateQueries({ queryKey: ['pending-tasks', 'vehicle', p.vehicle_id] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
    },
  });
}

export function useUploadPendingAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pendingId,
      file,
      kind,
      caption,
      userEmail,
    }: {
      pendingId: string;
      file: File;
      kind: 'foto' | 'comprobante';
      caption?: string;
      userEmail?: string | null;
    }) => {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `pending/${pendingId}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from('work-orders').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase.from('pending_task_attachments').insert({
        pending_task_id: pendingId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        kind,
        caption: caption?.trim() || null,
        created_by_email: userEmail ?? null,
      });
      if (dbErr) throw dbErr;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['pending-attachments', v.pendingId] });
    },
  });
}

// -----------------------------------------------------------------------------
// Turnos y proveedores
// -----------------------------------------------------------------------------
async function fetchAllAppointments(): Promise<Appointment[]> {
  const out: Appointment[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as Appointment[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function useAppointments() {
  return useQuery({ queryKey: ['appointments'], queryFn: fetchAllAppointments });
}

export function useVehicleAppointments(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['appointments', 'vehicle', vehicleId],
    enabled: !!vehicleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('vehicle_id', vehicleId!)
        .order('appointment_date', { ascending: false });
      if (error) throw error;
      return data as Appointment[];
    },
  });
}

export function useSaveAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
      receiptFile,
    }: {
      id?: string;
      values: Partial<Omit<Appointment, 'id' | 'created_at' | 'updated_at'>>;
      receiptFile?: File | null;
    }) => {
      const payload = { ...values };
      if (receiptFile) {
        const safe = receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `appointments/${Date.now()}-${safe}`;
        const { error: upErr } = await supabase.storage.from('work-orders').upload(path, receiptFile, {
          contentType: receiptFile.type || 'application/octet-stream',
        });
        if (upErr) throw upErr;
        payload.receipt_path = path;
        payload.receipt_name = receiptFile.name;
      }

      if (id) {
        const { data, error } = await supabase.from('appointments').update(payload).eq('id', id).select().single();
        if (error) throw error;
        return data as Appointment;
      }
      const { data, error } = await supabase.from('appointments').insert(payload).select().single();
      if (error) throw error;
      return data as Appointment;
    },
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['appointments', 'vehicle', a.vehicle_id] });
      qc.invalidateQueries({ queryKey: ['pending-tasks'] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
    },
  });
}

export function usePendingAndAppointmentsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('pending-appts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_tasks' }, () => {
        qc.invalidateQueries({ queryKey: ['pending-tasks'] });
        qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
        qc.invalidateQueries({ queryKey: ['appointments'] });
        qc.invalidateQueries({ queryKey: ['pending-tasks'] });
        qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}

// -----------------------------------------------------------------------------
// Generación de mensaje de WhatsApp (NUNCA cambia el estado del turno a confirmado)
// -----------------------------------------------------------------------------
export function buildAppointmentWhatsAppText(a: Appointment): string {
  const lines = [
    `*RV GROUP SRL – Turno de Mantenimiento*`,
    `• *Unidad:* ${formatPatente(a.patente)}${a.nro_interno ? ` (Int. ${a.nro_interno})` : ''}${a.vehicle_label ? ` – ${a.vehicle_label}` : ''}`,
    `• *Motivo:* ${a.reason}`,
    `• *Taller / Proveedor:* ${a.provider_name}`,
    ...(a.address ? [`• *Dirección:* ${a.address}`] : []),
    `• *Fecha:* ${formatDate(a.appointment_date)}${a.appointment_time ? ` a las ${a.appointment_time} hs` : ''}`,
    ...(a.responsible ? [`• *Responsable:* ${a.responsible}`] : []),
    `• *Estado del turno:* ${APPOINTMENT_STATUS_LABELS[a.status]}`,
    ...(a.observations ? [`• *Observaciones:* ${a.observations}`] : []),
  ];
  return lines.join('\n');
}

export function openWhatsAppWithAppointment(a: Appointment) {
  const text = encodeURIComponent(buildAppointmentWhatsAppText(a));
  const cleanPhone = (a.phone ?? '').replace(/[^0-9]/g, '');
  const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${text}` : `https://wa.me/?text=${text}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

// -----------------------------------------------------------------------------
// Exportaciones Excel
// -----------------------------------------------------------------------------
export function exportPendingToExcel(tasks: PendingTask[]) {
  const rows = tasks.map((p) => ({
    Patente: p.patente,
    'N° Interno': p.nro_interno ?? '',
    Vehículo: p.vehicle_label ?? '',
    'Fecha detectado': formatDate(p.detected_at),
    'Trabajo pendiente': p.task_title,
    Descripción: p.description ?? '',
    Prioridad: PENDING_PRIORITY_LABELS[p.priority],
    Estado: PENDING_STATUS_LABELS[p.status],
    '¿Tiene turno?': p.has_appointment ? 'SÍ' : 'NO',
    'Fecha del turno': p.appointment_date ? formatDate(p.appointment_date) : '',
    'Hora del turno': p.appointment_time ?? '',
    'Taller o proveedor': p.provider_name ?? '',
    Responsable: p.responsible ?? '',
    'Fecha estimada resolución': p.estimated_resolution_at ? formatDate(p.estimated_resolution_at) : '',
    'Fecha reparado': formatDate(p.resolved_at, true),
    Observaciones: p.observations ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] ?? { Patente: '' });
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pendientes');
  XLSX.writeFile(wb, `Pendientes_Generales_RVGroup_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportAppointmentsToExcel(appts: Appointment[]) {
  const rows = appts.map((a) => ({
    Fecha: formatDate(a.appointment_date),
    Hora: a.appointment_time ?? '',
    Patente: a.patente,
    'N° Interno': a.nro_interno ?? '',
    Vehículo: a.vehicle_label ?? '',
    Motivo: a.reason,
    'Taller / Proveedor': a.provider_name,
    Dirección: a.address ?? '',
    Estado: APPOINTMENT_STATUS_LABELS[a.status],
    Responsable: a.responsible ?? '',
    Teléfono: a.phone ?? '',
    Observaciones: a.observations ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] ?? { Fecha: '' });
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Turnos');
  XLSX.writeFile(wb, `Turnos_Proveedores_RVGroup_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
