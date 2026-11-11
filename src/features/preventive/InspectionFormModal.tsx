import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react';
import { Button, Field, Modal } from '@/components/ui';
import { CHECK_ITEM_LABELS, RTO_CHECKLIST_ITEMS } from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCreateInspection } from './api';
import type { CheckItemState, Vehicle } from '@/types/db';

interface Props {
  open: boolean;
  onClose: () => void;
  vehicles: Vehicle[];
  defaultVehicleId?: string;
}

type ChecklistMap = Record<
  'windshield' | 'tires' | 'brakes' | 'suspension' | 'lights' | 'seatbelts' | 'safety_elements' | 'documentation',
  { state: CheckItemState; notes: string }
>;

function makeInitialChecklist(): ChecklistMap {
  return {
    windshield: { state: 'ok', notes: '' },
    tires: { state: 'ok', notes: '' },
    brakes: { state: 'ok', notes: '' },
    suspension: { state: 'ok', notes: '' },
    lights: { state: 'ok', notes: '' },
    seatbelts: { state: 'ok', notes: '' },
    safety_elements: { state: 'ok', notes: '' },
    documentation: { state: 'ok', notes: '' },
  };
}

export function InspectionFormModal({ open, onClose, vehicles, defaultVehicleId }: Props) {
  const { profile } = useAuth();
  const createMut = useCreateInspection();

  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? '');
  const [inspectedAt, setInspectedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [inspectorName, setInspectorName] = useState('');
  const [kilometraje, setKilometraje] = useState('');
  const [rtoDueDate, setRtoDueDate] = useState('');
  const [checklist, setChecklist] = useState<ChecklistMap>(makeInitialChecklist);
  const [observations, setObservations] = useState('');
  const [generatePending, setGeneratePending] = useState(true);

  useEffect(() => {
    if (!open) return;
    const vid = defaultVehicleId ?? '';
    setVehicleId(vid);
    setInspectedAt(new Date().toISOString().slice(0, 10));
    setInspectorName(profile?.full_name ?? '');
    setChecklist(makeInitialChecklist());
    setObservations('');
    setGeneratePending(true);

    const v = vehicles.find((x) => x.id === vid);
    setKilometraje(v?.km_actual != null ? String(v.km_actual) : '');
    setRtoDueDate(v?.rto_due_date ?? '');
  }, [open, defaultVehicleId, profile?.full_name, vehicles]);

  const handleVehicleChange = (newId: string) => {
    setVehicleId(newId);
    const v = vehicles.find((x) => x.id === newId);
    if (v) {
      setKilometraje(v.km_actual != null ? String(v.km_actual) : '');
      setRtoDueDate(v.rto_due_date ?? '');
    }
  };

  const problemItems = RTO_CHECKLIST_ITEMS.filter(
    (item) => checklist[item.key].state === 'reparar' || checklist[item.key].state === 'observacion',
  );
  const hasBlockingItems = RTO_CHECKLIST_ITEMS.some((item) => checklist[item.key].state === 'reparar');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!vehicleId) {
      toast.error('Seleccione una unidad');
      return;
    }

    try {
      const res = await createMut.mutateAsync({
        vehicle_id: vehicleId,
        inspected_at: inspectedAt,
        inspector_name: inspectorName.trim() || null,
        kilometraje: kilometraje ? Number(kilometraje) : null,
        rto_due_date: rtoDueDate || null,
        windshield_state: checklist.windshield.state,
        windshield_notes: checklist.windshield.notes.trim() || null,
        tires_state: checklist.tires.state,
        tires_notes: checklist.tires.notes.trim() || null,
        brakes_state: checklist.brakes.state,
        brakes_notes: checklist.brakes.notes.trim() || null,
        suspension_state: checklist.suspension.state,
        suspension_notes: checklist.suspension.notes.trim() || null,
        lights_state: checklist.lights.state,
        lights_notes: checklist.lights.notes.trim() || null,
        seatbelts_state: checklist.seatbelts.state,
        seatbelts_notes: checklist.seatbelts.notes.trim() || null,
        safety_elements_state: checklist.safety_elements.state,
        safety_elements_notes: checklist.safety_elements.notes.trim() || null,
        documentation_state: checklist.documentation.state,
        documentation_notes: checklist.documentation.notes.trim() || null,
        observations: observations.trim() || null,
        generate_pending: generatePending,
      });

      if (res.generated_pendings > 0) {
        toast.success(
          `Inspección registrada. Se generaron automáticamente ${res.generated_pendings} pendiente(s) en el tablero.`,
        );
      } else {
        toast.success('Inspección previa a RTO registrada correctamente.');
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar la inspección');
    }
  };

  const stateOptions: { value: CheckItemState; label: string; activeClass: string }[] = [
    {
      value: 'ok',
      label: 'OK',
      activeClass: 'border-emerald-600 bg-emerald-600 text-white',
    },
    {
      value: 'observacion',
      label: 'Observación',
      activeClass: 'border-amber-500 bg-amber-500 text-white',
    },
    {
      value: 'reparar',
      label: 'Reparar',
      activeClass: 'border-red-600 bg-red-600 text-white',
    },
    {
      value: 'no_aplica',
      label: 'N/A',
      activeClass: 'border-slate-500 bg-slate-500 text-white',
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Inspección previa a RTO y control general" size="xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Unidad *" className="sm:col-span-2">
            <select
              className="input"
              required
              value={vehicleId}
              onChange={(e) => handleVehicleChange(e.target.value)}
            >
              <option value="">— Seleccionar patente / interno —</option>
              {vehicles
                .filter((v) => v.status !== 'baja')
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatPatente(v.patente)}
                    {v.nro_interno ? ` · Int. ${v.nro_interno}` : ''} —{' '}
                    {[v.marca, v.modelo, v.version].filter(Boolean).join(' ')}
                  </option>
                ))}
            </select>
          </Field>

          <Field label="Fecha de inspección *">
            <input
              type="date"
              className="input"
              required
              value={inspectedAt}
              onChange={(e) => setInspectedAt(e.target.value)}
            />
          </Field>

          <Field label="Responsable del control">
            <input
              className="input"
              placeholder="Nombre del mecánico o inspector"
              value={inspectorName}
              onChange={(e) => setInspectorName(e.target.value)}
            />
          </Field>

          <Field label="Kilometraje actual">
            <input
              type="number"
              min={0}
              className="input"
              placeholder="Ej. 142500"
              value={kilometraje}
              onChange={(e) => setKilometraje(e.target.value)}
            />
          </Field>

          <Field label="Vencimiento de RTO (actual o nuevo)">
            <input
              type="date"
              className="input"
              value={rtoDueDate}
              onChange={(e) => setRtoDueDate(e.target.value)}
            />
          </Field>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Puntos de verificación previos a la RTO (8 rubros)</h3>
              <p className="text-xs text-slate-500">
                Marque el estado de cada punto. Si indica «Observación» o «Reparar», puede detallar el trabajo requerido.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setChecklist(makeInitialChecklist())}
            >
              Marcar todos OK
            </Button>
          </div>

          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {RTO_CHECKLIST_ITEMS.map((item) => {
              const entry = checklist[item.key];
              const needsNote = entry.state === 'reparar' || entry.state === 'observacion';
              return (
                <div key={item.key} className="p-3.5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{item.label}</p>
                      <p className="text-xs text-slate-500">{item.hint}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {stateOptions.map((opt) => {
                        const active = entry.state === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              setChecklist((prev) => ({
                                ...prev,
                                [item.key]: { ...prev[item.key], state: opt.value },
                              }))
                            }
                            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                              active
                                ? opt.activeClass
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {(needsNote || entry.notes) && (
                    <div className="mt-2.5">
                      <input
                        className="input text-xs"
                        placeholder={`Detalle para ${item.label.toLowerCase()} (${CHECK_ITEM_LABELS[entry.state]})...`}
                        value={entry.notes}
                        onChange={(e) =>
                          setChecklist((prev) => ({
                            ...prev,
                            [item.key]: { ...prev[item.key], notes: e.target.value },
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Resumen dinámico del diagnóstico pre-RTO */}
        <div
          className={`flex flex-col gap-2 rounded-xl border p-3.5 text-sm ${
            hasBlockingItems
              ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'
              : problemItems.length > 0
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'
                : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            {hasBlockingItems ? (
              <>
                <AlertTriangle className="h-4 w-4 shrink-0" />
                La unidad requiere trabajos antes de presentarse a RTO ({problemItems.length} novedad/es detectada/s)
              </>
            ) : problemItems.length > 0 ? (
              <>
                <ClipboardCheck className="h-4 w-4 shrink-0" />
                Apta con observaciones ({problemItems.length} punto/s a seguir)
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Unidad en condiciones para presentarse a RTO
              </>
            )}
          </div>

          {problemItems.length > 0 && (
            <label className="mt-1 flex cursor-pointer items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-700"
                checked={generatePending}
                onChange={(e) => setGeneratePending(e.target.checked)}
              />
              Generar automáticamente {problemItems.length} trabajo(s) en «Pendientes generales» para programar su resolución
            </label>
          )}
        </div>

        <Field label="Observaciones generales de la inspección">
          <textarea
            rows={2}
            className="input"
            placeholder="Notas adicionales del control preventivo o pre-RTO..."
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={createMut.isPending}>
            Guardar inspección
          </Button>
        </div>
      </form>
    </Modal>
  );
}
