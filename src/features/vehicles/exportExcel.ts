import * as XLSX from 'xlsx';
import { STATUS_LABELS } from '@/lib/constants';
import type { Vehicle } from '@/types/db';

/** Exporta la flota (o el subconjunto filtrado) a un archivo Excel. */
export function exportVehiclesToExcel(vehicles: Vehicle[], fileSuffix = '') {
  const rows = vehicles.map((v) => ({
    'N° de orden / registro': v.registro_nro ?? '',
    Patente: v.patente,
    'N° interno': v.nro_interno ?? '',
    Categoría: v.vehicle_categories?.name ?? '',
    Marca: v.marca ?? '',
    Modelo: v.modelo ?? '',
    Versión: v.version ?? '',
    Año: v.anio ?? '',
    'N° de chasis': v.chasis ?? '',
    'N° de motor': v.motor ?? '',
    Kilometraje: v.km_actual ?? '',
    'Tipo de vehículo': v.vehicle_type ?? '',
    'Tipo / medida de cubiertas': v.tire_type_size ?? '',
    'Cantidad de cubiertas': v.tire_count ?? '',
    Estado: STATUS_LABELS[v.status],
    Observaciones: v.observaciones ?? '',
    'Dato de demostración': v.is_demo ? 'SÍ (DEMO)' : '',
    'Última actualización': new Date(v.updated_at).toLocaleString('es-AR'),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] ?? { Patente: '' });
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Flota');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Flota_RVGroup_${date}${fileSuffix}.xlsx`);
}
