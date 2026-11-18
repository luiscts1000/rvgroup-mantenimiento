-- =============================================================================
-- Migración 0012: Soporte para doble RTO (Nacional y Provincial) en Sprinter y Minibuses
-- =============================================================================

alter table public.vehicles
  add column if not exists rto_provincial_due_date date;

create index if not exists idx_vehicles_rto_provincial_due
  on public.vehicles (rto_provincial_due_date);

alter table public.preventive_inspections
  add column if not exists rto_provincial_due_date date;

-- Actualizar trigger de inspecciones preventivas para actualizar ambas RTOs si se cargan
create or replace function public.preventive_inspections_after_write()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.vehicles
     set rto_due_date            = coalesce(new.rto_due_date, rto_due_date),
         rto_provincial_due_date = coalesce(new.rto_provincial_due_date, rto_provincial_due_date),
         km_actual               = case
                                     when new.kilometraje is not null and (km_actual is null or new.kilometraje > km_actual)
                                     then new.kilometraje
                                     else km_actual
                                   end
   where id = new.vehicle_id;
  return new;
end;
$$;

-- Actualizar función de registro de inspecciones preventivas para admitir rto_provincial_due_date
create or replace function public.create_inspection_with_pendings(
  p_inspection       jsonb,
  p_generate_pending boolean default true
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_insp     public.preventive_inspections%rowtype;
  v_count    int := 0;
  v_item     record;
  v_priority public.pending_priority;
begin
  if not public.has_permission('preventive', 'create') and not public.has_permission('preventive', 'edit') then
    raise exception 'No tiene permiso para registrar inspecciones preventivas';
  end if;

  insert into public.preventive_inspections (
    vehicle_id, inspected_at, inspector_name, kilometraje, rto_due_date, rto_provincial_due_date,
    windshield_state, windshield_notes,
    tires_state, tires_notes,
    brakes_state, brakes_notes,
    suspension_state, suspension_notes,
    lights_state, lights_notes,
    seatbelts_state, seatbelts_notes,
    safety_elements_state, safety_elements_notes,
    documentation_state, documentation_notes,
    observations
  )
  values (
    (p_inspection ->> 'vehicle_id')::uuid,
    coalesce((p_inspection ->> 'inspected_at')::date, current_date),
    nullif(trim(p_inspection ->> 'inspector_name'), ''),
    (p_inspection ->> 'kilometraje')::int,
    (p_inspection ->> 'rto_due_date')::date,
    (p_inspection ->> 'rto_provincial_due_date')::date,
    coalesce((p_inspection ->> 'windshield_state')::public.check_item_state, 'ok'),
    nullif(trim(p_inspection ->> 'windshield_notes'), ''),
    coalesce((p_inspection ->> 'tires_state')::public.check_item_state, 'ok'),
    nullif(trim(p_inspection ->> 'tires_notes'), ''),
    coalesce((p_inspection ->> 'brakes_state')::public.check_item_state, 'ok'),
    nullif(trim(p_inspection ->> 'brakes_notes'), ''),
    coalesce((p_inspection ->> 'suspension_state')::public.check_item_state, 'ok'),
    nullif(trim(p_inspection ->> 'suspension_notes'), ''),
    coalesce((p_inspection ->> 'lights_state')::public.check_item_state, 'ok'),
    nullif(trim(p_inspection ->> 'lights_notes'), ''),
    coalesce((p_inspection ->> 'seatbelts_state')::public.check_item_state, 'ok'),
    nullif(trim(p_inspection ->> 'seatbelts_notes'), ''),
    coalesce((p_inspection ->> 'safety_elements_state')::public.check_item_state, 'ok'),
    nullif(trim(p_inspection ->> 'safety_elements_notes'), ''),
    coalesce((p_inspection ->> 'documentation_state')::public.check_item_state, 'ok'),
    nullif(trim(p_inspection ->> 'documentation_notes'), ''),
    nullif(trim(p_inspection ->> 'observations'), '')
  )
  returning * into v_insp;

  if p_generate_pending then
    for v_item in
      select * from (
        values
          ('Parabrisas (Inspección RTO)',              v_insp.windshield_state,      v_insp.windshield_notes),
          ('Cubiertas (Inspección RTO)',               v_insp.tires_state,           v_insp.tires_notes),
          ('Frenos (Inspección RTO)',                  v_insp.brakes_state,          v_insp.brakes_notes),
          ('Suspensión (Inspección RTO)',              v_insp.suspension_state,      v_insp.suspension_notes),
          ('Luces (Inspección RTO)',                   v_insp.lights_state,          v_insp.lights_notes),
          ('Cinturones de seguridad (Inspección RTO)', v_insp.seatbelts_state,       v_insp.seatbelts_notes),
          ('Elementos de seguridad (Inspección RTO)',  v_insp.safety_elements_state, v_insp.safety_elements_notes),
          ('Documentación (Inspección RTO)',           v_insp.documentation_state,   v_insp.documentation_notes)
      ) as t(title, st, notes)
      where t.st in ('reparar', 'observacion')
    loop
      v_priority := case when v_item.st = 'reparar' then 'alta'::public.pending_priority else 'media'::public.pending_priority end;

      insert into public.pending_tasks (
        vehicle_id, detected_at, task_title, description,
        priority, status, responsible, estimated_resolution_at, observations
      )
      values (
        v_insp.vehicle_id,
        v_insp.inspected_at,
        v_item.title,
        coalesce(v_item.notes, 'Detectado en inspección previa a RTO'),
        v_priority,
        'pendiente',
        v_insp.inspector_name,
        coalesce(v_insp.rto_due_date, v_insp.rto_provincial_due_date),
        'Generado automáticamente desde Inspección Preventiva / RTO'
      );

      v_count := v_count + 1;
    end loop;

    if v_count > 0 then
      update public.preventive_inspections
         set generated_pending_count = v_count
       where id = v_insp.id;
    end if;
  end if;

  return jsonb_build_object(
    'inspection_id', v_insp.id,
    'ready_for_rto', v_insp.overall_ready_for_rto,
    'generated_pendings', v_count
  );
end;
$$;
