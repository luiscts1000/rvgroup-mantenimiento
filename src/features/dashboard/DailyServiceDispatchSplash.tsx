import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  ShieldAlert,
  Truck,
  Wrench,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber } from '@/lib/utils';
import { useVehicles } from '@/features/vehicles/api';
import { getRtoStatus } from '@/features/preventive/api';
import type { Vehicle } from '@/types/db';

interface DailyServiceDispatchSplashProps {
  onContinue: () => void;
}

export function DailyServiceDispatchSplash({ onContinue }: DailyServiceDispatchSplashProps) {
  const navigate = useNavigate();
  const { data: vehicles = [] } = useVehicles();

  const report = useMemo(() => {
    const overdueKm: Array<{ v: Vehicle; kmDiff: number }> = [];
    const dueSoonKm: Array<{ v: Vehicle; kmDiff: number }> = [];
    const expiredRto: Array<{ v: Vehicle; daysDiff: number | null }> = [];
    const dueSoonRto: Array<{ v: Vehicle; daysDiff: number | null }> = [];
    let okCount = 0;

    for (const v of vehicles) {
      if (v.status === 'baja') continue;

      let hasIssue = false;

      // Evaluar Service por Kilometraje
      if (v.km_actual != null && v.next_service_km != null) {
        const diff = v.next_service_km - v.km_actual;
        if (diff < 0) {
          overdueKm.push({ v, kmDiff: Math.abs(diff) });
          hasIssue = true;
        } else if (diff <= 1500) {
          dueSoonKm.push({ v, kmDiff: diff });
          hasIssue = true;
        }
      }

      // Evaluar RTO
      if (v.rto_due_date) {
        const rto = getRtoStatus(v.rto_due_date);
        if (rto.code === 'vencida') {
          expiredRto.push({ v, daysDiff: rto.daysDiff });
          hasIssue = true;
        } else if (rto.code === 'proxima') {
          dueSoonRto.push({ v, daysDiff: rto.daysDiff });
          hasIssue = true;
        }
      }

      if (!hasIssue && v.status === 'operativo') {
        okCount++;
      }
    }

    // Unidades críticas combinadas (vencidas por km o por RTO)
    const criticalMap = new Map<string, { v: Vehicle; reasons: string[]; isCritical: boolean }>();

    for (const item of overdueKm) {
      const entry = criticalMap.get(item.v.id) || { v: item.v, reasons: [], isCritical: true };
      entry.reasons.push(`Service EXCEDIDO por ${formatNumber(item.kmDiff)} km (Odómetro: ${formatNumber(item.v.km_actual || 0)} km)`);
      entry.isCritical = true;
      criticalMap.set(item.v.id, entry);
    }

    for (const item of expiredRto) {
      const entry = criticalMap.get(item.v.id) || { v: item.v, reasons: [], isCritical: true };
      entry.reasons.push(`RTO VENCIDA el ${formatDate(item.v.rto_due_date || '')} (${Math.abs(item.daysDiff || 0)} días)`);
      entry.isCritical = true;
      criticalMap.set(item.v.id, entry);
    }

    for (const item of dueSoonKm) {
      if (!criticalMap.has(item.v.id)) {
        criticalMap.set(item.v.id, {
          v: item.v,
          reasons: [`Próximo service a ${formatNumber(item.kmDiff)} km`],
          isCritical: false,
        });
      } else {
        criticalMap.get(item.v.id)!.reasons.push(`Próximo service a ${formatNumber(item.kmDiff)} km`);
      }
    }

    for (const item of dueSoonRto) {
      if (!criticalMap.has(item.v.id)) {
        criticalMap.set(item.v.id, {
          v: item.v,
          reasons: [`RTO por vencer el ${formatDate(item.v.rto_due_date || '')} (en ${item.daysDiff} días)`],
          isCritical: false,
        });
      } else {
        criticalMap.get(item.v.id)!.reasons.push(`RTO por vencer el ${formatDate(item.v.rto_due_date || '')} (en ${item.daysDiff} días)`);
      }
    }

    const attentionList = Array.from(criticalMap.values()).sort((a, b) => {
      if (a.isCritical && !b.isCritical) return -1;
      if (!a.isCritical && b.isCritical) return 1;
      return a.v.patente.localeCompare(b.v.patente);
    });

    return {
      overdueKmCount: overdueKm.length,
      dueSoonKmCount: dueSoonKm.length,
      expiredRtoCount: expiredRto.length,
      dueSoonRtoCount: dueSoonRto.length,
      okCount,
      attentionList,
      totalAttention: attentionList.length,
    };
  }, [vehicles]);

  const todayStr = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  return (
    <div className="relative min-h-[85vh] rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50 via-white to-slate-100 p-6 shadow-xl dark:border-slate-800 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 sm:p-8">
      {/* Cabecera de Guardia Operativa */}
      <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-6 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-lg shadow-brand-700/25 dark:bg-brand-600">
            <Truck className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-brand-100 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-brand-800 dark:bg-brand-950 dark:text-brand-300">
                Guardia Matutina
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Calendar className="h-3.5 w-3.5" />
                <span className="capitalize">{todayStr}</span>
              </span>
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
              Control de Servicios y Despacho de Flota
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
              Primer pantallazo de unidades que requieren service o atención antes de iniciar tareas
            </p>
          </div>
        </div>

        {/* Botón superior de continuar */}
        <Button
          variant="primary"
          onClick={onContinue}
          className="h-10 gap-2 self-start px-5 font-semibold shadow-md sm:self-auto"
        >
          <span>Continuar al sistema</span>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Semáforo de Estado en 3 Bloques */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Tarjeta 1: Vencidas / Excedidas */}
        <div className="rounded-xl border border-red-200 bg-red-50/70 p-4 shadow-sm dark:border-red-900/60 dark:bg-red-950/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-red-700 dark:text-red-400">
              Vencidos / Excedidos
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300">
              <ShieldAlert className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-extrabold text-red-700 dark:text-red-300">
              {report.overdueKmCount + report.expiredRtoCount}
            </span>
            <span className="text-xs font-medium text-red-600/90 dark:text-red-400">
              unidades urgentes
            </span>
          </div>
          <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
            {report.overdueKmCount} por kilometraje · {report.expiredRtoCount} con RTO vencida
          </p>
        </div>

        {/* Tarjeta 2: Próximos a Service */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              Próximos a Service (≤ 1.500 km)
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
              <Clock className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-extrabold text-amber-700 dark:text-amber-300">
              {report.dueSoonKmCount + report.dueSoonRtoCount}
            </span>
            <span className="text-xs font-medium text-amber-600/90 dark:text-amber-400">
              a coordinar turno
            </span>
          </div>
          <p className="mt-1 text-xs text-amber-600/80 dark:text-amber-400/80">
            {report.dueSoonKmCount} próximos por km · {report.dueSoonRtoCount} por RTO
          </p>
        </div>

        {/* Tarjeta 3: Unidades al Día */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Operativos al Día
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-extrabold text-emerald-700 dark:text-emerald-300">
              {report.okCount}
            </span>
            <span className="text-xs font-medium text-emerald-600/90 dark:text-emerald-400">
              unidades en regla
            </span>
          </div>
          <p className="mt-1 text-xs text-emerald-600/80 dark:text-emerald-400/80">
            Services vigentes y documentación al día
          </p>
        </div>
      </div>

      {/* Lista de Unidades a Atender */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Wrench className="h-4.5 w-4.5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">
              Detalle de Unidades que requieren Service o Verificación ({report.totalAttention})
            </h2>
          </div>
          <span className="text-xs text-slate-400">
            Ordenado por prioridad
          </span>
        </div>

        {report.attentionList.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              ¡Toda la flota se encuentra al día!
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
              No hay unidades excedidas de service ni con RTO vencida. Podés continuar al panel general para operar normalmente.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {report.attentionList.map(({ v, reasons, isCritical }) => (
              <div
                key={v.id}
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-bold ${
                      isCritical
                        ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {isCritical ? <ShieldAlert className="h-4.5 w-4.5" /> : <Clock className="h-4.5 w-4.5" />}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-bold text-slate-900 dark:text-white">
                        {formatPatente(v.patente)}
                      </span>
                      {v.nro_interno && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          Int. {v.nro_interno}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">
                        · {[v.marca, v.modelo].filter(Boolean).join(' ')}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          isCritical
                            ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {isCritical ? 'Atención Inmediata' : 'Próximo a Service'}
                      </span>
                    </div>

                    <ul className="mt-1.5 space-y-0.5">
                      {reasons.map((r, rIdx) => (
                        <li key={rIdx} className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              isCritical ? 'bg-red-500' : 'bg-amber-500'
                            }`}
                          />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-100 pt-2 sm:border-0 sm:pt-0">
                  <div className="text-right">
                    <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">
                      {v.km_actual != null ? `${formatNumber(v.km_actual)} km` : 'Sin odómetro'}
                    </div>
                    {v.next_service_km != null && (
                      <div className="font-mono text-[11px] text-slate-500">
                        Prog: {formatNumber(v.next_service_km)} km
                      </div>
                    )}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      onContinue();
                      navigate(`/unidades/${v.id}`);
                    }}
                    className="text-xs"
                  >
                    Ver ficha
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pie de acción destacado con Botón Continuar */}
      <div className="mt-8 flex flex-col items-center justify-center gap-3 border-t border-slate-200/80 pt-6 text-center dark:border-slate-800">
        <Button
          variant="primary"
          onClick={onContinue}
          className="h-12 w-full max-w-md gap-3 text-base font-bold shadow-lg shadow-brand-700/20 sm:w-auto sm:px-10"
        >
          <span>Continuar al Menú Principal</span>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <p className="text-xs text-slate-500">
          Podrás reabrir este pantallazo en cualquier momento desde el botón de la barra superior.
        </p>
      </div>
    </div>
  );
}
