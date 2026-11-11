import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  Profile,
  WorkOrder,
  WorkOrderItem,
  WorkOrderPhoto,
  WorkOrderStatusEntry,
} from '@/types/db';

const PAGE = 500;

async function fetchAllWorkOrders(): Promise<WorkOrder[]> {
  const out: WorkOrder[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('work_orders')
      .select('*')
      .order('order_number', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as WorkOrder[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function useWorkOrders() {
  return useQuery({ queryKey: ['work-orders'], queryFn: fetchAllWorkOrders });
}

export function useVehicleWorkOrders(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['work-orders', 'vehicle', vehicleId],
    enabled: !!vehicleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*')
        .eq('vehicle_id', vehicleId!)
        .order('order_number', { ascending: false });
      if (error) throw error;
      return data as WorkOrder[];
    },
  });
}

export function useWorkOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['work-order', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('work_orders').select('*').eq('id', id!).single();
      if (error) throw error;
      return data as WorkOrder;
    },
  });
}

export function useWorkOrderItems(id: string | undefined) {
  return useQuery({
    queryKey: ['work-order-items', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_order_items')
        .select('*')
        .eq('work_order_id', id!)
        .order('sort_order')
        .order('created_at');
      if (error) throw error;
      return data as WorkOrderItem[];
    },
  });
}

