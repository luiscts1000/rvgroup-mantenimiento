import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Pencil,
  FileDown,
  Camera,
  Trash2,
  CheckCircle2,
  Play,
  ShieldCheck,
  Plus,
  Wrench,
  Gauge,
  Clock,
  ClipboardCheck,
  Sparkles,
  Printer,
  PenTool,
} from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, Field, Spinner } from '@/components/ui';
import { SignaturePadModal } from '@/components/ui/SignaturePadModal';
import { useAuth } from '@/features/auth/AuthProvider';
import { useVehicle } from '@/features/vehicles/api';
import { useParts } from '@/features/inventory/api';
import { friendlyError, supabase } from '@/lib/supabase';
import {
  formatOrderNumber,
  PHOTO_STAGE_LABELS,
  WO_STATUS_LABELS,
} from '@/lib/constants';
import { formatPatente } from '@/lib/patente';
import { formatDate, formatNumber } from '@/lib/utils';
import type { WorkOrderPhoto, WorkOrderStatus } from '@/types/db';
import {
  useDeleteWorkOrderPhoto,
  useSaveWorkOrder,
  useUploadWorkOrderPhoto,
  useWorkOrder,
  useWorkOrderHistory,
  useWorkOrderItems,
  useWorkOrderPhotos,
  type ItemDraft,
} from './api';
import { WorkOrderFormModal } from './WorkOrderFormModal';
import { WorkOrderStatusBadge } from './WorkOrdersPage';
import {
  detectCompletionChecks,
  extractMechanicSignature,
  generateWorkOrderPdf,
  splitWorkLines,
} from './generateWorkOrderPdf';

type FinishCheckOption =
  | 'Reparado / Finalizado'
  | 'Reparado provisoriamente'
  | 'Pendiente de repuesto'
  | 'Pendiente de reparación'
  | 'Requiere revisión posterior';

const FINISH_OPTIONS: FinishCheckOption[] = [
  'Reparado / Finalizado',
  'Reparado provisoriamente',
  'Pendiente de repuesto',
  'Pendiente de reparación',
  'Requiere revisión posterior',
];

