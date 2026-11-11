import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarClock,
  MessageCircle,
  Package,
  ShieldAlert,
  Wrench,
  CheckCircle2,
} from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber } from '@/lib/utils';
import { useVehicles } from '@/features/vehicles/api';
import { useParts } from '@/features/inventory/api';
import { usePendingTasks } from '@/features/pending/api';

interface AlertsCenterModalProps {
  open: boolean;
  onClose: () => void;
}

export function AlertsCenterModal({ open, onClose }: AlertsCenterModalProps) {
  const navigate = useNavigate();
  const { data: vehicles = [] } = useVehicles();
  const { data: parts = [] } = useParts();
  const { data: pendings = [] } = usePendingTasks();

  const alerts = useMemo(() => {
    // 1. RTO Alerts
    const rtoExpired: Array<{ id: string; patente: string; nro_interno: string | null; date: string; days: number }> = [];
    const rtoDueSoon: Array<{ id: string; patente: string; nro_interno: string | null; date: string; days: number }> = [];

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const v of vehicles) {
      if (v.status === 'baja' || !v.rto_due_date) continue;
      const d = new Date(v.rto_due_date + 'T00:00:00');
      const diffDays = Math.round((d.getTime() - now.getTime()) / 86400000);
      if (diffDays < 0) {
        rtoExpired.push({ id: v.id, patente: v.patente, nro_interno: v.nro_interno, date: v.rto_due_date, days: diffDays });
      } else if (diffDays <= 30) {
        rtoDueSoon.push({ id: v.id, patente: v.patente, nro_interno: v.nro_interno, date: v.rto_due_date, days: diffDays });
      }
    }

    // 2. Service KM Alerts
    const serviceOverdue: Array<{ id: string; patente: string; nro_interno: string | null; kmActual: number; proximoKm: number; diff: number }> = [];
    const serviceDueSoon: Array<{ id: string; patente: string; nro_interno: string | null; kmActual: number; proximoKm: number; diff: number }> = [];

    for (const v of vehicles) {
      if (v.status === 'baja' || v.km_actual == null || v.next_service_km == null) continue;
      const diff = v.next_service_km - v.km_actual;
      if (diff < 0) {
        serviceOverdue.push({ id: v.id, patente: v.patente, nro_interno: v.nro_interno, kmActual: v.km_actual, proximoKm: v.next_service_km, diff });
      } else if (diff <= 1500) {
        serviceDueSoon.push({ id: v.id, patente: v.patente, nro_interno: v.nro_interno, kmActual: v.km_actual, proximoKm: v.next_service_km, diff });
      }
    }

    // 3. Low Stock Parts
    const lowStockParts = parts.filter((p) => p.active && Number(p.quantity) <= Number(p.min_stock));

    // 4. Urgent Pendings
    const urgentPendings = pendings.filter(
      (p) => p.status !== 'reparado' && p.status !== 'cerrado' && (p.priority === 'urgente' || p.priority === 'alta'),
    );

    const totalCount =
      rtoExpired.length +
      rtoDueSoon.length +
      serviceOverdue.length +
      serviceDueSoon.length +
      lowStockParts.length +
      urgentPendings.length;

    return {
      rtoExpired,
      rtoDueSoon,
      serviceOverdue,
      serviceDueSoon,
      lowStockParts,
      urgentPendings,
      totalCount,
    };
  }, [vehicles, parts, pendings]);

  const handleShareWhatsApp = () => {
    let msg = `⚠️ *RESUMEN DE ALERTAS OPERATIVAS · RV GROUP SRL*\n`;
    msg += `📅 *Fecha:* ${new Date().toLocaleDateString('es-AR')}\n\n`;

    if (alerts.rtoExpired.length > 0) {
      msg += `🚨 *RTO VENCIDAS (${alerts.rtoExpired.length}):*\n`;
      alerts.rtoExpired.forEach((r) => {
        msg += `• ${formatPatente(r.patente)} ${r.nro_interno ? `(Int. ${r.nro_interno})` : ''} — Venció el ${formatDate(r.date)} (${Math.abs(r.days)} d)\n`;
      });
      msg += `\n`;
    }

    if (alerts.rtoDueSoon.length > 0) {
      msg += `⏳ *RTO PRÓXIMAS A VENCER (${alerts.rtoDueSoon.length}):*\n`;
      alerts.rtoDueSoon.forEach((r) => {
        msg += `• ${formatPatente(r.patente)} ${r.nro_interno ? `(Int. ${r.nro_interno})` : ''} — Vence: ${formatDate(r.date)} (en ${r.days} d)\n`;
      });
      msg += `\n`;
    }

    if (alerts.serviceOverdue.length > 0) {
      msg += `🛑 *SERVICES EXCEDIDOS POR KM (${alerts.serviceOverdue.length}):*\n`;
      alerts.serviceOverdue.forEach((s) => {
        msg += `• ${formatPatente(s.patente)} ${s.nro_interno ? `(Int. ${s.nro_interno})` : ''} — Pasado por ${formatNumber(Math.abs(s.diff))} km (Actual: ${formatNumber(s.kmActual)} km)\n`;
      });
      msg += `\n`;
    }

    if (alerts.serviceDueSoon.length > 0) {
      msg += `🔧 *SERVICES PRÓXIMOS ≤ 1.500 KM (${alerts.serviceDueSoon.length}):*\n`;
      alerts.serviceDueSoon.forEach((s) => {
        msg += `• ${formatPatente(s.patente)} ${s.nro_interno ? `(Int. ${s.nro_interno})` : ''} — Faltan ${formatNumber(s.diff)} km para service\n`;
      });
      msg += `\n`;
    }

    if (alerts.lowStockParts.length > 0) {
      msg += `📦 *REPUESTOS EN STOCK MÍNIMO (${alerts.lowStockParts.length}):*\n`;
      alerts.lowStockParts.slice(0, 8).forEach((p) => {
        const code = p.internal_code || p.original_code;
        msg += `• ${code ? `[${code}] ` : ''}${p.description} — Stock: ${p.quantity} (Mín: ${p.min_stock} ${p.unit})\n`;
      });
      msg += `\n`;
    }

    if (alerts.urgentPendings.length > 0) {
      msg += `⚡ *PENDIENTES URGENTES (${alerts.urgentPendings.length}):*\n`;
      alerts.urgentPendings.slice(0, 6).forEach((p) => {
        msg += `• ${formatPatente(p.patente)}: ${p.task_title}\n`;
      });
      msg += `\n`;
    }

    msg += `_Enviado desde Plataforma de Mantenimiento RV Group SRL_`;

    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-amber-500" />
          <span>Centro de Alertas y Vencimientos ({alerts.totalCount})</span>
        </div>
      }
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button
            size="sm"
            variant="success"
            icon={<MessageCircle className="h-4 w-4" />}
            onClick={handleShareWhatsApp}
          >
            Enviar resumen por WhatsApp
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {alerts.totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <p className="mt-2 font-semibold text-slate-800 dark:text-slate-100">
              ¡Flota e inventario al día!
            </p>
            <p className="text-xs text-slate-500">
              No hay RTO vencidas, services excedidos ni repuestos por debajo del stock mínimo.
            </p>
          </div>
        ) : (
          <>
            {/* RTO Vencidas */}
            {alerts.rtoExpired.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50/70 p-3.5 dark:border-red-900/60 dark:bg-red-950/40">
                <div className="flex items-center gap-2 font-semibold text-red-800 dark:text-red-300">
                  <ShieldAlert className="h-4 w-4" />
                  <span>RTO Vencidas ({alerts.rtoExpired.length} unidades)</span>
                </div>
                <div className="mt-2 divide-y divide-red-200/60 dark:divide-red-900/40">
                  {alerts.rtoExpired.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => {
                        onClose();
                        navigate(`/unidades/${r.id}`);
                      }}
                      className="flex cursor-pointer items-center justify-between py-1.5 text-xs hover:text-red-900 dark:hover:text-red-200"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-red-900 dark:text-red-200">{formatPatente(r.patente)}</span>
                        {r.nro_interno && <span className="text-red-700 dark:text-red-300">Int. {r.nro_interno}</span>}
                      </div>
                      <span className="font-medium text-red-700 dark:text-red-300">
                        Venció el {formatDate(r.date)} ({Math.abs(r.days)} días)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RTO Por Vencer */}
            {alerts.rtoDueSoon.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/40">
                <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                  <CalendarClock className="h-4 w-4" />
                  <span>RTO Próximas a Vencer ≤ 30 días ({alerts.rtoDueSoon.length} unidades)</span>
                </div>
                <div className="mt-2 divide-y divide-amber-200/60 dark:divide-amber-900/40">
                  {alerts.rtoDueSoon.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => {
                        onClose();
                        navigate(`/unidades/${r.id}`);
                      }}
                      className="flex cursor-pointer items-center justify-between py-1.5 text-xs hover:text-amber-900 dark:hover:text-amber-200"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-amber-900 dark:text-amber-200">{formatPatente(r.patente)}</span>
                        {r.nro_interno && <span className="text-amber-700 dark:text-amber-300">Int. {r.nro_interno}</span>}
                      </div>
                      <span className="font-medium text-amber-700 dark:text-amber-300">
                        Vence: {formatDate(r.date)} (en {r.days} días)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Services Excedidos por Km */}
            {alerts.serviceOverdue.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50/70 p-3.5 dark:border-red-900/60 dark:bg-red-950/40">
                <div className="flex items-center gap-2 font-semibold text-red-800 dark:text-red-300">
                  <Wrench className="h-4 w-4" />
                  <span>Services Excedidos por Km ({alerts.serviceOverdue.length} unidades)</span>
                </div>
                <div className="mt-2 divide-y divide-red-200/60 dark:divide-red-900/40">
                  {alerts.serviceOverdue.map((s) => (
                    <div
                      key={s.id}
                      onClick={() => {
                        onClose();
                        navigate(`/unidades/${s.id}`);
                      }}
                      className="flex cursor-pointer items-center justify-between py-1.5 text-xs hover:text-red-900 dark:hover:text-red-200"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-red-900 dark:text-red-200">{formatPatente(s.patente)}</span>
                        {s.nro_interno && <span className="text-red-700 dark:text-red-300">Int. {s.nro_interno}</span>}
                      </div>
                      <span className="font-medium text-red-700 dark:text-red-300">
                        Excedido por {formatNumber(Math.abs(s.diff))} km (Actual: {formatNumber(s.kmActual)} km)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Repuestos en Stock Mínimo */}
            {alerts.lowStockParts.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/40">
                <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
                  <Package className="h-4 w-4" />
                  <span>Repuestos con Stock Crítico / Mínimo ({alerts.lowStockParts.length})</span>
                </div>
                <div className="mt-2 divide-y divide-amber-200/60 dark:divide-amber-900/40">
                  {alerts.lowStockParts.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => {
                        onClose();
                        navigate('/inventario');
                      }}
                      className="flex cursor-pointer items-center justify-between py-1.5 text-xs hover:text-amber-900 dark:hover:text-amber-200"
                    >
                      <div>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{p.description}</span>
                        {(p.internal_code || p.original_code) && (
                          <span className="ml-1 font-mono text-[11px] text-slate-500">
                            [{p.internal_code || p.original_code}]
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-amber-800 dark:text-amber-300">
                        Stock: {p.quantity} (Mín: {p.min_stock} {p.unit})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
