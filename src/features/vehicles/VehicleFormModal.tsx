import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Button, Field, Modal } from '@/components/ui';
import { checkPatente, normalizePatente } from '@/lib/patente';
import { friendlyError, supabase } from '@/lib/supabase';
import { STATUS_LABELS, VEHICLE_TYPE_SUGGESTIONS } from '@/lib/constants';
import { useAuth } from '@/features/auth/AuthProvider';
import type { Vehicle, VehicleStatus } from '@/types/db';
import { useCategories, useSaveVehicle } from './api';

const currentYear = new Date().getFullYear();
const optInt = (min: number, max: number, msg: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v.replace(/\./g, '')) && +v.replace(/\./g, '') >= min && +v.replace(/\./g, '') <= max), msg);

const schema = z.object({
  patente: z.string().superRefine((v, ctx) => {
    const r = checkPatente(v);
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.error });
  }),
  registro_nro: z.string().max(30),
  nro_interno: z.string().max(30),
  category_id: z.string(),
  marca: z.string().max(60),
  modelo: z.string().max(60),
  version: z.string().max(60),
  anio: optInt(1950, currentYear + 1, `Año entre 1950 y ${currentYear + 1}`),
  chasis: z.string().max(40),
  motor: z.string().max(40),
  km_actual: optInt(0, 5_000_000, 'Kilometraje inválido'),
  vehicle_type: z.string().max(40),
  tire_type_size: z.string().max(60),
  tire_count: optInt(0, 30, 'Entre 0 y 30'),
  rto_due_date: z.string(),
  service_interval_km: optInt(1000, 200_000, 'Entre 1.000 y 200.000 km'),
  last_service_km: optInt(0, 5_000_000, 'Kilometraje inválido'),
  last_service_date: z.string(),
  status: z.enum(['operativo', 'fuera_de_servicio', 'en_taller', 'baja']),
  observaciones: z.string().max(2000),
});
type FormValues = z.infer<typeof schema>;

const toForm = (v?: Vehicle | null): FormValues => ({
  patente: v?.patente ?? '',
  registro_nro: v?.registro_nro ?? '',
  nro_interno: v?.nro_interno ?? '',
  category_id: v?.category_id ?? '',
  marca: v?.marca ?? '',
  modelo: v?.modelo ?? '',
  version: v?.version ?? '',
  anio: v?.anio?.toString() ?? '',
  chasis: v?.chasis ?? '',
  motor: v?.motor ?? '',
  km_actual: v?.km_actual?.toString() ?? '',
  vehicle_type: v?.vehicle_type ?? '',
  tire_type_size: v?.tire_type_size ?? '',
  tire_count: v?.tire_count?.toString() ?? '',
  rto_due_date: v?.rto_due_date ?? '',
  service_interval_km: v?.service_interval_km?.toString() ?? '10000',
  last_service_km: v?.last_service_km?.toString() ?? '',
  last_service_date: v?.last_service_date ?? '',
  status: v?.status ?? 'operativo',
  observaciones: v?.observaciones ?? '',
});

