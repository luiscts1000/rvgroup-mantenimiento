import { useState, useMemo, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ArrowUpRight, Truck, User } from 'lucide-react';
import { Button, Field, Modal } from '@/components/ui';
import { useVehicles } from '@/features/vehicles/api';
import { useParts, useRecordStockMovement } from './api';
import { formatPatente } from '@/lib/patente';
import { formatNumber } from '@/lib/utils';
import { friendlyError } from '@/lib/supabase';
import type { Part } from '@/types/db';

interface QuickDispatchModalProps {
  open: boolean;
  onClose: () => void;
  initialPart?: Part | null;
}

const QUICK_REASONS = [
  'Lámpara quemada',
  'Faja de amarre',
  'Red de carga',
  'Fusible / Relé',
  'Fluido / Aditivo',
  'Kit de seguridad',
  'Escobilla limpiaparabrisas',
  'Insumo de taller',
];

export function QuickDispatchModal({ open, onClose, initialPart }: QuickDispatchModalProps) {
  const { data: parts = [] } = useParts();
  const { data: vehicles = [] } = useVehicles();
  const move = useRecordStockMovement();

  const [selectedPartId, setSelectedPartId] = useState<string>('');
  const [qty, setQty] = useState('1');
  const [vehicleId, setVehicleId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [reason, setReason] = useState('');

  // Sincronizar parte inicial si se pasa por prop
  const currentPart = useMemo(() => {
    if (initialPart) return initialPart;
    return parts.find((p) => p.id === selectedPartId) || null;
  }, [initialPart, selectedPartId, parts]);

  // Filtrar repuestos activos con stock disponible
  const availableParts = useMemo(() => {
    return parts
      .filter((p) => p.active)
      .sort((a, b) => a.description.localeCompare(b.description));
  }, [parts]);

  // Lista de vehículos activos ordenados por patente
  const activeVehicles = useMemo(() => {
    return vehicles
      .filter((v) => v.status !== 'baja')
      .sort((a, b) => a.patente.localeCompare(b.patente));
  }, [vehicles]);

  const targetVehicle = useMemo(() => {
    return vehicles.find((v) => v.id === vehicleId) || null;
  }, [vehicleId, vehicles]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!currentPart) {
      return toast.error('Seleccione un repuesto o insumo');
    }

    const n = Number(qty.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      return toast.error('Ingrese una cantidad válida mayor a 0');
    }

    if (n > Number(currentPart.quantity)) {
      const confirmExceed = window.confirm(
        `Atención: La cantidad (${n}) supera el stock registrado (${currentPart.quantity} ${currentPart.unit}). ¿Desea registrar la entrega de todas formas?`,
      );
      if (!confirmExceed) return;
    }

    // Armar motivo compuesto y estructurado
    const vehicleText = targetVehicle
      ? `${formatPatente(targetVehicle.patente)}${targetVehicle.nro_interno ? ` (Int. ${targetVehicle.nro_interno})` : ''} - ${[targetVehicle.marca, targetVehicle.modelo].filter(Boolean).join(' ')}`
      : 'Uso general / Pañol';

    const partsDetail = [
      recipient.trim() ? `Entregado a: ${recipient.trim()}` : null,
      `Unidad: ${vehicleText}`,
      reason.trim() ? `Motivo: ${reason.trim()}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    try {
      const resultingQty = await move.mutateAsync({
        partId: currentPart.id,
        type: 'egreso_or',
        quantity: n,
        reason: partsDetail || 'Entrega directa de pañol',
      });

      toast.success(
        `Entrega registrada: -${n} ${currentPart.unit} de ${currentPart.description}. Stock restante: ${resultingQty} ${currentPart.unit}`,
      );
      handleClose();
    } catch (err) {
      toast.error(friendlyError(err));
    }
  }

  const handleClose = () => {
    setSelectedPartId('');
    setQty('1');
    setVehicleId('');
    setRecipient('');
    setReason('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      size="md"
      title="Salida rápida / Entrega de repuesto de pañol"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={move.isPending} className="gap-1.5 font-bold">
            <ArrowUpRight className="h-4 w-4" />
            <span>Registrar salida de stock</span>
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {/* Selector de repuesto */}
        {initialPart ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-slate-900 dark:text-white">
                {initialPart.internal_code}
              </span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Stock actual: <b>{formatNumber(Number(initialPart.quantity))} {initialPart.unit}</b>
              </span>
            </div>
            <p className="mt-1 font-medium text-slate-800 dark:text-slate-200">
              {initialPart.description}
            </p>
          </div>
        ) : (
          <Field label="Repuesto / Insumo que se entrega" required>
            <select
              className="input text-sm"
              value={selectedPartId}
              onChange={(e) => setSelectedPartId(e.target.value)}
              required
            >
              <option value="">-- Seleccionar repuesto del catálogo --</option>
              {availableParts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.internal_code} · {p.description} (Disp: {formatNumber(Number(p.quantity))} {p.unit})
                </option>
              ))}
            </select>
          </Field>
        )}

        {/* Fila de Cantidad y Stock Disponible */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label={`Cantidad a entregar ${currentPart ? `(${currentPart.unit})` : ''}`}
            required
          >
            <input
              type="text"
              inputMode="decimal"
              className="input font-mono text-base font-bold"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="1"
              required
            />
          </Field>

          {currentPart && (
            <div className="flex flex-col justify-center rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800/60">
              <span className="text-slate-500">Stock restante proyectado:</span>
              <span
                className={`font-mono text-sm font-bold ${
                  Number(currentPart.quantity) - (Number(qty.replace(',', '.')) || 0) < 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                {formatNumber(
                  Math.max(
                    0,
                    Number(currentPart.quantity) - (Number(qty.replace(',', '.')) || 0),
                  ),
                )}{' '}
                {currentPart.unit}
              </span>
            </div>
          )}
        </div>

        {/* Destino: Vehículo */}
        <Field label="Destino / Camioneta de la flota (opcional)">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
              <Truck className="h-4 w-4" />
            </span>
            <select
              className="input text-xs sm:text-sm"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              <option value="">-- Sin unidad asignada / Pañol general --</option>
              {activeVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {formatPatente(v.patente)} {v.nro_interno ? `(Int. ${v.nro_interno})` : ''} - {[v.marca, v.modelo].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </div>
        </Field>

        {/* Receptor: Chofer, Mecánico o Responsable */}
        <Field label="Entregado a / Chofer o Mecánico que retira">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
              <User className="h-4 w-4" />
            </span>
            <input
              type="text"
              className="input text-xs sm:text-sm"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Ej.: Chofer Carlos Pérez / Mecánico Juan Gómez"
            />
          </div>
        </Field>

        {/* Motivo o Detalle */}
        <Field label="Motivo de la entrega">
          <input
            type="text"
            className="input text-xs sm:text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: Reemplazo de lámpara de stop / Faja para amarre de carga"
          />
          {/* Sugerencias rápidas de clic directo */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => setReason(sug)}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 transition hover:bg-slate-200 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              >
                + {sug}
              </button>
            ))}
          </div>
        </Field>

        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
