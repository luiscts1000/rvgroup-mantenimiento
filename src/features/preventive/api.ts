import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { CHECK_ITEM_LABELS, RTO_CHECKLIST_ITEMS, STATUS_LABELS } from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import {
  injectProvincialRtoInText,
  isMissingProvincialRtoColumnError,
  normalizeInspectionProvincialRto,
  setLocalInspectionProvincialRto,
  setLocalProvincialRto,
} from '@/lib/rtoProvincialStorage';
import type { CheckItemState, PreventiveInspection, Vehicle } from '@/types/db';

const INSPECTIONS_KEY = ['preventive-inspections'];

export type PreventiveKmField =
  | 'km_cubiertas'
  | 'km_correas'
  | 'km_amortiguadores_del'
  | 'km_amortiguadores_tras'
  | 'km_cintas'
  | 'km_pastillas_del'
  | 'km_pastillas_tras'
  | 'km_discos_tras'
  | 'km_discos_del'
  | 'km_fluidos';

export interface PreventiveKmColumnDef {
  field: PreventiveKmField;
  label: string;
  shortHeader: string;
  defaultStepKm: number;
}

export const PREVENTIVE_KM_COLUMNS: PreventiveKmColumnDef[] = [
  { field: 'km_cubiertas', label: 'Cubiertas', shortHeader: 'Cubiertas', defaultStepKm: 40000 },
  { field: 'km_correas', label: 'Correas', shortHeader: 'Correas', defaultStepKm: 120000 },
  { field: 'km_amortiguadores_del', label: 'Amortiguadores Delanteros', shortHeader: 'Amortiguadores Del', defaultStepKm: 80000 },
  { field: 'km_amortiguadores_tras', label: 'Amortiguadores Traseros', shortHeader: 'Amortiguadores Tras', defaultStepKm: 70000 },
  { field: 'km_cintas', label: 'Cintas de Freno', shortHeader: 'Cintas', defaultStepKm: 80000 },
  { field: 'km_pastillas_del', label: 'Pastillas Delanteras', shortHeader: 'Pastillas Del', defaultStepKm: 50000 },
  { field: 'km_pastillas_tras', label: 'Pastillas Traseras', shortHeader: 'Pastillas Tras', defaultStepKm: 50000 },
  { field: 'km_discos_tras', label: 'Discos de Freno Traseros', shortHeader: 'Discos de Freno Tr', defaultStepKm: 80000 },
  { field: 'km_discos_del', label: 'Discos de Freno Delanteros', shortHeader: 'Discos de Freno De', defaultStepKm: 80000 },
  { field: 'km_fluidos', label: 'Fluidos', shortHeader: 'Fluidos', defaultStepKm: 80000 },
];

export type BrandGroup = 'toyota' | 'ranger' | 'sprinter' | 'otro';

export function getBrandGroup(v: Vehicle): BrandGroup {
  const raw = `${v.marca ?? ''} ${v.modelo ?? ''} ${v.version ?? ''} ${v.vehicle_categories?.name ?? ''}`.toLowerCase();
  if (raw.includes('toyota') || raw.includes('hilux')) return 'toyota';
  if (raw.includes('ford') || raw.includes('ranger')) return 'ranger';
  if (raw.includes('sprinter') || raw.includes('mercedes') || raw.includes('916') || raw.includes('minibus'))
    return 'sprinter';
  return 'otro';
}

export function formatShortModelLabel(v: Vehicle): string {
  const raw = `${v.marca ?? ''} ${v.modelo ?? ''} ${v.version ?? ''}`.toUpperCase();
  if (raw.includes('HILUX')) return 'Toyota Hilux';
  if (raw.includes('RANGER')) return 'Ford Ranger';
  if (raw.includes('916')) return 'MB 916 Minibus Euro V';
  if (raw.includes('414')) return 'Sprinter 414 9+1';
  if (raw.includes('416')) return 'Sprinter 416 9+1';
  if (raw.includes('516')) return 'Sprinter 516 19+1';
  if (raw.includes('517') && raw.includes('11+1')) return 'Sprinter 517 11+1';
  if (raw.includes('517')) return 'Sprinter 517 19+1';
  return [v.marca, v.modelo].filter(Boolean).join(' ') || 'Unidad';
}

