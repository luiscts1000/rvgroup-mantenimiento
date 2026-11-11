import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { LaborRate, LaborSettings } from '@/types/laborRates';

const STORAGE_KEY_RATES = 'rvgroup_labor_rates_v1';
const STORAGE_KEY_SETTINGS = 'rvgroup_labor_settings_v1';

export const DEFAULT_HOURLY_RATE = 28000; // $28.000 / hora base taller RV Group

export const DEFAULT_LABOR_RATES: LaborRate[] = [
  {
    id: 'lr-01',
    name: 'Service básico: cambio de aceite y filtros (aceite y aire)',
    category: 'Service y Motor',
    estimated_hours: 1.0,
    price: 28000,
    notes: 'Reemplazo de aceite de motor y filtros principales. Revisión de niveles.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-02',
    name: 'Service completo: aceite + 4 filtros (aceite, aire, combustible, habitáculo)',
    category: 'Service y Motor',
    estimated_hours: 1.5,
    price: 42000,
    notes: 'Incluye purga de circuito de gasoil y sopleteado/reemplazo de polen.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-03',
    name: 'Cambio de pastillas de freno delanteras (ambas ruedas)',
    category: 'Frenos',
    estimated_hours: 1.0,
    price: 30000,
    notes: 'Incluye limpieza de cálipers, lubricación de pernos guía y purga de líquido si corresponde.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-04',
    name: 'Cambio de discos y pastillas de freno delanteras',
    category: 'Frenos',
    estimated_hours: 1.8,
    price: 52000,
    notes: 'Desarme de masas, colocación de discos nuevos y pastillas con asentamiento inicial.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-05',
    name: 'Cambio de cintas de freno traseras y rectificación / regulación',
    category: 'Frenos',
    estimated_hours: 2.0,
    price: 58000,
    notes: 'Desarme de campanas, control de bombines y regulación de freno de mano.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-06',
    name: 'Cambio de pastillas de freno traseras (con freno de mano integrado)',
    category: 'Frenos',
    estimated_hours: 1.2,
    price: 35000,
    notes: 'Retracción de pistones traseros y calibración de freno de estacionamiento.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-07',
    name: 'Cambio de amortiguadores delanteros (par)',
    category: 'Suspensión y Dirección',
    estimated_hours: 2.5,
    price: 72000,
    notes: 'Desarme de espirales McPherson, cambio de cazoletas y fuelles guardapolvo.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-08',
    name: 'Cambio de amortiguadores traseros (par)',
    category: 'Suspensión y Dirección',
    estimated_hours: 1.2,
    price: 36000,
    notes: 'Reemplazo de bujes de fijación superior e inferior y torquedado en carga.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-09',
    name: 'Tren delantero completo (extremos de dirección, rótulas y bujes)',
    category: 'Suspensión y Dirección',
    estimated_hours: 3.5,
    price: 98000,
    notes: 'Reemplazo de brazos de suspensión, bieletas de barra estabilizadora y alineación previa.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-10',
    name: 'Cambio de cubiertas, alineación computarizada y balanceo (4 ruedas)',
    category: 'Neumáticos y Alineación',
    estimated_hours: 1.2,
    price: 38000,
    notes: 'Desarme, montaje de neumáticos nuevos, cambio de válvulas y plomos de balanceo.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-11',
    name: 'Rotación y balanceo de 4 neumáticos',
    category: 'Neumáticos y Alineación',
    estimated_hours: 0.8,
    price: 26000,
    notes: 'Rotación en X o cruzada según tracción y calibración de presiones.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-12',
    name: 'Cambio de kit de distribución completo (correa y tensores)',
    category: 'Service y Motor',
    estimated_hours: 3.8,
    price: 115000,
    notes: 'Puesta a punto de distribución, cambio de rodillos tensores y guía.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-13',
    name: 'Cambio de correa poly-v / accesorios y tensores auxiliares',
    category: 'Service y Motor',
    estimated_hours: 1.0,
    price: 32000,
    notes: 'Desarme de frente, control de polea de alternador (clutch) y polea de cigüeñal.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-14',
    name: 'Cambio de embrague completo (bajar caja de velocidades)',
    category: 'Transmisión y Embrague',
    estimated_hours: 6.0,
    price: 185000,
    notes: 'Placa, disco, crapodina hidráulica / actuador y centrado de volante bimasa.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-15',
    name: 'Reemplazo de bomba de agua y purga de líquido refrigerante',
    category: 'Service y Motor',
    estimated_hours: 2.2,
    price: 65000,
    notes: 'Limpieza de alojamiento, colocación de junta y llenado con líquido orgánico al 50%.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-16',
    name: 'Cambio de batería y control de circuito de carga / alternador',
    category: 'Electricidad e Iluminación',
    estimated_hours: 0.5,
    price: 16000,
    notes: 'Limpieza y engrase de bornes, testeo de voltaje con consumo encendido.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-17',
    name: 'Reparación de iluminación y luces reglamentarias (faro, ópticas, fichas)',
    category: 'Electricidad e Iluminación',
    estimated_hours: 1.0,
    price: 28000,
    notes: 'Revisión de cableado, fusibles y reemplazo de lámparas o plaquetas LED.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-18',
    name: 'Diagnóstico computarizado / Escaneo OBDII de fallas y reseteo de service',
    category: 'Revisión y Diagnóstico',
    estimated_hours: 0.8,
    price: 25000,
    notes: 'Lectura de parámetros en vivo, borrado de códigos DTC y programación de intervalos.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-19',
    name: 'Carga de gas refrigerante R134a y prueba de fugas de A/A',
    category: 'Aire Acondicionado y Calefacción',
    estimated_hours: 1.2,
    price: 45000,
    notes: 'Vacío del circuito, agregado de aceite PAG con detector UV y recarga por peso.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
  {
    id: 'lr-20',
    name: 'Revisión preventiva general de seguridad (50 puntos de control para viaje)',
    category: 'Revisión y Diagnóstico',
    estimated_hours: 1.5,
    price: 40000,
    notes: 'Inspección de tren rodante, luces, frenos, fluidos, cubiertas y matafuegos/balizas.',
    active: true,
    updated_at: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  },
];

function getStoredRates(): LaborRate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RATES);
    if (raw) {
      const parsed = JSON.parse(raw) as LaborRate[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.error('Error leyendo labor rates de localStorage', err);
  }
  return DEFAULT_LABOR_RATES;
}