export function WorkOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, can } = useAuth();
  const { data: wo, isLoading, error } = useWorkOrder(id);
  const { data: vehicle } = useVehicle(wo?.vehicle_id);
  const { data: items = [] } = useWorkOrderItems(id);
  const { data: parts = [] } = useParts();
  const { data: photos = [], isLoading: photosLoading } = useWorkOrderPhotos(id);
  const { data: history = [] } = useWorkOrderHistory(id);

  const save = useSaveWorkOrder();
  const uploadPhoto = useUploadWorkOrderPhoto();
  const deletePhoto = useDeleteWorkOrderPhoto();

  const fileInput = useRef<HTMLInputElement>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [photoStage, setPhotoStage] = useState('reparacion');
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoToDelete, setPhotoToDelete] = useState<WorkOrderPhoto | null>(null);
  const [confirmApproveClose, setConfirmApproveClose] = useState(false);

  // Estado del panel rápido del Mecánico (Teléfono / Taller)
  const [showMechanicForm, setShowMechanicForm] = useState(false);
  const [kmInput, setKmInput] = useState('');
  const [nextServiceKmInput, setNextServiceKmInput] = useState('');
  const [workLines, setWorkLines] = useState<{ text: string; hours: string }[]>([
    { text: '', hours: '' },
    { text: '', hours: '' },
  ]);
  const [totalHoursInput, setTotalHoursInput] = useState('');
  const [finishOption, setFinishOption] = useState<FinishCheckOption>('Reparado / Finalizado');
  const [obsInput, setObsInput] = useState('');
  const [draftItems, setDraftItems] = useState<ItemDraft[]>([]);
  const [mechanicSignature, setMechanicSignature] = useState<string | null>(null);
  const [sigModalOpen, setSigModalOpen] = useState(false);

  useEffect(() => {
    if (!wo) return;
    // Mostrar abierto automáticamente para el mecánico mientras la orden no esté cerrada
    if (profile?.role === 'mecanico' && wo.status !== 'cerrada') {
      setShowMechanicForm(true);
    }
    setKmInput(
      wo.kilometraje != null
        ? String(wo.kilometraje)
        : vehicle?.km_actual != null
          ? String(vehicle.km_actual)
          : '',
    );
    setNextServiceKmInput(
      vehicle?.next_service_km != null ? String(vehicle.next_service_km) : '',
    );

    const parsedLines = splitWorkLines(wo).filter((r) => r.text.trim() !== '');
    setWorkLines(
      parsedLines.length > 0
        ? parsedLines
        : [
            { text: wo.requested_work || '', hours: '' },
            { text: '', hours: '' },
          ],
    );
    setTotalHoursInput(wo.labor_hours != null ? String(wo.labor_hours) : '');

    const { cleanObs: obsWithoutSig, signatureDataUrl } = extractMechanicSignature(wo.observations);
    setMechanicSignature(signatureDataUrl);

    const cleanObs = obsWithoutSig
      .replace(
        /\[(reparado \/ finalizado|reparado provisoriamente|pendiente de repuesto|pendiente de reparación|requiere revisión posterior)\]\s*/gi,
        '',
      )
      .trim();
    setObsInput(cleanObs);

    const checks = detectCompletionChecks(wo);
    if (checks.reparadoProvisoriamente) setFinishOption('Reparado provisoriamente');
    else if (checks.pendienteRepuesto) setFinishOption('Pendiente de repuesto');
    else if (checks.pendienteReparacion) setFinishOption('Pendiente de reparación');
    else if (checks.requiereRevisionPosterior) setFinishOption('Requiere revisión posterior');
    else setFinishOption('Reparado / Finalizado');
  }, [wo, vehicle, profile?.role]);

  useEffect(() => {
    setDraftItems(
      items.map((it) => ({
        id: it.id,
        part_id: it.part_id ?? null,
        part_code: it.part_code ?? '',
        description: it.description,
        quantity: String(it.quantity),
        unit: it.unit,
        unit_cost: it.unit_cost != null ? String(it.unit_cost) : '',
      })),
    );
  }, [items]);

  if (isLoading) return <Spinner />;
  if (error || !wo) {
    return (
      <EmptyState
        title="Orden de reparación no encontrada"
        description={error ? friendlyError(error) : undefined}
        action={<Button onClick={() => navigate('/ordenes')}>Volver a Hojas de Trabajo</Button>}
      />
    );
  }

  const canEdit =
    can('work_orders', 'edit') &&
    (profile?.role !== 'mecanico' || wo.mechanic_id === profile.id || wo.mechanic_id === null);
  const canApproveClose = can('work_orders', 'create') || profile?.role === 'admin';

  const changeStatus = async (next: WorkOrderStatus, downloadPdfAfterClose = false) => {
    try {
      const updated = await save.mutateAsync({ id: wo.id, values: { status: next } });
      if (can('vehicles', 'edit')) {
        const vehStatus = next === 'finalizada' || next === 'cerrada' ? 'operativo' : 'en_taller';
        await supabase.from('vehicles').update({ status: vehStatus }).eq('id', wo.vehicle_id);
      }
      toast.success(`Estado actualizado: ${WO_STATUS_LABELS[next]}`);
      setConfirmApproveClose(false);
      if (downloadPdfAfterClose) {
        await generateWorkOrderPdf(updated, vehicle, items);
        toast.success('Orden cerrada y PDF F02-PGV-02 descargado');
      }
    } catch (err) {
      toast.error(friendlyError(err));
    }
  };

  const handleMechanicSubmit = async (e: FormEvent, markCompleted: boolean) => {
    e.preventDefault();
    try {
      const kmNum = kmInput.trim() ? parseInt(kmInput.trim().replace(/\./g, ''), 10) : null;
      const nextSvcNum = nextServiceKmInput.trim()
        ? parseInt(nextServiceKmInput.trim().replace(/\./g, ''), 10)
        : null;

      // Compilar líneas de trabajo (1, 2, 3...) con sus horas
      const formattedLines = workLines
        .filter((r) => r.text.trim() !== '')
        .map((r, idx) => {
          const hrs = r.hours.trim();
          return `${idx + 1}. ${r.text.trim()}${hrs ? ` [${hrs} hs]` : ''}`;
        })
        .join('\n');

      // Sumar horas automáticamente si no se cargó total manual
      const sumHours = workLines.reduce((acc, r) => {
        const n = parseFloat(r.hours.replace(',', '.'));
        return Number.isFinite(n) && n > 0 ? acc + n : acc;
      }, 0);
      const finalHours = totalHoursInput.trim()
        ? parseFloat(totalHoursInput.replace(',', '.'))
        : sumHours > 0
          ? sumHours
          : null;

      let nextStatus: WorkOrderStatus = wo.status;
      if (markCompleted) {
        if (finishOption === 'Pendiente de repuesto') {
          nextStatus = 'pendiente_repuestos';
        } else if (finishOption === 'Pendiente de reparación') {
          nextStatus = 'pendiente_autorizacion';
        } else {
          nextStatus = 'finalizada';
        }
      } else if (wo.status === 'abierta' || wo.status === 'asignada') {
        nextStatus = 'en_proceso';
      }

      let taggedObs = `[${finishOption}]${obsInput.trim() ? ` ${obsInput.trim()}` : ''}`;
      if (mechanicSignature) {
        taggedObs += ` [FIRMA_MECANICO:${mechanicSignature}]`;
      }

      await save.mutateAsync({
        id: wo.id,
        values: {
          kilometraje: Number.isFinite(kmNum) ? kmNum : wo.kilometraje,
          work_performed: formattedLines || null,
          labor_hours: finalHours != null && Number.isFinite(finalHours) ? finalHours : wo.labor_hours,
          observations: taggedObs,
          status: nextStatus,
          mechanic_id: wo.mechanic_id || (profile?.role === 'mecanico' ? profile.id : null),
          mechanic_name:
            wo.mechanic_name ||
            (profile?.role === 'mecanico' ? profile.full_name || profile.email : null),
        },
        items: draftItems,
      });

      // Si se ingresó próximo service o km, actualizar la unidad
      if (wo.vehicle_id && (kmNum != null || nextSvcNum != null)) {
        const vehPatch: Record<string, unknown> = {};
        if (kmNum != null && Number.isFinite(kmNum)) vehPatch.km_actual = kmNum;
        if (nextSvcNum != null && Number.isFinite(nextSvcNum)) vehPatch.next_service_km = nextSvcNum;
        if (nextStatus === 'finalizada') vehPatch.status = 'operativo';
        if (Object.keys(vehPatch).length > 0) {
          await supabase.from('vehicles').update(vehPatch).eq('id', wo.vehicle_id);
        }
      }

      if (markCompleted) {
        toast.success(
          '¡Hoja de trabajo completada! Ya figura lista para que Coordinación cierre y descargue la OR.',
        );
        setShowMechanicForm(false);
      } else {
        toast.success('Avance del trabajo guardado en la Hoja OT');
      }
    } catch (err) {
      toast.error(friendlyError(err));
    }
  };

  const handlePdf = async () => {
    setPdfBusy(true);
    try {
      await generateWorkOrderPdf(wo, vehicle, items);
      toast.success('PDF F02-PGV-02 rev0 descargado y guardado en la nube');
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setPdfBusy(false);
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast.error(`"${file.name}" no es una imagen válida`);
        continue;
      }
      try {
        await uploadPhoto.mutateAsync({
          workOrderId: wo.id,
          file,
          caption: photoCaption,
          stage: photoStage,
          userEmail: profile?.email,
        });
        toast.success('Fotografía cargada');
      } catch (err) {
        toast.error(friendlyError(err));
      }
    }
    setPhotoCaption('');
    if (fileInput.current) fileInput.current.value = '';
  };

  // Datos para renderizar la planilla F02-PGV-02 rev0 en pantalla
  const otCode = `N° 00 00-${String(wo.order_number ?? 0).padStart(4, '0')}`;
  const sheetWorkRows = splitWorkLines(wo);
  const sheetChecks = detectCompletionChecks(wo);
  const { cleanObs: sheetObsCleaned, signatureDataUrl: sheetMechanicSig } =
    extractMechanicSignature(wo.observations);
  const cleanSheetObs = sheetObsCleaned
    .replace(
      /\[(reparado \/ finalizado|reparado provisoriamente|pendiente de repuesto|pendiente de reparación|requiere revisión posterior)\]\s*/gi,
      '',
    )
    .trim();
  const nextServiceDisplay =
    vehicle?.next_service_km != null
      ? `${formatNumber(vehicle.next_service_km)} km`
      : wo.kilometraje != null && wo.maintenance_type === 'preventivo'
        ? `${formatNumber(wo.kilometraje + 10000)} km`
        : '—';

  const totalPartRows = Math.max(8, items.length);

  return (
    <div className="space-y-5">
      {/* Encabezado y acciones */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/ordenes"
            className="rounded-xl border border-slate-200 bg-white p-2 shadow-xs transition hover:-translate-y-0.5 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-extrabold text-slate-900 dark:text-white sm:text-2xl">
                {formatOrderNumber(wo.order_number)}
              </h1>
              <WorkOrderStatusBadge status={wo.status} />
            </div>
            <p className="text-sm text-slate-500">
              <span className="font-mono font-bold text-brand-700 dark:text-brand-300">
                {formatPatente(wo.patente)}
              </span>
              {wo.nro_interno && ` · Interno ${wo.nro_interno}`}
              {wo.marca_modelo && ` · ${wo.marca_modelo}`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canEdit && wo.status !== 'cerrada' && (
            <Button
              variant={showMechanicForm ? 'secondary' : 'primary'}
              icon={<Wrench className="h-4 w-4" />}
              onClick={() => setShowMechanicForm((v) => !v)}
            >
              {showMechanicForm ? 'Ocultar Carga de Taller' : 'Completar Trabajo (Mecánico)'}
            </Button>
          )}
          <Button
            variant="secondary"
            icon={<FileDown className="h-4 w-4" />}
            loading={pdfBusy}
            onClick={() => void handlePdf()}
          >
            Descargar OT PDF (F02-PGV-02)
          </Button>
          <Button
            variant="secondary"
            icon={<Printer className="h-4 w-4" />}
            onClick={() => window.print()}
          >
            Imprimir
          </Button>
          {canApproveClose && (
            <Button
              variant="secondary"
              icon={<Pencil className="h-4 w-4" />}
              onClick={() => setEditOpen(true)}
            >
              Editar Asignación
            </Button>
          )}
          {canApproveClose && wo.status !== 'cerrada' && (
            <Button
              variant="success"
              icon={<ShieldCheck className="h-4 w-4" />}
              onClick={() => setConfirmApproveClose(true)}
            >
              Cerrar y Descargar OR
            </Button>
          )}
        </div>
      </div>

      {/* BANNER DEL SIGUIENTE NIVEL: Cuando el mecánico ya completó su trabajo y falta cerrar la OR */}
      {wo.status === 'finalizada' && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-2xl border-2 border-rvgreen-500 bg-gradient-to-r from-rvgreen-50 via-white to-brand-50 p-4 shadow-md dark:from-rvgreen-950/40 dark:via-slate-900 dark:to-brand-950/30 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rvgreen-500 text-slate-950 shadow">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1 rounded-full bg-rvgreen-500/20 px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wider text-rvgreen-900 dark:text-rvgreen-300">
                Siguiente Nivel · Trabajo Completado por el Mecánico
              </span>
              <h2 className="mt-0.5 text-base font-extrabold text-slate-900 dark:text-white">
                {wo.mechanic_name || 'El mecánico'} ya completó la Hoja de Trabajo (Km:{' '}
                {wo.kilometraje != null ? `${formatNumber(wo.kilometraje)} km` : 'S/D'} · Repuestos:{' '}
                {items.length})
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Revise los datos cargados en la planilla inferior y presione «Aprobar, Cerrar y Descargar OR» para archivar y bajar el PDF oficial.
              </p>
            </div>
          </div>
          {canApproveClose && (
            <Button
              variant="success"
              icon={<ShieldCheck className="h-4 w-4" />}
              onClick={() => void changeStatus('cerrada', true)}
              loading={save.isPending}
              className="shrink-0"
            >
              Aprobar, Cerrar y Descargar OR
            </Button>
          )}
        </div>
      )}

      {/* PANEL MÓVIL PARA EL MECÁNICO: Cargar Km, Trabajos Extras, Repuestos, Observaciones y Marcar Completado */}
      {canEdit && showMechanicForm && wo.status !== 'cerrada' && (
        <form
          onSubmit={(e) => void handleMechanicSubmit(e, true)}
          className="card relative overflow-hidden border-2 border-brand-600/30 p-4 shadow-lg sm:p-6"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-rvgreen-500 via-rvgreen-400 to-brand-600" />
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-0.5 text-xs font-bold text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
                <Wrench className="h-3.5 w-3.5" /> Hoja de Trabajo Móvil para Mecánico
              </span>
              <h2 className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
                Unidad {formatPatente(wo.patente)}{' '}
                {wo.nro_interno ? `· Interno ${wo.nro_interno}` : ''} ({wo.marca_modelo || 'Flota'})
              </h2>
            </div>
            {(wo.status === 'abierta' || wo.status === 'asignada') && (
              <Button
                type="button"
                size="sm"
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={() => void changeStatus('en_proceso')}
                loading={save.isPending}
              >
                Marcar «En Proceso» ahora
              </Button>
            )}
          </div>

          {/* Motivo asignado por Coordinación */}
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-300">
              Trabajo Asignado por Coordinación:
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
              {wo.requested_work || wo.failure_description || 'Revisión general según orden'}
            </p>
            {wo.failure_description && wo.requested_work && (
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                Falla reportada: {wo.failure_description}
              </p>
            )}
          </div>

          {/* 1. Kilómetros actuales y Próximo Service */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Kilometraje actual de la unidad (Km / Hs)" required>
              <div className="relative">
                <Gauge className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-brand-600" />
                <input
                  type="number"
                  inputMode="numeric"
                  className="input pl-9 text-base font-bold"
                  placeholder="Ej.: 162500"
                  value={kmInput}
                  onChange={(e) => setKmInput(e.target.value)}
                  required
                />
              </div>
            </Field>
            <Field label="Próximo Service (Km) — Opcional">
              <div className="flex gap-1.5">
                <input
                  type="number"
                  inputMode="numeric"
                  className="input font-semibold"
                  placeholder="Ej.: 172500"
                  value={nextServiceKmInput}
                  onChange={(e) => setNextServiceKmInput(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    const base = parseInt(kmInput || '0', 10) || vehicle?.km_actual || 0;
                    setNextServiceKmInput(String(base + 10000));
                  }}
                  className="shrink-0 rounded-xl border border-brand-300 bg-brand-50 px-2.5 text-xs font-bold text-brand-700 hover:bg-brand-600 hover:text-white dark:border-brand-700 dark:bg-brand-950 dark:text-brand-300"
                >
                  +10.000 km
                </button>
              </div>
            </Field>
            <Field label="Total Horas Ocupadas (Hs)">
              <div className="relative">
                <Clock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  inputMode="decimal"
                  className="input pl-9 font-semibold"
                  placeholder="Ej.: 2.5"
                  value={totalHoursInput}
                  onChange={(e) => setTotalHoursInput(e.target.value)}
                />
              </div>
            </Field>
          </div>

          {/* 2. Trabajos realizados + Trabajos extras que van apareciendo */}
          <div className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Detalle de Trabajos Realizados y Trabajos Extras Detectados (Sección 3 de la OT)
              </label>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() =>
                  setWorkLines((prev) => [...prev, { text: '', hours: '' }])
                }
              >
                Agregar trabajo extra
              </Button>
            </div>
            <div className="space-y-2">
              {workLines.map((row, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-extrabold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                    {idx + 1}.
                  </span>
                  <input
                    className="input flex-1"
                    placeholder={
                      idx === 0
                        ? 'Trabajo principal realizado (ej.: Cambio de aceite y filtros / pastillas)…'
                        : 'Otro trabajo extra realizado o ajuste detectado en el vehículo…'
                    }
                    value={row.text}
                    onChange={(e) =>
                      setWorkLines((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, text: e.target.value } : r)),
                      )
                    }
                  />
                  <input
                    className="input w-24 text-center"
                    placeholder="Hs"
                    inputMode="decimal"
                    value={row.hours}
                    onChange={(e) =>
                      setWorkLines((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, hours: e.target.value } : r)),
                      )
                    }
                  />
                  {workLines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setWorkLines((prev) => prev.filter((_, i) => i !== idx))}
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      title="Quitar renglón"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 3. Repuestos y Materiales Utilizados (Sección 4 de la OT) */}
          <div className="mb-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Repuestos y Materiales Utilizados (Sección 4 de la OT)
              </label>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() =>
                  setDraftItems((prev) => [
                    ...prev,
                    {
                      part_id: null,
                      part_code: '',
                      description: '',
                      quantity: '1',
                      unit: 'un.',
                      unit_cost: '',
                    },
                  ])
                }
              >
                Agregar repuesto / insumo
              </Button>
            </div>

            {draftItems.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
                Sin repuestos cargados aún. Toque «Agregar repuesto / insumo» para anotar las partes utilizadas.
              </p>
            ) : (
              <div className="space-y-2">
                {draftItems.map((it, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-800/40 sm:grid-cols-12"
                  >
                    <div className="sm:col-span-2">
                      <input
                        className="input text-center font-bold"
                        placeholder="Cant."
                        inputMode="decimal"
                        value={it.quantity}
                        onChange={(e) =>
                          setDraftItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <div className="sm:col-span-6">
                      <input
                        className="input"
                        list="mechanic-parts-list"
                        placeholder="Descripción del repuesto / material / insumo…"
                        value={it.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          const matchedPart = parts.find(
                            (p) =>
                              p.description.toLowerCase() === val.toLowerCase() ||
                              p.internal_code.toLowerCase() === val.toLowerCase(),
                          );
                          setDraftItems((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    description: val,
                                    part_id: matchedPart ? matchedPart.id : x.part_id,
                                    part_code: matchedPart ? matchedPart.internal_code : x.part_code,
                                  }
                                : x,
                            ),
                          );
                        }}
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <input
                        className="input font-mono text-xs"
                        placeholder="Código / N° Repuesto"
                        value={it.part_code}
                        onChange={(e) =>
                          setDraftItems((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, part_code: e.target.value } : x)),
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center justify-end sm:col-span-1">
                      <button
                        type="button"
                        onClick={() =>
                          setDraftItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
                <datalist id="mechanic-parts-list">
                  {parts.map((p) => (
                    <option
                      key={p.id}
                      value={p.description}
                      label={`${p.internal_code} · Stock: ${p.quantity}`}
                    />
                  ))}
                </datalist>
              </div>
            )}
          </div>

          {/* 4. Estado del trabajo al finalizar (Sección 5) y Observaciones (Sección 6) */}
          <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-bold text-slate-800 dark:text-slate-100">
                Estado del Trabajo al Finalizar (Sección 5)
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {FINISH_OPTIONS.map((opt) => {
                  const active = finishOption === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setFinishOption(opt)}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-bold transition-all duration-200 hover:-translate-y-0.5 ${
                        active
                          ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                      }`}
                    >
                      <span className="font-mono text-sm">[{active ? 'X' : ' '}]</span>
                      <span>{opt}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Field label="Observaciones y Recomendaciones del Mecánico (Sección 6)">
                <textarea
                  className="input min-h-[110px]"
                  placeholder="Anote cualquier observación, desgaste detectado, repuesto a pedir o recomendación para el próximo ingreso…"
                  value={obsInput}
                  onChange={(e) => setObsInput(e.target.value)}
                />
              </Field>
            </div>
          </div>

          {/* Firma digital del mecánico */}
          <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                  <PenTool className="h-4 w-4 text-brand-600" />
                  Firma Digital del Mecánico / Responsable de Taller
                </h4>
                <p className="text-xs text-slate-500">
                  Firme en la pantalla con el dedo o mouse para estampar la firma directamente en la OR oficial F02-PGV-02.
                </p>
              </div>
              <Button
                type="button"
                variant={mechanicSignature ? 'secondary' : 'primary'}
                size="sm"
                icon={<PenTool className="h-3.5 w-3.5" />}
                onClick={() => setSigModalOpen(true)}
              >
                {mechanicSignature ? 'Modificar firma en pantalla' : 'Firmar en pantalla'}
              </Button>
            </div>

            {mechanicSignature ? (
              <div className="mt-3 flex items-center gap-4">
                <div className="rounded-xl border border-slate-300 bg-white p-2 shadow-sm dark:border-slate-700">
                  <img
                    src={mechanicSignature}
                    alt="Firma del mecánico"
                    className="h-14 w-auto max-w-[200px] object-contain"
                  />
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                    ✔ Firma digital registrada y lista para estampar en el PDF
                  </p>
                  <button
                    type="button"
                    onClick={() => setMechanicSignature(null)}
                    className="mt-1 font-semibold text-red-600 hover:underline"
                  >
                    Borrar firma
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs italic text-slate-400">
                (Opcional) Si no se firma ahora en pantalla, la OR puede cerrarse con la aclaración digital o firmarse físicamente en papel.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 pt-4 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              loading={save.isPending}
              onClick={(e) => void handleMechanicSubmit(e as unknown as FormEvent, false)}
            >
              Guardar avance parcial
            </Button>
            <Button
              type="submit"
              variant="success"
              loading={save.isPending}
              icon={<ClipboardCheck className="h-4 w-4" />}
              className="px-5 py-2.5 text-base"
            >
              ✔ Marcar Completado y Enviar a Control
            </Button>
          </div>
        </form>
      )}

      {/* ========================================================================
          HOJA OFICIAL EN PANTALLA: REGISTRO DE TRABAJO MECÁNICO (F02-PGV-02 rev0)
         ======================================================================== */}
      <div className="card overflow-hidden border-2 border-slate-400 bg-white text-slate-900 shadow-lg print:border-slate-800 print:shadow-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
        <div className="p-4 sm:p-6">
          {/* Cabecera F02-PGV-02 rev0 */}
          <div className="grid grid-cols-1 items-center gap-3 pb-3 md:grid-cols-12">
            <div className="flex justify-center md:col-span-3 md:justify-start">
              <div className="inline-flex items-center rounded-xl bg-white px-3 py-1.5">
                <img
                  src="/logo-rvgroup.png"
                  alt="RV Group Transporte"
                  className="h-12 w-auto object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = '/logo-rvgroup.png.png';
                  }}
                />
              </div>
            </div>

            <div className="text-center md:col-span-5">
              <div className="bg-[#2b3c4e] px-3 py-2 text-sm font-extrabold tracking-wide text-white uppercase sm:text-base">
                REGISTRO DE TRABAJO MECÁNICO
              </div>
              <div className="mt-1.5 text-xs font-bold tracking-widest text-slate-600 uppercase dark:text-slate-300">
                SERVICIOS DE MANTENIMIENTO
              </div>
            </div>

            <div className="md:col-span-4">
              <div className="border border-slate-500 text-center">
                <div className="border-b border-slate-500 bg-slate-200 px-3 py-1.5 text-sm font-extrabold text-slate-900 dark:bg-slate-800 dark:text-white">
                  F02-PGV-02 rev0
                </div>
                <div className="px-3 py-2 font-mono text-xs font-extrabold sm:text-sm">
                  N.º ORDEN DE TRABAJO (OT) {otCode}
                </div>
              </div>
            </div>
          </div>

          {/* Grilla de Fechas, Patente, Interno y Kilometrajes */}
          <div className="grid grid-cols-1 border border-slate-500 text-xs sm:grid-cols-3">
            <div className="flex items-center justify-between border-b border-slate-500 px-3 py-2 sm:border-r">
              <span className="font-bold text-slate-700 dark:text-slate-300">FECHA TRABAJO:</span>
              <span className="font-mono text-sm font-extrabold">
                {wo.opened_at ? formatDate(wo.opened_at) : '____ / ____ / 202___'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-500 px-3 py-2 sm:border-r">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                PATENTE / DOMINIO:
              </span>
              <span className="font-mono text-sm font-extrabold text-brand-700 dark:text-brand-300">
                {formatPatente(wo.patente)}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-500 px-3 py-2">
              <span className="font-bold text-slate-700 dark:text-slate-300">N.º INTERNO:</span>
              <span className="font-mono text-sm font-extrabold">{wo.nro_interno || '—'}</span>
            </div>

            <div className="flex items-center justify-between border-b border-slate-500 px-3 py-2 sm:border-r sm:border-b-0">
              <span className="font-bold text-slate-700 dark:text-slate-300">FECHA DE SALIDA:</span>
              <span className="font-mono text-sm font-semibold">
                {wo.closed_at ? formatDate(wo.closed_at) : '____ / ____ / 202___'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-slate-500 px-3 py-2 sm:border-r sm:border-b-0">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                KILOMETRAJE / HS:
              </span>
              <span className="font-mono text-sm font-extrabold">
                {wo.kilometraje != null ? `${formatNumber(wo.kilometraje)} km` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="font-bold leading-tight text-slate-700 dark:text-slate-300">
                PROXIMO SERVICE
                <br />
                KILOMETRAJE / HS:
              </span>
              <span className="font-mono text-sm font-extrabold">{nextServiceDisplay}</span>
            </div>
          </div>

          {/* 1. TIPO DE MANTENIMIENTO */}
          <div className="mt-3 bg-[#2b3c4e] px-3 py-1.5 text-xs font-extrabold text-white uppercase">
            1. TIPO DE MANTENIMIENTO (MARCAR CON X)
          </div>
          <div className="grid grid-cols-2 gap-2 px-3 py-2.5 text-xs font-bold sm:grid-cols-5">
            <div>
              [ {wo.maintenance_type === 'preventivo' ? 'X' : ' '} ] Preventivo
            </div>
            <div>
              [ {wo.maintenance_type === 'correctivo' ? 'X' : ' '} ] Correctivo
            </div>
            <div>
              [ {wo.maintenance_type === 'rto' ? 'X' : ' '} ] Revisión / Inspección
            </div>
            <div>[ {wo.maintenance_type === 'otro' ? 'X' : ' '} ] Reparación</div>
            <div>
              [ {wo.maintenance_type === 'emergencia' ? 'X' : ' '} ] Emergencia / Auxilio
            </div>
          </div>

          {/* 2. MOTIVO / TRABAJO SOLICITADO */}
          <div className="mt-1 bg-[#2b3c4e] px-3 py-1.5 text-xs font-extrabold text-white uppercase">
            2. MOTIVO / TRABAJO SOLICITADO
          </div>
          <div className="divide-y divide-dashed divide-slate-400 border border-slate-500 text-sm">
            <div className="min-h-[28px] px-3 py-1.5 font-medium">
              {wo.requested_work || wo.failure_description || '\u00A0'}
            </div>
            <div className="min-h-[28px] px-3 py-1.5 text-slate-700 dark:text-slate-300">
              {wo.requested_work && wo.failure_description
                ? `Falla reportada: ${wo.failure_description}`
                : '\u00A0'}
            </div>
            <div className="min-h-[28px] px-3 py-1.5 text-xs text-slate-500">
              {wo.marca_modelo ? `Unidad: ${wo.marca_modelo}` : '\u00A0'}
            </div>
          </div>

          {/* 3. DETALLE DE TRABAJO REALIZADO Y TIEMPO / HORAS OCUPADAS */}
          <div className="mt-3 bg-[#2b3c4e] px-3 py-1.5 text-xs font-extrabold text-white uppercase">
            3. DETALLE DE TRABAJO REALIZADO Y TIEMPO / HORAS OCUPADAS
          </div>
          <div className="overflow-x-auto border border-slate-500">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-500 bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                  <th className="border-r border-slate-500 px-3 py-2 text-left font-extrabold">
                    DESCRIPCIÓN DEL TRABAJO REALIZADO (REVISIÓN, REPARACIÓN, AJUSTE, RECAMBIO)
                  </th>
                  <th className="w-36 px-3 py-2 text-center font-extrabold">HORAS OCUPADAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-400">
                {sheetWorkRows.map((row, idx) => (
                  <tr key={idx}>
                    <td className="border-r border-slate-500 px-3 py-2 text-sm">
                      <span className="mr-2 font-extrabold">{idx + 1}.</span>
                      {row.text}
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-sm font-semibold">
                      {row.hours}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-extrabold dark:bg-slate-800/50">
                  <td className="border-r border-slate-500 px-3 py-2 text-right">
                    TOTAL HORAS TRABAJADAS:
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-sm">
                    {wo.labor_hours != null ? `${wo.labor_hours} Hs` : '______ Hs'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 4. REPUESTOS Y MATERIALES UTILIZADOS */}
          <div className="mt-3 bg-[#2b3c4e] px-3 py-1.5 text-xs font-extrabold text-white uppercase">
            4. REPUESTOS Y MATERIALES UTILIZADOS
          </div>
          <div className="overflow-x-auto border border-slate-500">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-500 bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100">
                  <th className="w-28 border-r border-slate-500 px-3 py-2 text-center font-extrabold">
                    CANTIDAD
                  </th>
                  <th className="border-r border-slate-500 px-3 py-2 text-left font-extrabold">
                    DESCRIPCIÓN DEL REPUESTO / MATERIAL / INSUMO
                  </th>
                  <th className="w-48 px-3 py-2 text-left font-extrabold">
                    N° DE REPUESTO / CODIGO
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-400">
                {Array.from({ length: totalPartRows }).map((_, idx) => {
                  const it = items[idx];
                  return (
                    <tr key={idx} className="h-7">
                      <td className="border-r border-slate-500 px-3 py-1.5 text-center font-mono text-sm font-semibold">
                        {it ? `${it.quantity} ${it.unit || ''}` : '\u00A0'}
                      </td>
                      <td className="border-r border-slate-500 px-3 py-1.5 text-sm">
                        {it ? it.description : '\u00A0'}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {it?.part_code || '\u00A0'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 5. ESTADO DEL TRABAJO AL FINALIZAR */}
          <div className="mt-3 bg-[#2b3c4e] px-3 py-1.5 text-xs font-extrabold text-white uppercase">
            5. ESTADO DEL TRABAJO AL FINALIZAR
          </div>
          <div className="grid grid-cols-1 gap-2 px-4 py-3 text-xs font-bold sm:grid-cols-3">
            <div>
              [ {sheetChecks.reparadoFinalizado ? 'X' : ' '} ] Reparado / Finalizado
            </div>
            <div>
              [ {sheetChecks.reparadoProvisoriamente ? 'X' : ' '} ] Reparado provisoriamente
            </div>
            <div>[ {sheetChecks.pendienteRepuesto ? 'X' : ' '} ] Pendiente de repuesto</div>
            <div>[ {sheetChecks.pendienteReparacion ? 'X' : ' '} ] Pendiente de reparación</div>
            <div>
              [ {sheetChecks.requiereRevisionPosterior ? 'X' : ' '} ] Requiere revisión posterior
            </div>
          </div>

          {/* 6. OBSERVACIONES Y RECOMENDACIONES */}
          <div className="mt-1 bg-[#2b3c4e] px-3 py-1.5 text-xs font-extrabold text-white uppercase">
            6. OBSERVACIONES Y RECOMENDACIONES
          </div>
          <div className="divide-y divide-dashed divide-slate-400 border border-slate-500 text-sm">
            <div className="min-h-[28px] px-3 py-1.5">{cleanSheetObs.split(/\r?\n/)[0] || cleanSheetObs || '\u00A0'}</div>
            <div className="min-h-[28px] px-3 py-1.5">{cleanSheetObs.split(/\r?\n/)[1] || '\u00A0'}</div>
            <div className="min-h-[28px] px-3 py-1.5">
              {cleanSheetObs.split(/\r?\n/).slice(2).join(' · ') || '\u00A0'}
            </div>
          </div>

          {/* FIRMAS: MECÁNICO / TALLER Y CONTROL MANTENIMIENTO */}
          <div className="mt-3 grid grid-cols-1 border border-slate-500 text-xs sm:grid-cols-2">
            <div className="border-b border-slate-500 sm:border-r sm:border-b-0">
              <div className="border-b border-slate-500 bg-slate-200 px-3 py-1.5 font-extrabold dark:bg-slate-800">
                MECÁNICO / TALLER
              </div>
              <div className="space-y-3 p-3">
                <p>
                  <b>Realizado por:</b>{' '}
                  {wo.mechanic_name || '.......................................................'}
                </p>
                {(sheetMechanicSig || mechanicSignature) ? (
                  <div>
                    <b>Firma:</b>
                    <div className="mt-1 inline-block rounded border border-slate-300 bg-white p-1">
                      <img
                        src={(sheetMechanicSig || mechanicSignature)!}
                        alt="Firma del Mecánico"
                        className="h-10 w-auto max-w-[160px] object-contain"
                      />
                    </div>
                    <span className="block text-[10px] text-slate-500">Conformidad digital registrada</span>
                  </div>
                ) : (
                  <p>
                    <b>Firma:</b>{' '}
                    {wo.status === 'finalizada' || wo.status === 'cerrada'
                      ? `${wo.mechanic_name || 'Completado desde Taller Móvil'} (Conformidad Digital)`
                      : '.....................................................................'}
                  </p>
                )}
              </div>
            </div>
            <div>
              <div className="border-b border-slate-500 bg-slate-200 px-3 py-1.5 font-extrabold dark:bg-slate-800">
                CONTROL MANTENIMIENTO (CARGA OT DIGITAL)
              </div>
              <div className="space-y-4 p-3">
                <p>
                  <b>Revisado por:</b>{' '}
                  {wo.approved_by_name || '.......................................................'}
                </p>
                <p>
                  <b>Fecha revisión:</b>{' '}
                  {wo.approved_at ? formatDate(wo.approved_at) : '____ / ____ / 202___'}
                </p>
              </div>
            </div>
          </div>

          <p className="mt-2 text-center text-[11px] italic text-slate-500">
            Documento interno de registro operativo - RV GROUP SRL. Una vez completado a mano, entregar a Mantenimiento para su carga en OT Digital.
          </p>
        </div>
      </div>

      {/* Fotografías y trazabilidad */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Fotografías del trabajo</h2>
              <p className="text-xs text-slate-500">
                Puede tomar una foto directamente con la cámara del teléfono
              </p>
            </div>
            {canEdit && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => void handleFileSelect(e.target.files)}
                />
                <Button
                  size="sm"
                  icon={<Camera className="h-4 w-4" />}
                  loading={uploadPhoto.isPending}
                  onClick={() => fileInput.current?.click()}
                >
                  Subir / Tomar foto
                </Button>
              </>
            )}
          </div>

          {canEdit && (
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                className="input"
                value={photoStage}
                onChange={(e) => setPhotoStage(e.target.value)}
              >
                {Object.entries(PHOTO_STAGE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    Etapa: {v}
                  </option>
                ))}
              </select>
              <input
                className="input sm:col-span-2"
                placeholder="Descripción opcional antes de subir la foto…"
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
              />
            </div>
          )}

          {photosLoading ? (
            <Spinner />
          ) : !photos.length ? (
            <p className="text-sm text-slate-500">Aún no se adjuntaron fotografías.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p) => (
                <div
                  key={p.id}
                  className="group relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800"
                >
                  <a href={p.signedUrl} target="_blank" rel="noreferrer">
                    <img
                      src={p.signedUrl}
                      alt={p.caption || 'Foto OR'}
                      className="h-40 w-full object-cover"
                    />
                  </a>
                  <div className="p-2 text-xs">
                    <span className="font-semibold">
                      {PHOTO_STAGE_LABELS[p.stage ?? 'reparacion'] || p.stage}
                    </span>
                    {p.caption && (
                      <p className="truncate text-slate-600 dark:text-slate-300">{p.caption}</p>
                    )}
                    <p className="text-[11px] text-slate-400">
                      {formatDate(p.created_at, true)}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => setPhotoToDelete(p)}
                      className="absolute top-2 right-2 rounded-lg bg-slate-900/70 p-1.5 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-600"
                      title="Eliminar foto"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <Sparkles className="h-4 w-4 text-rvgreen-500" /> Seguimiento de niveles de la OT
          </h2>
          {!history.length ? (
            <p className="text-sm text-slate-500">Sin movimientos registrados.</p>
          ) : (
            <ol className="space-y-3 border-l-2 border-brand-200 pl-4 text-xs dark:border-slate-700">
              {history.map((h) => (
                <li key={h.id}>
                  <p className="font-semibold text-slate-900 dark:text-slate-100">
                    {h.from_status ? `${WO_STATUS_LABELS[h.from_status]} → ` : ''}
                    {WO_STATUS_LABELS[h.to_status]}
                  </p>
                  <p className="text-slate-500">
                    {formatDate(h.created_at, true)} · {h.user_email || 'sistema'}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <WorkOrderFormModal open={editOpen} onClose={() => setEditOpen(false)} workOrder={wo} />

      <ConfirmDialog
        open={confirmApproveClose}
        onClose={() => setConfirmApproveClose(false)}
        onConfirm={() => void changeStatus('cerrada', true)}
        loading={save.isPending}
        title="Aprobar, Cerrar OR y Descargar PDF F02-PGV-02"
        message={`¿Confirmar la revisión y el cierre definitivo de ${formatOrderNumber(wo.order_number)} (${formatPatente(wo.patente)})? Se registrará su firma en Control Mantenimiento, la unidad quedará Operativa y se descargará el PDF oficial.`}
        confirmLabel="Cerrar OR y Descargar PDF"
      />

      <ConfirmDialog
        open={!!photoToDelete}
        onClose={() => setPhotoToDelete(null)}
        onConfirm={async () => {
          if (!photoToDelete) return;
          try {
            await deletePhoto.mutateAsync({ photo: photoToDelete });
            toast.success('Fotografía eliminada');
            setPhotoToDelete(null);
          } catch (err) {
            toast.error(friendlyError(err));
          }
        }}
        loading={deletePhoto.isPending}
        title="Eliminar fotografía"
        message="¿Eliminar esta fotografía de la orden de reparación?"
        confirmLabel="Eliminar"
        danger
      />

      <SignaturePadModal
        open={sigModalOpen}
        onClose={() => setSigModalOpen(false)}
        title="Firma del Mecánico — Registro F02-PGV-02"
        roleLabel="Mecánico / Taller"
        signerName={wo.mechanic_name || (profile?.role === 'mecanico' ? (profile.full_name || profile.email) : undefined)}
        onSave={(dataUrl) => {
          setMechanicSignature(dataUrl);
          toast.success('Firma digital registrada. Se estampará en la Hoja de Trabajo y en el PDF.');
        }}
      />
    </div>
  );
}