export function getPresetByBrand(brand: BrandGroup): Record<PreventiveKmField, number | null> {
  if (brand === 'toyota') {
    return {
      km_cubiertas: 40000,
      km_correas: 150000,
      km_amortiguadores_del: 100000,
      km_amortiguadores_tras: 120000,
      km_cintas: 140000,
      km_pastillas_del: 90000,
      km_pastillas_tras: null,
      km_discos_tras: null,
      km_discos_del: null,
      km_fluidos: 80000,
    };
  }
  if (brand === 'ranger') {
    return {
      km_cubiertas: 40000,
      km_correas: 120000,
      km_amortiguadores_del: 100000,
      km_amortiguadores_tras: 120000,
      km_cintas: 140000,
      km_pastillas_del: 90000,
      km_pastillas_tras: null,
      km_discos_tras: null,
      km_discos_del: null,
      km_fluidos: 250000,
    };
  }
  // Sprinter / Mercedes-Benz
  return {
    km_cubiertas: 40000,
    km_correas: 120000,
    km_amortiguadores_del: 80000,
    km_amortiguadores_tras: 70000,
    km_cintas: 80000,
    km_pastillas_del: 50000,
    km_pastillas_tras: 50000,
    km_discos_tras: 80000,
    km_discos_del: 80000,
    km_fluidos: 250000,
  };
}

export function getComponentCellClass(currentKm: number | null | undefined, targetKm: number | null | undefined): string {
  if (targetKm == null) {
    return 'bg-emerald-50/50 text-slate-400 dark:bg-slate-900/40 dark:text-slate-600';
  }
  if (currentKm == null) {
    return 'bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
  const diff = targetKm - currentKm;
  if (diff <= 0) {
    return 'bg-red-300/85 text-red-950 font-semibold dark:bg-red-900/65 dark:text-red-100';
  }
  if (diff <= 10000) {
    return 'bg-yellow-200/90 text-yellow-950 font-semibold dark:bg-yellow-800/65 dark:text-yellow-100';
  }
  return 'bg-emerald-100/85 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-200';
}

export function getRestanteCellClass(remainingKm: number | null): string {
  if (remainingKm == null) {
    return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  }
  if (remainingKm < 1000) {
    return 'bg-red-400/85 text-red-950 font-bold dark:bg-red-900/75 dark:text-red-100';
  }
  if (remainingKm <= 2500) {
    return 'bg-yellow-200/95 text-yellow-950 font-bold dark:bg-yellow-800/70 dark:text-yellow-100';
  }
  return 'bg-emerald-200/80 text-emerald-950 font-bold dark:bg-emerald-900/50 dark:text-emerald-200';
}

export function useInspections(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleId ? [...INSPECTIONS_KEY, vehicleId] : INSPECTIONS_KEY,
    queryFn: async (): Promise<PreventiveInspection[]> => {
      let q = supabase
        .from('preventive_inspections')
        .select('*')
        .order('inspected_at', { ascending: false })
        .order('created_at', { ascending: false });
      if (vehicleId) q = q.eq('vehicle_id', vehicleId);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as PreventiveInspection[]).map(normalizeInspectionProvincialRto);
    },
  });
}

export interface CreateInspectionInput {
  vehicle_id: string;
  inspected_at: string;
  inspector_name?: string | null;
  kilometraje?: number | null;
  rto_due_date?: string | null;
  rto_provincial_due_date?: string | null;
  windshield_state: CheckItemState;
  windshield_notes?: string | null;
  tires_state: CheckItemState;
  tires_notes?: string | null;
  brakes_state: CheckItemState;
  brakes_notes?: string | null;
  suspension_state: CheckItemState;
  suspension_notes?: string | null;
  lights_state: CheckItemState;
  lights_notes?: string | null;
  seatbelts_state: CheckItemState;
  seatbelts_notes?: string | null;
  safety_elements_state: CheckItemState;
  safety_elements_notes?: string | null;
  documentation_state: CheckItemState;
  documentation_notes?: string | null;
  observations?: string | null;
  generate_pending: boolean;
}

