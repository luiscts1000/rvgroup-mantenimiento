import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { PART_CATEGORY_LABELS } from '@/lib/constants';
import { slug } from '@/lib/utils';
import type { Part, PartCategory, StockMovement, StockMovementType } from '@/types/db';

const PAGE = 1000;

async function fetchAllParts(): Promise<Part[]> {
  const out: Part[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('parts')
      .select('*, part_category_compatibility(category_id)')
      .order('internal_code')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as Part[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export function useParts() {
  return useQuery({ queryKey: ['parts'], queryFn: fetchAllParts });
}

export function useStockMovements(partId?: string) {
  return useQuery({
    queryKey: ['stock-movements', partId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('stock_movements')
        .select('*, parts(internal_code, description, unit)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (partId) q = q.eq('part_id', partId);
      const { data, error } = await q;
      if (error) throw error;
      return data as StockMovement[];
    },
  });
}

export type PartSaveInput = {
  internal_code: string;
  original_code: string | null;
  description: string;
  category: PartCategory;
  brand: string | null;
  compatibility_notes: string | null;
  initial_quantity?: number;
  min_stock: number;
  unit: string;
  purchase_price: number | null;
  supplier: string | null;
  location: string | null;
  active: boolean;
  category_ids: string[];
};

export function useSavePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: PartSaveInput }) => {
      const { category_ids, initial_quantity, ...payload } = values;
      let saved: Part;

      if (id) {
        const { data, error } = await supabase.from('parts').update(payload).eq('id', id).select().single();
        if (error) throw error;
        saved = data as Part;
      } else {
        const { data, error } = await supabase
          .from('parts')
          .insert({ ...payload, quantity: 0 })
          .select()
          .single();
        if (error) throw error;
        saved = data as Part;

        if (initial_quantity && initial_quantity > 0) {
          const { error: movErr } = await supabase.rpc('record_stock_movement', {
            p_part_id: saved.id,
            p_type: 'ingreso',
            p_quantity: initial_quantity,
            p_unit_cost: payload.purchase_price,
            p_reason: 'Stock inicial al dar de alta el repuesto',
          });
          if (movErr) throw movErr;
        }
      }

      // Actualizar compatibilidad con categorías de vehículos
      await supabase.from('part_category_compatibility').delete().eq('part_id', saved.id);
      if (category_ids.length) {
        await supabase.from('part_category_compatibility').insert(
          category_ids.map((cid) => ({ part_id: saved.id, category_id: cid })),
        );
      }

      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parts'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
    },
  });
}

export function useRecordStockMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      partId: string;
      type: StockMovementType;
      quantity: number;
      unitCost?: number | null;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc('record_stock_movement', {
        p_part_id: params.partId,
        p_type: params.type,
        p_quantity: params.quantity,
        p_unit_cost: params.unitCost ?? null,
        p_reason: params.reason ?? null,
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parts'] });
      qc.invalidateQueries({ queryKey: ['stock-movements'] });
      qc.invalidateQueries({ queryKey: ['fleet-stats'] });
    },
  });
}

export function usePartsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('parts-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts' }, () => {
        qc.invalidateQueries({ queryKey: ['parts'] });
        qc.invalidateQueries({ queryKey: ['fleet-stats'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}

// -----------------------------------------------------------------------------
// Exportación e importación Excel de inventario
// -----------------------------------------------------------------------------
export function exportPartsToExcel(parts: Part[]) {
  const rows = parts.map((p) => ({
    'Código interno': p.internal_code,
    'Código original': p.original_code ?? '',
    Descripción: p.description,
    Categoría: PART_CATEGORY_LABELS[p.category],
    Marca: p.brand ?? '',
    'Compatibilidad con vehículos': p.compatibility_notes ?? '',
    'Cantidad disponible': Number(p.quantity),
    'Stock mínimo': Number(p.min_stock),
    'Unidad de medida': p.unit,
    'Precio de compra': p.purchase_price != null ? Number(p.purchase_price) : '',
    Proveedor: p.supplier ?? '',
    Ubicación: p.location ?? '',
    Alerta: Number(p.quantity) <= Number(p.min_stock) ? 'STOCK BAJO' : 'OK',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] ?? { 'Código interno': '' });
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Inventario_Repuestos_RVGroup_${date}.xlsx`);
}

export function downloadPartsTemplate() {
  const headers = [
    'Código interno',
    'Código original',
    'Descripción',
    'Categoría',
    'Marca',
    'Compatibilidad con vehículos',
    'Cantidad disponible',
    'Stock mínimo',
    'Unidad de medida',
    'Precio de compra',
    'Proveedor',
    'Ubicación',
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(15, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Repuestos');
  XLSX.writeFile(wb, 'Plantilla_Inventario_RVGroup.xlsx');
}

function parsePartCategory(raw: string): PartCategory {
  const s = slug(raw);
  if (s.includes('filtro')) return 'filtros';
  if (s.includes('aceite')) return 'aceites';
  if (s.includes('lubric')) return 'lubricantes';
  if (s.includes('liquid') || s.includes('refrig')) return 'liquidos';
  if (s.includes('freno') || s.includes('pastilla') || s.includes('disco')) return 'frenos';
  if (s.includes('suspens') || s.includes('amortig')) return 'suspension';
  if (s.includes('motor') || s.includes('correa') || s.includes('distribu')) return 'repuestos_motor';
  if (s.includes('electr') || s.includes('lampara') || s.includes('fusib')) return 'electricidad';
  if (s.includes('aire') || s.includes('acondic') || s.includes('climat')) return 'aire_acondicionado';
  if (s.includes('cubiert') || s.includes('neumat')) return 'cubiertas';
  if (s.includes('bater')) return 'baterias';
  return 'otros';
}

export async function parsePartsExcelFile(file: File) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  const pick = (row: Record<string, unknown>, keys: string[]) => {
    for (const [k, v] of Object.entries(row)) {
      if (keys.some((alias) => slug(k).includes(alias))) return String(v ?? '').trim();
    }
    return '';
  };

  return rows
    .map((r) => {
      const internal_code = pick(r, ['codigointerno', 'interno', 'codigo', 'sku']);
      const description = pick(r, ['descripcion', 'nombre', 'repuesto', 'detalle']);
      const num = (s: string) => {
        const n = Number(s.replace(',', '.'));
        return Number.isFinite(n) ? n : null;
      };
      return {
        internal_code: internal_code.toUpperCase(),
        original_code: pick(r, ['codigooriginal', 'original', 'oem']) || null,
        description,
        category: parsePartCategory(pick(r, ['categoria', 'rubro', 'familia'])),
        brand: pick(r, ['marca', 'fabricante']) || null,
        compatibility_notes: pick(r, ['compatibilidad', 'vehiculo', 'aplicacion', 'modelo']) || null,
        quantity: num(pick(r, ['cantidaddisponible', 'cantidad', 'stock', 'existencia'])) ?? 0,
        min_stock: num(pick(r, ['stockminimo', 'minimo', 'alerta'])) ?? 0,
        unit: pick(r, ['unidaddemedida', 'unidad', 'medida']) || 'un.',
        purchase_price: num(pick(r, ['preciodecompra', 'precio', 'costo'])),
        supplier: pick(r, ['proveedor']) || null,
        location: pick(r, ['ubicacion', 'estante', 'deposito']) || null,
      };
    })
    .filter((r) => r.internal_code && r.description);
}