export function useWorkOrderPhotos(id: string | undefined) {
  return useQuery({
    queryKey: ['work-order-photos', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_order_photos')
        .select('*')
        .eq('work_order_id', id!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as WorkOrderPhoto[];
      const withUrls = await Promise.all(
        rows.map(async (p) => {
          const { data: signed } = await supabase.storage.from('work-orders').createSignedUrl(p.storage_path, 3600);
          return { ...p, signedUrl: signed?.signedUrl ?? '' };
        }),
      );
      return withUrls as (WorkOrderPhoto & { signedUrl: string })[];
    },
  });
}

export function useWorkOrderHistory(id: string | undefined) {
  return useQuery({
    queryKey: ['work-order-history', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_order_status_history')
        .select('*')
        .eq('work_order_id', id!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as WorkOrderStatusEntry[];
    },
  });
}

export function useMechanics() {
  return useQuery({
    queryKey: ['mechanics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('active', true)
        .in('role', ['mecanico', 'admin'])
        .order('full_name');
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export type WorkOrderSavePayload = Partial<
  Omit<WorkOrder, 'id' | 'order_number' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>
>;

export interface ItemDraft {
  id?: string;
  part_id?: string | null;
  part_code: string;
  description: string;
  quantity: string;
  unit: string;
  unit_cost: string;
}

/**
 * Automatización total: Sincroniza la ficha del vehículo en la tabla `vehicles` a partir de la OR.
 * - Actualiza el odómetro (km_actual)
 * - Registra km_cubiertas si se cambiaron neumáticos
 * - Registra km_pastillas_del / km_pastillas_tras si se cambiaron frenos/pastillas
 * - Registra km_amortiguadores_del / tras si se cambió suspensión
 * - Registra last_service_km, last_service_date y calcula next_service_km si es preventivo
 * - Registra km_correas si se cambió distribución
 * - Actualiza status a 'operativo' si la orden se finaliza y estaba en taller
 */
async function syncVehicleFromWorkOrder(
  vehicleId: string,
  wo: WorkOrder,
  items?: ItemDraft[],
) {
  try {
    const { data: v, error: vErr } = await supabase.from('vehicles').select('*').eq('id', vehicleId).single();
    if (vErr || !v) return;

    const km =
      wo.kilometraje != null && Number.isFinite(wo.kilometraje) && wo.kilometraje > 0
        ? Number(wo.kilometraje)
        : null;

    const vehPatch: Record<string, unknown> = {};

    // 1. Odómetro actual (solo actualiza si el nuevo km es válido)
    if (km != null && (!v.km_actual || km >= v.km_actual)) {
      vehPatch.km_actual = km;
    }

    // Texto combinado de la orden y sus repuestos
    const allText = [
      wo.maintenance_type,
      wo.requested_work,
      wo.work_performed,
      wo.failure_description,
      wo.diagnosis,
      ...(items?.map((it) => `${it.description} ${it.part_code}`) ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    // 2. Cambio de Cubiertas
    const isTireChange =
      /cubierta|neum[aá]tic|llanta|gom[ae]r/.test(allText) &&
      (/cambio|recambio|colocaci[oó]n|nueva|nuevas|recapad/.test(allText) ||
        items?.some((it) => /cubierta|neum[aá]tic/.test(it.description.toLowerCase())));

    if (isTireChange && km != null) {
      vehPatch.km_cubiertas = km;
    }

    // 3. Pastillas y Frenos
    const isBrakeChange =
      /pastilla|disco de freno|cinta|campana|freno/.test(allText) &&
      (/cambio|recambio|colocaci[oó]n|nueva|nuevas|rectificac/.test(allText) ||
        items?.some((it) => /pastilla|freno/.test(it.description.toLowerCase())));

    if (isBrakeChange && km != null) {
      if (/traser|tras/.test(allText)) {
        vehPatch.km_pastillas_tras = km;
      } else {
        vehPatch.km_pastillas_del = km;
      }
    }

    // 4. Amortiguadores / Suspensión
    const isSuspensionChange =
      /amortiguador|espiral|suspensi[oó]n|tren delantero|parrilla|bujes|r[oó]tula/.test(allText) &&
      (/cambio|recambio|colocaci[oó]n|nueva|nuevos|rotura/.test(allText) ||
        items?.some((it) => /amortiguador/.test(it.description.toLowerCase())));

    if (isSuspensionChange && km != null) {
      if (/traser|tras/.test(allText)) {
        vehPatch.km_amortiguadores_tras = km;
      } else {
        vehPatch.km_amortiguadores_del = km;
      }
    }

    // 5. Service preventivo de aceite y filtros
    const isPreventive =
      wo.maintenance_type === 'preventivo' ||
      /service|cambio de aceite|filtro de aceite|lubricaci[oó]n/.test(allText);

    if (isPreventive && km != null) {
      vehPatch.last_service_km = km;
      vehPatch.last_service_date = wo.opened_at ? wo.opened_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const interval = v.service_interval_km && v.service_interval_km > 0 ? v.service_interval_km : 10000;
      vehPatch.next_service_km = km + interval;
    }

    // 6. Correas de distribución
    const isBelt =
      /correa|distribuci[oó]n|poly-v|tensor/.test(allText) &&
      /cambio|recambio|kit/.test(allText);

    if (isBelt && km != null) {
      vehPatch.km_correas = km;
    }

    // 7. Liberar vehículo de taller si la orden se finaliza
    if (wo.status === 'finalizada' || wo.status === 'cerrada') {
      if (v.status === 'en_taller') {
        vehPatch.status = 'operativo';
      }
    }

    if (Object.keys(vehPatch).length > 0) {
      await supabase.from('vehicles').update(vehPatch).eq('id', vehicleId);
    }
  } catch (err) {
    console.warn('Sincronización automática de vehículo desde OR:', err);
  }
}

export function useSaveWorkOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
      items,
    }: {
      id?: string;
      values: WorkOrderSavePayload;
      items?: ItemDraft[];
    }) => {
      let saved: WorkOrder;
      if (id) {
        const { data, error } = await supabase.from('work_orders').update(values).eq('id', id).select().single();
        if (error) throw error;
        saved = data as WorkOrder;
      } else {
        const { data, error } = await supabase.from('work_orders').insert(values).select().single();
        if (error) throw error;
        saved = data as WorkOrder;
      }

      if (items) {
        // Sincronización diferencial para evitar descuentos/reintegros innecesarios
        const { data: currentRows, error: curErr } = await supabase
          .from('work_order_items')
          .select('*')
          .eq('work_order_id', saved.id);
        if (curErr) throw curErr;
        const current = (currentRows ?? []) as WorkOrderItem[];

        const clean = items
          .filter((it) => it.description.trim() !== '')
          .map((it, idx) => ({
            id: it.id,
            work_order_id: saved.id,
            part_id: it.part_id || null,
            part_code: it.part_code.trim() || null,
            description: it.description.trim(),
            quantity: Math.max(0.01, Number(it.quantity.replace(',', '.')) || 1),
            unit: it.unit.trim() || 'un.',
            unit_cost: it.unit_cost.trim() === '' ? null : Math.max(0, Number(it.unit_cost.replace(',', '.')) || 0),
            sort_order: idx,
          }));

        const keepIds = new Set(clean.map((c) => c.id).filter(Boolean));
        const toDelete = current.filter((c) => !keepIds.has(c.id)).map((c) => c.id);
        if (toDelete.length) {
          const { error: delErr } = await supabase.from('work_order_items').delete().in('id', toDelete);
          if (delErr) throw delErr;
        }

        for (const row of clean) {
          if (row.id && current.some((c) => c.id === row.id)) {
            const { id: rowId, ...upd } = row;
            const { error: upErr } = await supabase.from('work_order_items').update(upd).eq('id', rowId);
            if (upErr) throw upErr;
          } else {
            const { id: _unused, ...ins } = row;
            const { error: insErr } = await supabase.from('work_order_items').insert(ins);
            if (insErr) throw insErr;
          }
        }
      }

      // Automatización: actualizar ficha del vehículo con los datos del trabajo
      if (saved.vehicle_id) {
        await syncVehicleFromWorkOrder(saved.vehicle_id, saved, items);
      }

      return saved;
    },
    onSuccess: (wo) => {
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['work-order', wo.id] });
      qc.invalidateQueries({ queryKey: ['work-order-items', wo.id] });
      qc.invalidateQueries({ queryKey: ['work-order-history', wo.id] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle', wo.vehicle_id] });
      qc.invalidateQueries({ queryKey: ['parts'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
    },
  });
}

/** Comprime la imagen en el navegador antes de subirla a Storage (ideal para fotos tomadas desde el celular). */
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size < 400_000) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(file);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.82);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export function useUploadWorkOrderPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      workOrderId,
      file,
      caption,
      stage,
      userEmail,
    }: {
      workOrderId: string;
      file: File;
      caption?: string;
      stage?: string;
      userEmail?: string | null;
    }) => {
      const blob = await compressImage(file);
      const ext = blob.type === 'image/png' ? 'png' : 'jpg';
      const path = `photos/${workOrderId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('work-orders').upload(path, blob, {
        contentType: blob.type || 'image/jpeg',
        upsert: false,
      });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase.from('work_order_photos').insert({
        work_order_id: workOrderId,
        storage_path: path,
        caption: caption?.trim() || null,
        stage: stage || 'reparacion',
        created_by_email: userEmail ?? null,
      });
      if (dbErr) throw dbErr;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['work-order-photos', v.workOrderId] });
    },
  });
}

export function useDeleteWorkOrderPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ photo }: { photo: WorkOrderPhoto }) => {
      await supabase.storage.from('work-orders').remove([photo.storage_path]);
      const { error } = await supabase.from('work_order_photos').delete().eq('id', photo.id);
      if (error) throw error;
      return photo.work_order_id;
    },
    onSuccess: (woId) => {
      qc.invalidateQueries({ queryKey: ['work-order-photos', woId] });
    },
  });
}

export function useWorkOrdersRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('wo-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_orders' }, (payload) => {
        qc.invalidateQueries({ queryKey: ['work-orders'] });
        qc.invalidateQueries({ queryKey: ['fleet-stats'] });
        const id = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
        if (id) {
          qc.invalidateQueries({ queryKey: ['work-order', id] });
          qc.invalidateQueries({ queryKey: ['work-order-history', id] });
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