export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateInspectionInput) => {
      const { generate_pending, ...payload } = input;
      const payloadWithObs = {
        ...payload,
        observations: payload.rto_provincial_due_date
          ? injectProvincialRtoInText(payload.observations, payload.rto_provincial_due_date)
          : payload.observations,
      };
      const { data, error } = await supabase.rpc('create_inspection_with_pendings', {
        p_inspection: payloadWithObs,
        p_generate_pending: generate_pending,
      });
      if (error) throw error;

      const res = data as {
        inspection_id: string;
        ready_for_rto: boolean;
        generated_pendings: number;
      };

      if (input.rto_provincial_due_date) {
        setLocalInspectionProvincialRto(res.inspection_id, input.rto_provincial_due_date);
        setLocalProvincialRto(input.vehicle_id, input.rto_provincial_due_date);

        const { error: vehErr } = await supabase
          .from('vehicles')
          .update({ rto_provincial_due_date: input.rto_provincial_due_date })
          .eq('id', input.vehicle_id);

        if (vehErr && isMissingProvincialRtoColumnError(vehErr)) {
          const { data: curr } = await supabase
            .from('vehicles')
            .select('observaciones')
            .eq('id', input.vehicle_id)
            .single();
          const baseObs = (curr as { observaciones?: string | null } | null)?.observaciones ?? null;
          await supabase
            .from('vehicles')
            .update({ observaciones: injectProvincialRtoInText(baseObs, input.rto_provincial_due_date) })
            .eq('id', input.vehicle_id);
        }
      }

      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: INSPECTIONS_KEY });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle'] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      qc.invalidateQueries({ queryKey: ['pending-tasks'] });
    },
  });
}

export interface UpdateVehiclePreventiveInput {
  id: string;
  rto_due_date?: string | null;
  rto_provincial_due_date?: string | null;
  service_interval_km?: number | null;
  last_service_km?: number | null;
  last_service_date?: string | null;
  km_actual?: number | null;
  next_service_km?: number | null;
  km_cubiertas?: number | null;
  km_correas?: number | null;
  km_amortiguadores_del?: number | null;
  km_amortiguadores_tras?: number | null;
  km_cintas?: number | null;
  km_pastillas_del?: number | null;
  km_pastillas_tras?: number | null;
  km_discos_tras?: number | null;
  km_discos_del?: number | null;
  km_fluidos?: number | null;
}

export function useUpdateVehiclePreventive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateVehiclePreventiveInput) => {
      const { id, ...patch } = input;
      if (patch.rto_provincial_due_date !== undefined) {
        setLocalProvincialRto(id, patch.rto_provincial_due_date);
      }

      const { error } = await supabase.from('vehicles').update(patch).eq('id', id);
      if (!error) return;

      if (isMissingProvincialRtoColumnError(error)) {
        const { rto_provincial_due_date, ...restPatch } = patch;
        const { data: curr } = await supabase.from('vehicles').select('observaciones').eq('id', id).single();
        const baseObs = (curr as { observaciones?: string | null } | null)?.observaciones ?? null;
        const fallbackPatch = {
          ...restPatch,
          observaciones: injectProvincialRtoInText(baseObs, rto_provincial_due_date),
        };
        const { error: retryErr } = await supabase.from('vehicles').update(fallbackPatch).eq('id', id);
        if (retryErr) throw retryErr;
        return;
      }

      throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle'] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
    },
  });
}

