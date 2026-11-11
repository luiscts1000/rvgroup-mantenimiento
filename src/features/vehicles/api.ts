import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AuditEntry, FleetStats, ImportBatch, Vehicle, VehicleCategory, VehicleInput } from '@/types/db';
import type { ExistingKeys } from './importLogic';

const PAGE = 1000;

/** Lee todas las filas superando el límite de 1000 registros por consulta. */
async function fetchAllVehicles(): Promise<Vehicle[]> {
  const out: Vehicle[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*, vehicle_categories(name)')
      .order('patente')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as Vehicle[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function useVehicles() {
  return useQuery({ queryKey: ['vehicles'], queryFn: fetchAllVehicles });
}

export function useVehicle(id: string | undefined) {
  return useQuery({
    queryKey: ['vehicle', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*, vehicle_categories(name)').eq('id', id!).single();
      if (error) throw error;
      return data as Vehicle;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicle_categories').select('*').order('sort_order').order('name');
      if (error) throw error;
      return data as VehicleCategory[];
    },
  });
}

export function useFleetStats() {
  return useQuery({
    queryKey: ['fleet-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_fleet_stats');
      if (error) throw error;
      return data as FleetStats;
    },
  });
}

export function useVehicleAudit(id: string | undefined) {
  return useQuery({
    queryKey: ['audit', 'vehicles', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_log')
        .select('*')
        .eq('table_name', 'vehicles')
        .eq('record_id', id!)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as AuditEntry[];
    },
  });
}

export function useImportBatches() {
  return useQuery({
    queryKey: ['import-batches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as ImportBatch[];
    },
  });
}

export function useSaveVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Partial<VehicleInput> }) => {
      if (id) {
        const { data, error } = await supabase.from('vehicles').update(values).eq('id', id).select().single();
        if (error) throw error;
        return data as Vehicle;
      }
      const { data, error } = await supabase.from('vehicles').insert(values).select().single();
      if (error) throw error;
      return data as Vehicle;
    },
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle', v.id] });
      qc.invalidateQueries({ queryKey: ['audit', 'vehicles', v.id] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
    },
  });
}

/** Claves existentes para validar duplicados antes de importar. */
export async function fetchExistingKeys(): Promise<ExistingKeys> {
  const keys: ExistingKeys = { patentes: new Set(), internos: new Set(), chasis: new Set() };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('vehicles')
      .select('patente, nro_interno, chasis, status')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    (data ?? []).forEach((v) => {
      keys.patentes.add(v.patente);
      if (v.nro_interno && v.status !== 'baja') keys.internos.add(String(v.nro_interno).toUpperCase());
      if (v.chasis) keys.chasis.add(String(v.chasis).toUpperCase());
    });
    if (!data || data.length < PAGE) break;
  }
  return keys;
}

/** Suscripción en tiempo real: refresca los datos cuando otro usuario modifica la flota. */
export function useFleetRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('fleet-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, (payload) => {
        qc.invalidateQueries({ queryKey: ['vehicles'] });
        qc.invalidateQueries({ queryKey: ['fleet-stats'] });
        const id = (payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id;
        if (id) {
          qc.invalidateQueries({ queryKey: ['vehicle', id] });
          qc.invalidateQueries({ queryKey: ['audit', 'vehicles', id] });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_categories' }, () => {
        qc.invalidateQueries({ queryKey: ['categories'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