function saveStoredRates(rates: LaborRate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_RATES, JSON.stringify(rates));
  } catch (err) {
    console.error('Error guardando labor rates en localStorage', err);
  }
}

function getStoredSettings(): LaborSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (raw) {
      const parsed = JSON.parse(raw) as LaborSettings;
      if (parsed && typeof parsed.hourly_rate === 'number') return parsed;
    }
  } catch (err) {
    console.error('Error leyendo labor settings de localStorage', err);
  }
  return {
    hourly_rate: DEFAULT_HOURLY_RATE,
    last_updated: new Date().toISOString(),
    updated_by_name: 'Sistema RV Group',
  };
}

function saveStoredSettings(settings: LaborSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
  } catch (err) {
    console.error('Error guardando labor settings en localStorage', err);
  }
}

/** Hook para obtener la lista de tarifas de mano de obra */
export function useLaborRates() {
  return useQuery({
    queryKey: ['labor-rates'],
    queryFn: async (): Promise<LaborRate[]> => {
      // Intentar consultar Supabase si la tabla existe
      try {
        const { data, error } = await supabase
          .from('labor_rates')
          .select('*')
          .order('category')
          .order('name');
        if (!error && Array.isArray(data) && data.length > 0) {
          saveStoredRates(data as LaborRate[]);
          return data as LaborRate[];
        }
      } catch {
        // Fallback transparente a storage local
      }
      return getStoredRates();
    },
    staleTime: 60_000,
  });
}

/** Hook para obtener la configuración horaria base del taller */
export function useLaborSettings() {
  return useQuery({
    queryKey: ['labor-settings'],
    queryFn: async (): Promise<LaborSettings> => {
      try {
        const { data, error } = await supabase
          .from('labor_settings')
          .select('*')
          .limit(1)
          .maybeSingle();
        if (!error && data) {
          const s = data as LaborSettings;
          saveStoredSettings(s);
          return s;
        }
      } catch {
        // Fallback transparente
      }
      return getStoredSettings();
    },
    staleTime: 60_000,
  });
}