export function usePreventiveRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('preventive-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'preventive_inspections' }, () => {
        qc.invalidateQueries({ queryKey: INSPECTIONS_KEY });
        qc.invalidateQueries({ queryKey: ['vehicles'] });
        qc.invalidateQueries({ queryKey: ['fleet-stats'] });
        qc.invalidateQueries({ queryKey: ['pending-tasks'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function getRtoStatus(rtoDueDate?: string | null): {
  code: 'vencida' | 'proxima' | 'vigente' | 'sin_fecha';
  label: string;
  daysDiff: number | null;
  badgeClass: string;
} {
  if (!rtoDueDate) {
    return {
      code: 'sin_fecha',
      label: 'Sin fecha',
      daysDiff: null,
      badgeClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${rtoDueDate}T00:00:00`);
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      code: 'vencida',
      label: `Vencida (${Math.abs(diffDays)} d)`,
      daysDiff: diffDays,
      badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };
  }
  if (diffDays <= 30) {
    return {
      code: 'proxima',
      label: diffDays === 0 ? 'Vence hoy' : `Próxima (${diffDays} d)`,
      daysDiff: diffDays,
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    };
  }
  return {
    code: 'vigente',
    label: `Vigente (${diffDays} d)`,
    daysDiff: diffDays,
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  };
}

/** Determina si una unidad es Sprinter o Minibús y por ende requiere RTO Nacional y Provincial */
export function supportsProvincialRto(v?: {
  vehicle_type?: string | null;
  marca?: string | null;
  modelo?: string | null;
  version?: string | null;
  category_id?: string | null;
  vehicle_categories?: { name?: string } | null;
} | null): boolean {
  if (!v) return false;
  const raw = `${v.vehicle_type ?? ''} ${v.marca ?? ''} ${v.modelo ?? ''} ${v.version ?? ''} ${v.vehicle_categories?.name ?? ''}`.toLowerCase();
  return (
    raw.includes('sprinter') ||
    raw.includes('minibus') ||
    raw.includes('minibús') ||
    raw.includes('mercedes') ||
    raw.includes('916') ||
    raw.includes('furgon') ||
    raw.includes('furgón')
  );
}

/** Evalúa el estado conjunto de RTO Nacional y Provincial para la unidad */
export function getCombinedRtoStatus(v: {
  rto_due_date?: string | null;
  rto_provincial_due_date?: string | null;
  vehicle_type?: string | null;
  marca?: string | null;
  modelo?: string | null;
  version?: string | null;
  vehicle_categories?: { name?: string } | null;
}) {
  const isDual = supportsProvincialRto(v);
  const nac = getRtoStatus(v.rto_due_date);
  const prov = isDual && v.rto_provincial_due_date ? getRtoStatus(v.rto_provincial_due_date) : null;

  if (!isDual) {
    return {
      code: nac.code,
      label: `RTO Nac: ${nac.label}`,
      nacional: nac,
      provincial: null,
      isDual: false,
      worstStatus: nac,
    };
  }

  if (nac.code === 'vencida' || prov?.code === 'vencida') {
    const expiredLabel =
      nac.code === 'vencida' && prov?.code === 'vencida'
        ? 'RTO Nac y Prov vencidas'
        : nac.code === 'vencida'
          ? `RTO Nac vencida (${Math.abs(nac.daysDiff ?? 0)} d)`
          : `RTO Prov vencida (${Math.abs(prov?.daysDiff ?? 0)} d)`;
    return {
      code: 'vencida' as const,
      label: expiredLabel,
      nacional: nac,
      provincial: prov,
      isDual: true,
      worstStatus: nac.code === 'vencida' ? nac : prov!,
    };
  }

  if (nac.code === 'proxima' || prov?.code === 'proxima') {
    const proxLabel =
      nac.code === 'proxima'
        ? `RTO Nac vence en ${nac.daysDiff} d`
        : `RTO Prov vence en ${prov?.daysDiff} d`;
    return {
      code: 'proxima' as const,
      label: proxLabel,
      nacional: nac,
      provincial: prov,
      isDual: true,
      worstStatus: nac.code === 'proxima' ? nac : prov!,
    };
  }

  if (nac.code === 'vigente' || prov?.code === 'vigente') {
    return {
      code: 'vigente' as const,
      label: 'RTOs vigentes',
      nacional: nac,
      provincial: prov,
      isDual: true,
      worstStatus: nac.code === 'vigente' ? nac : (prov ?? nac),
    };
  }

  return {
    code: 'sin_fecha' as const,
    label: 'Sin RTO cargada',
    nacional: nac,
    provincial: prov,
    isDual: true,
    worstStatus: nac,
  };
}

export function getServiceKmStatus(v: Vehicle): {
  code: 'vencido' | 'proximo' | 'al_dia' | 'sin_datos';
  label: string;
  remainingKm: number | null;
  nextKm: number | null;
  badgeClass: string;
} {
  const nextKm =
    v.next_service_km != null
      ? v.next_service_km
      : v.last_service_km != null && v.service_interval_km
        ? v.last_service_km + v.service_interval_km
        : null;

  if (v.km_actual == null || nextKm == null) {
    return {
      code: 'sin_datos',
      label: 'Sin control km',
      remainingKm: null,
      nextKm,
      badgeClass: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    };
  }
  const remainingKm = nextKm - v.km_actual;
  if (remainingKm < 1000) {
    return {
      code: 'vencido',
      label:
        remainingKm < 0
          ? `Vencido (${remainingKm.toLocaleString('es-AR')} km)`
          : `Crítico (${remainingKm.toLocaleString('es-AR')} km)`,
      remainingKm,
      nextKm,
      badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    };
  }
  if (remainingKm <= 2500) {
    return {
      code: 'proximo',
      label: `Próximo (${remainingKm.toLocaleString('es-AR')} km)`,
      remainingKm,
      nextKm,
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    };
  }
  return {
    code: 'al_dia',
    label: `Al día (${remainingKm.toLocaleString('es-AR')} km)`,
    remainingKm,
    nextKm,
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  };
}

export function exportPreventiveToExcel(vehicles: Vehicle[], inspections: PreventiveInspection[]) {
  const latestByVehicle = new Map<string, PreventiveInspection>();
  for (const insp of inspections) {
    if (!latestByVehicle.has(insp.vehicle_id)) {
      latestByVehicle.set(insp.vehicle_id, insp);
    }
  }

  const fleetRows = vehicles
    .filter((v) => v.status !== 'baja')
    .sort((a, b) => {
      const ra = getServiceKmStatus(a).remainingKm ?? 999999;
      const rb = getServiceKmStatus(b).remainingKm ?? 999999;
      return ra - rb;
    })
    .map((v) => {
      const isDual = supportsProvincialRto(v);
      const combined = getCombinedRtoStatus(v);
      const svc = getServiceKmStatus(v);
      const lastInsp = latestByVehicle.get(v.id);
      return {
        Modelo: formatShortModelLabel(v),
        Interno: v.nro_interno ?? '-',
        Patente: formatPatente(v.patente),
        Km: v.km_actual ?? '',
        'Proximo Servi': svc.nextKm ?? '',
        Restante: svc.remainingKm ?? '',
        Cubiertas: v.km_cubiertas ?? '-',
        Correas: v.km_correas ?? '-',
        'Amortiguadores Del': v.km_amortiguadores_del ?? '-',
        'Amortiguadores Tras': v.km_amortiguadores_tras ?? '-',
        Cintas: v.km_cintas ?? '-',
        'Pastillas Del': v.km_pastillas_del ?? '-',
        'Pastillas Tras': v.km_pastillas_tras ?? '-',
        'Discos de Freno Tr': v.km_discos_tras ?? '-',
        'Discos de Freno De': v.km_discos_del ?? '-',
        Fluidos: v.km_fluidos ?? '-',
        'Vencimiento RTO Nacional': v.rto_due_date ?? '',
        'Vencimiento RTO Provincial': isDual ? (v.rto_provincial_due_date ?? '') : 'N/A',
        'Estado RTO Nacional': combined.nacional.label,
        'Estado RTO Provincial': isDual && combined.provincial ? combined.provincial.label : 'N/A',
        'Apta Pre-RTO': lastInsp ? (lastInsp.overall_ready_for_rto ? 'Sí' : 'Requiere trabajos') : 'Sin inspección',
        'Estado Unidad': STATUS_LABELS[v.status],
      };
    });

  const inspRows = inspections.map((i) => {
    const row: Record<string, string | number> = {
      Fecha: i.inspected_at,
      Patente: formatPatente(i.patente),
      'N° Interno': i.nro_interno ?? '',
      Unidad: i.vehicle_label ?? '',
      Kilometraje: i.kilometraje ?? '',
      'Vencimiento RTO Nacional': i.rto_due_date ?? '',
      'Vencimiento RTO Provincial': i.rto_provincial_due_date ?? '',
      Inspector: i.inspector_name ?? '',
      'Apta para RTO': i.overall_ready_for_rto ? 'Apta' : 'Requiere trabajos previos',
      'Pendientes Generados': i.generated_pending_count,
    };
    for (const item of RTO_CHECKLIST_ITEMS) {
      row[item.label] = CHECK_ITEM_LABELS[i[item.stateField]];
      row[`${item.label} (Detalle)`] = i[item.notesField] ?? '';
    }
    row.Observaciones = i.observations ?? '';
    return row;
  });

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(fleetRows);
  const ws2 = XLSX.utils.json_to_sheet(inspRows);
  XLSX.utils.book_append_sheet(wb, ws1, 'Planilla Preventiva Km');
  XLSX.utils.book_append_sheet(wb, ws2, 'Inspecciones Pre-RTO');
  XLSX.writeFile(wb, `Planilla_Preventiva_RVGroup_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
