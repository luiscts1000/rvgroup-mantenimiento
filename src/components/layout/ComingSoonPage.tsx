import { Lock, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import type { ModuleDef } from '@/lib/constants';

const STAGE_TITLES: Record<number, { name: string; items: string[] }> = {
  2: {
    name: 'ETAPA 2 – Órdenes de reparación',
    items: [
      'Generación de órdenes con número correlativo automático y recuperación automática de datos por patente',
      'Asignación de mecánicos y carga de trabajos desde celular',
      'Diagnósticos, reparaciones, repuestos, lubricantes y fotografías',
      'Flujo de estados (Abierta → Asignada → En proceso → Pendiente → Finalizada → Cerrada)',
      'Generación automática de PDF profesional con logo de RV Group',
    ],
  },
  3: {
    name: 'ETAPA 3 – Inventario y servicios predefinidos',
    items: [
      'Catálogo centralizado de repuestos, filtros, lubricantes y cubiertas con alertas de stock mínimo',
      'Configuración de servicios e insumos por modelo/categoría y por patente individual',
      'Propuesta automática de filtros y aceite al abrir una OR según la unidad',
      'Descuento automático de inventario sin duplicaciones y registro de movimientos',
    ],
  },
  4: {
    name: 'ETAPA 4 – Pendientes generales y turnos',
    items: [
      'Tablero central de trabajos pendientes con estados en colores y conservación en el historial',
      'Conversión de pendiente a orden de reparación vinculando ambos registros',
      'Gestión de turnos con proveedores externos, calendario y recordatorios',
      'Generación de mensajes de WhatsApp (sin confirmar automáticamente el turno)',
    ],
  },
  5: {
    name: 'ETAPA 5 – Mantenimiento preventivo y RTO',
    items: [
      'Control de vencimientos de RTO y documentación',
      'Inspección previa (parabrisas, cubiertas, frenos, suspensión, luces, seguridad)',
      'Generación directa de pendientes al detectar problemas en la inspección',
    ],
  },
  6: {
    name: 'ETAPA 6 – Historial, estadísticas y reportes',
    items: [
      'Ficha cronológica completa por patente (OR, servicios, fallas, pendientes, turnos, repuestos, costos, PDFs y fotos)',
      'Indicadores diferenciando fallas, intervenciones e ingresos al taller',
      'Exportaciones a Excel y sincronización con Google Sheets',
    ],
  },
};

export function ComingSoonPage({ mod }: { mod: ModuleDef }) {
  const info = STAGE_TITLES[mod.stage];
  const Icon = mod.icon;
  return (
    <div>
      <PageHeader title={mod.label} subtitle="Módulo planificado en el desarrollo por etapas" />
      <div className="card mx-auto max-w-2xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              <Lock className="h-3 w-3" /> Próxima etapa (Etapa {mod.stage})
            </span>
            <h2 className="mt-1 font-semibold">{info?.name}</h2>
          </div>
        </div>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Siguiendo el plan acordado, actualmente está habilitada la <b>Etapa 1 (Estructura, usuarios y unidades)</b>. Este módulo se
          implementará una vez probada y aprobada la etapa anterior:
        </p>
        {info && (
          <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
            {info.items.map((it) => (
              <li key={it}>• {it}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Se muestra cuando aún no se configuró el archivo .env.local con los datos de Supabase. */
export function SetupGuidePage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="card max-w-2xl space-y-4 p-6">
        <div className="flex items-center gap-3 text-amber-600">
          <AlertTriangle className="h-7 w-7 shrink-0" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">Falta conectar la base de datos en la nube (Supabase)</h1>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Para comenzar a usar el sistema, complete estos 4 pasos (detallados en <code>README.md</code>):
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-300">
          <li>
            Cree un proyecto gratuito en <b>supabase.com</b> (región recomendada: South America / São Paulo).
          </li>
          <li>
            En <b>SQL Editor</b> ejecute en orden los 3 archivos de <code>supabase/migrations/</code> (<code>0001</code>, <code>0002</code>{' '}
            y <code>0003</code>).
          </li>
          <li>
            En <b>Authentication → Users → Add user</b> cree su primer usuario (con <i>Auto Confirm User</i> activado). El primer usuario
            creado queda automáticamente como <b>Administrador</b>.
          </li>
          <li>
            Copie <code>.env.example</code> como <code>.env.local</code>, pegue <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> (desde <b>Project Settings → API</b>) y reinicie <code>npm.cmd run dev</code>.
          </li>
        </ol>
      </div>
    </div>
  );
}
