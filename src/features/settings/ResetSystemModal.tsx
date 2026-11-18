import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button, Modal, Field } from '@/components/ui';
import { resetSystemTestData } from './resetSystem';

interface ResetSystemModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ResetSystemModal({ open, onClose, onSuccess }: ResetSystemModalProps) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');

  // Opciones de vaciado
  const [deleteVehicles, setDeleteVehicles] = useState(false);
  const [deleteParts, setDeleteParts] = useState(false);
  const [deleteOperationalHistory, setDeleteOperationalHistory] = useState(true);

  const canConfirm = confirmWord.trim().toUpperCase() === 'REINICIAR';

  const handleReset = async () => {
    if (!canConfirm) {
      toast.error('Debe escribir la palabra REINICIAR para confirmar');
      return;
    }

    setLoading(true);
    try {
      const res = await resetSystemTestData({
        deleteWorkOrders: true,
        deleteOperationalHistory,
        deleteVehicles,
        deleteParts,
      });

      await qc.invalidateQueries();

      const summaryParts: string[] = [];
      if (res.deletedWorkOrders > 0) summaryParts.push(`${res.deletedWorkOrders} órdenes de trabajo`);
      if (res.deletedVehicles > 0) summaryParts.push(`${res.deletedVehicles} unidades`);
      if (res.deletedParts > 0) summaryParts.push(`${res.deletedParts} repuestos`);
      if (res.deletedPending > 0) summaryParts.push(`${res.deletedPending} pendientes`);
      if (res.deletedAppointments > 0) summaryParts.push(`${res.deletedAppointments} turnos`);
      if (res.deletedInspections > 0) summaryParts.push(`${res.deletedInspections} inspecciones`);

      toast.success(
        summaryParts.length > 0
          ? `¡Sistema reiniciado con éxito! Se eliminaron: ${summaryParts.join(', ')}. El sistema está listo para operar en limpio.`
          : '¡Sistema reiniciado con éxito! No había datos pendientes. Listo para operar en limpio.',
        { duration: 6000 },
      );

      setConfirmWord('');
      onClose();
      if (onSuccess) onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al reiniciar los datos del sistema');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => !loading && onClose()}
      size="md"
      title="Limpiar Datos de Prueba y Comenzar de Cero"
    >
      <div className="space-y-4">
        {/* Banner de Advertencia */}
        <div className="flex items-start gap-3 rounded-2xl border-2 border-red-500/30 bg-red-50/80 p-4 text-red-950 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white shadow">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="text-xs">
            <h4 className="font-extrabold text-sm text-red-900 dark:text-red-100">
              Pase a Producción Oficial · RV GROUP SRL
            </h4>
            <p className="mt-1 leading-relaxed">
              Esta herramienta purga las pruebas, órdenes ficticias y movimientos generados durante el período de prueba para comenzar a registrar la operación real en limpio.
            </p>
          </div>
        </div>

        {/* Selección de datos a vaciar */}
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
          <span className="block text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
            ¿Qué datos desea vaciar?
          </span>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={true}
              disabled={true}
              className="mt-0.5 rounded border-slate-400 text-brand-600"
            />
            <span>
              <b>Órdenes de Reparación (OT), firmas y fotografías:</b> Se vacían todas las órdenes de prueba y el contador se reinicia a <code>OR-00001</code>.
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteOperationalHistory}
              onChange={(e) => setDeleteOperationalHistory(e.target.checked)}
              className="mt-0.5 rounded border-slate-400 text-brand-600"
            />
            <span>
              <b>Historial operativo de prueba:</b> Vaciar pendientes, turnos con talleres externos, inspecciones/checklists preventivos y movimientos de stock de prueba.
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteVehicles}
              onChange={(e) => setDeleteVehicles(e.target.checked)}
              className="mt-0.5 rounded border-slate-400 text-brand-600"
            />
            <span>
              <b>Eliminar también las Unidades / Vehículos cargados de prueba:</b> Marque esta opción solo si desea volver a cargar o reimportar las patentes reales desde cero.
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteParts}
              onChange={(e) => setDeleteParts(e.target.checked)}
              className="mt-0.5 rounded border-slate-400 text-brand-600"
            />
            <span>
              <b>Eliminar también los Repuestos cargados de prueba:</b> Si no lo marca, se conservan las fichas de repuestos y su stock queda en 0 para arrancar el inventario real.
            </span>
          </label>
        </div>

        {/* Lo que se conserva siempre */}
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50/70 p-3 text-xs text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          <div>
            <b>Se conservan siempre intactos:</b> Los usuarios, cuentas de correo, contraseñas, permisos, perfiles, categorías de unidades y el <b>Tarifario de Mano de Obra ($)</b>.
          </div>
        </div>

        {/* Confirmación obligatoria por palabra clave */}
        <Field
          label="Para autorizar esta acción, escriba la palabra REINICIAR en mayúsculas:"
          required
        >
          <div className="space-y-1.5">
            <input
              type="text"
              autoFocus
              className="input font-mono text-base font-black tracking-widest text-red-700 dark:text-red-400 placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400"
              placeholder="Escriba REINICIAR"
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
            />
            <span className="block text-[11px] text-slate-500">
              Esta confirmación garantiza que el borrado sea completamente intencional.
            </span>
          </div>
        </Field>

        {/* Botones de acción */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 pt-3 dark:border-slate-800">
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!canConfirm}
            loading={loading}
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={() => void handleReset()}
          >
            Vaciar datos de prueba y comenzar de cero
          </Button>
        </div>
      </div>
    </Modal>
  );
}