/** Guardar o actualizar una tarifa de mano de obra */
export function useSaveLaborRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rate: Partial<LaborRate> & { id?: string; name: string; price: number }) => {
      const currentRates = getStoredRates();
      const now = new Date().toISOString();

      let updatedRate: LaborRate;
      if (rate.id) {
        const idx = currentRates.findIndex((r) => r.id === rate.id);
        updatedRate = {
          ...currentRates[idx],
          ...rate,
          id: rate.id,
          updated_at: now,
        } as LaborRate;
        if (idx >= 0) {
          currentRates[idx] = updatedRate;
        } else {
          currentRates.push(updatedRate);
        }
      } else {
        const newId = `lr-${Date.now()}`;
        updatedRate = {
          id: newId,
          name: rate.name,
          category: rate.category || 'General',
          estimated_hours: rate.estimated_hours || 1.0,
          price: rate.price,
          notes: rate.notes || null,
          active: rate.active ?? true,
          created_at: now,
          updated_at: now,
          updated_by_name: rate.updated_by_name || null,
        };
        currentRates.unshift(updatedRate);
      }

      saveStoredRates(currentRates);

      // Intentar sincronizar con Supabase silenciosamente
      try {
        await supabase.from('labor_rates').upsert(updatedRate);
      } catch {
        // Si no existe la tabla aún, continúa sin error
      }

      return updatedRate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labor-rates'] });
    },
  });
}

/** Eliminar una tarifa de mano de obra */
export function useDeleteLaborRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const currentRates = getStoredRates().filter((r) => r.id !== id);
      saveStoredRates(currentRates);
      try {
        await supabase.from('labor_rates').delete().eq('id', id);
      } catch {
        // Ignore
      }
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labor-rates'] });
    },
  });
}

/** Aumento porcentual masivo (Ajuste por inflación) */
export function useApplyPercentageIncrease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      percentage,
      category,
      roundTo = 500,
      userName,
    }: {
      percentage: number; // Ej: 15 para +15%
      category?: string; // Opcional, si se aplica solo a una categoría
      roundTo?: number; // Redondear a múltiplos de 100, 500 o 1000
      userName?: string;
    }) => {
      if (percentage <= -100) throw new Error('El porcentaje no puede ser menor a -100%');
      const multiplier = 1 + percentage / 100;
      const currentRates = getStoredRates();
      const now = new Date().toISOString();

      let affectedCount = 0;
      const updatedRates = currentRates.map((item) => {
        if (category && item.category !== category) return item;

        let newPrice = item.price * multiplier;
        if (roundTo > 0) {
          newPrice = Math.round(newPrice / roundTo) * roundTo;
        } else {
          newPrice = Math.round(newPrice);
        }

        affectedCount++;
        return {
          ...item,
          price: Math.max(0, newPrice),
          updated_at: now,
          updated_by_name: userName || item.updated_by_name,
        };
      });

      saveStoredRates(updatedRates);

      // Sincronizar en lote si Supabase está disponible
      try {
        await supabase.from('labor_rates').upsert(updatedRates);
      } catch {
        // Fallback
      }

      return { count: affectedCount, percentage };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labor-rates'] });
    },
  });
}

/** Actualizar el valor hora del taller */
export function useUpdateHourlyRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      hourlyRate,
      recalculatePrices = false,
      userName,
    }: {
      hourlyRate: number;
      recalculatePrices?: boolean;
      userName?: string;
    }) => {
      const now = new Date().toISOString();
      const settings: LaborSettings = {
        hourly_rate: hourlyRate,
        last_updated: now,
        updated_by_name: userName || 'Coordinación',
      };

      saveStoredSettings(settings);

      try {
        await supabase.from('labor_settings').upsert({ id: 1, ...settings });
      } catch {
        // Fallback
      }

      if (recalculatePrices) {
        const currentRates = getStoredRates();
        const updated = currentRates.map((r) => ({
          ...r,
          price: Math.round(r.estimated_hours * hourlyRate),
          updated_at: now,
          updated_by_name: userName,
        }));
        saveStoredRates(updated);
        try {
          await supabase.from('labor_rates').upsert(updated);
        } catch {
          // Ignore
        }
      }

      return settings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labor-settings'] });
      qc.invalidateQueries({ queryKey: ['labor-rates'] });
    },
  });
}