export function VehicleFormModal({
  open,
  onClose,
  vehicle,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  vehicle?: Vehicle | null;
  onSaved?: (v: Vehicle) => void;
}) {
  const { can } = useAuth();
  const { data: categories = [] } = useCategories();
  const save = useSaveVehicle();
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(vehicle) });

  useEffect(() => {
    if (open) {
      reset(toForm(vehicle));
      setDupWarning(null);
    }
  }, [open, vehicle, reset]);

  const patente = watch('patente');
  const patCheck = checkPatente(patente);

  // Verificación inmediata de patente duplicada
  useEffect(() => {
    const p = normalizePatente(patente);
    if (!open || p.length < 5 || p === vehicle?.patente) return setDupWarning(null);
    const t = setTimeout(async () => {
      const { data } = await supabase.from('vehicles').select('id, nro_interno, status').eq('patente', p).maybeSingle();
      setDupWarning(data ? `Ya existe una unidad con la patente ${p}${data.status === 'baja' ? ' (dada de baja)' : ''}.` : null);
    }, 400);
    return () => clearTimeout(t);
  }, [patente, open, vehicle?.patente]);

  // Al elegir categoría se completan marca/modelo/versión si están vacíos
  const onCategoryChange = (id: string) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    if (!watch('marca') && c.brand) setValue('marca', c.brand);
    if (!watch('modelo') && c.model) setValue('modelo', c.model);
    if (!watch('version') && c.version) setValue('version', c.version);
  };

  const onSubmit = async (f: FormValues) => {
    if (dupWarning) return toast.error(dupWarning);
    const int = (s: string) => (s.trim() === '' ? null : parseInt(s.replace(/\./g, ''), 10));
    const txt = (s: string) => (s.trim() === '' ? null : s.trim());
    const values = {
      patente: normalizePatente(f.patente),
      registro_nro: txt(f.registro_nro),
      nro_interno: txt(f.nro_interno),
      category_id: f.category_id || null,
      marca: txt(f.marca),
      modelo: txt(f.modelo),
      version: txt(f.version),
      anio: int(f.anio),
      chasis: txt(f.chasis),
      motor: txt(f.motor),
      km_actual: int(f.km_actual),
      vehicle_type: txt(f.vehicle_type),
      tire_type_size: txt(f.tire_type_size),
      tire_count: int(f.tire_count),
      rto_due_date: txt(f.rto_due_date),
      service_interval_km: int(f.service_interval_km) ?? 10000,
      last_service_km: int(f.last_service_km),
      last_service_date: txt(f.last_service_date),
      status: f.status as VehicleStatus,
      observaciones: txt(f.observaciones),
    };
    try {
      const saved = await save.mutateAsync({ id: vehicle?.id, values });
      toast.success(vehicle ? 'Unidad actualizada' : `Unidad ${saved.patente} registrada`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    }
  };

  const canBaja = can('vehicles', 'delete');
  const statusOptions = (Object.keys(STATUS_LABELS) as VehicleStatus[]).filter(
    (s) => s !== 'baja' || canBaja || vehicle?.status === 'baja',
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={vehicle ? `Editar unidad ${vehicle.patente}` : 'Nueva unidad'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit(onSubmit)} loading={save.isPending} icon={<Save className="h-4 w-4" />}>
            Guardar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <section>
          <h3 className="mb-3 text-sm font-semibold text-brand-700 dark:text-brand-300">Identificación</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Patente"
              required
              error={errors.patente?.message || dupWarning || undefined}
              hint={patCheck.ok && patCheck.warning ? patCheck.warning : 'Formatos: AAA123 o AA123BB'}
            >
              <input
                className="input font-mono uppercase"
                {...register('patente')}
                autoFocus={!vehicle}
                placeholder="AB123CD"
              />
            </Field>
            <Field label="N° interno" error={errors.nro_interno?.message}>
              <input className="input" {...register('nro_interno')} />
            </Field>
            <Field label="N° de orden / registro" error={errors.registro_nro?.message}>
              <input className="input" {...register('registro_nro')} />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-brand-700 dark:text-brand-300">Vehículo</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Categoría" className="sm:col-span-3">
              <select
                className="input"
                {...register('category_id', { onChange: (e) => onCategoryChange(e.target.value) })}
              >
                <option value="">— Sin categoría —</option>
                {categories
                  .filter((c) => c.active || c.id === vehicle?.category_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Marca">
              <input className="input" {...register('marca')} />
            </Field>
            <Field label="Modelo">
              <input className="input" {...register('modelo')} />
            </Field>
            <Field label="Versión">
              <input className="input" {...register('version')} />
            </Field>
            <Field label="Año" error={errors.anio?.message}>
              <input className="input" inputMode="numeric" {...register('anio')} />
            </Field>
            <Field label="Tipo de vehículo">
              <input className="input" list="vehicle-types" {...register('vehicle_type')} />
              <datalist id="vehicle-types">
                {VEHICLE_TYPE_SUGGESTIONS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label="Kilometraje actual" error={errors.km_actual?.message}>
              <input className="input" inputMode="numeric" {...register('km_actual')} />
            </Field>
            <Field label="N° de chasis" error={errors.chasis?.message}>
              <input className="input font-mono uppercase" {...register('chasis')} />
            </Field>
            <Field label="N° de motor" error={errors.motor?.message}>
              <input className="input font-mono uppercase" {...register('motor')} />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-brand-700 dark:text-brand-300">Cubiertas y estado</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Tipo y medida de cubiertas">
              <input className="input" {...register('tire_type_size')} placeholder="Ej.: 225/70 R15" />
            </Field>
            <Field label="Cantidad de cubiertas" error={errors.tire_count?.message}>
              <input className="input" inputMode="numeric" {...register('tire_count')} />
            </Field>
            <Field label="Estado operativo" required>
              <select className="input" {...register('status')}>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Observaciones" className="sm:col-span-3" error={errors.observaciones?.message}>
              <textarea className="input min-h-[80px]" {...register('observaciones')} />
            </Field>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-brand-700 dark:text-brand-300">RTO y mantenimiento preventivo</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="Vencimiento de RTO">
              <input type="date" className="input" {...register('rto_due_date')} />
            </Field>
            <Field label="Intervalo service (km)" error={errors.service_interval_km?.message}>
              <input className="input" inputMode="numeric" {...register('service_interval_km')} placeholder="10000" />
            </Field>
            <Field label="Km último service" error={errors.last_service_km?.message}>
              <input className="input" inputMode="numeric" {...register('last_service_km')} />
            </Field>
            <Field label="Fecha último service">
              <input type="date" className="input" {...register('last_service_date')} />
            </Field>
          </div>
        </section>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
