export interface LaborRate {
  id: string;
  name: string;
  category: string;
  estimated_hours: number;
  price: number;
  hourly_rate_applied?: number | null;
  notes?: string | null;
  active: boolean;
  created_at?: string;
  updated_at: string;
  updated_by_name?: string | null;
}

export interface LaborSettings {
  hourly_rate: number;
  notes?: string | null;
  last_updated: string;
  updated_by_name?: string | null;
}

export const LABOR_CATEGORIES = [
  'Service y Motor',
  'Frenos',
  'Suspensión y Dirección',
  'Transmisión y Embrague',
  'Neumáticos y Alineación',
  'Electricidad e Iluminación',
  'Aire Acondicionado y Calefacción',
  'Chapa y Accesorios',
  'Revisión y Diagnóstico',
  'General',
] as const;

export type LaborCategory = (typeof LABOR_CATEGORIES)[number];
