-- =============================================================================
-- Migración 0007: ETAPA 5 – Control Preventivo, Vencimientos de RTO e Inspecciones
-- =============================================================================

do $$ begin
  create type public.check_item_state as enum ('ok', 'observacion', 'reparar', 'no_aplica');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Agregar fecha de vencimiento de RTO y parámetros preventivos en cada unidad
-- -----------------------------------------------------------------------------
alter table public.vehicles
  add column if not exists rto_due_date date,
  add column if not exists service_interval_km int default 10000 check (service_interval_km is null or service_interval_km > 0),
  add column if not exists last_service_km int check (last_service_km is null or last_service_km >= 0),
  add column if not exists last_service_date date;

create index if not exists idx_vehicles_rto_due on public.vehicles (rto_due_date);

-- -----------------------------------------------------------------------------
-- Inspecciones preventivas / previas a RTO
-- -----------------------------------------------------------------------------
create table if not exists public.preventive_inspections (
  id                       uuid primary key default gen_random_uuid(),
  vehicle_id               uuid not null references public.vehicles (id) on delete restrict,
  patente                  text not null,
  nro_interno              text,
  vehicle_label            text,
  inspected_at             date not null default current_date,
  inspector_name           text,
  kilometraje              int check (kilometraje is null or kilometraje >= 0),
  rto_due_date             date,
  -- 8 rubros solicitados para el control general y previo a RTO
  windshield_state         public.check_item_state not null default 'ok',
  windshield_notes         text,
  tires_state              public.check_item_state not null default 'ok',
  tires_notes              text,
  brakes_state             public.check_item_state not null default 'ok',
  brakes_notes             text,
  suspension_state         public.check_item_state not null default 'ok',
  suspension_notes         text,
  lights_state             public.check_item_state not null default 'ok',
  lights_notes             text,
  seatbelts_state          public.check_item_state not null default 'ok',
  seatbelts_notes          text,
  safety_elements_state    public.check_item_state not null default 'ok',
  safety_elements_notes    text,
  documentation_state      public.check_item_state not null default 'ok',
  documentation_notes      text,
  overall_ready_for_rto    boolean not null default true,
  observations             text,
  generated_pending_count  int not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references public.profiles (id),
  updated_by               uuid references public.profiles (id)
);

create index if not exists idx_prev_insp_vehicle on public.preventive_inspections (vehicle_id, inspected_at desc);
create index if not exists idx_prev_insp_date on public.preventive_inspections (inspected_at desc);

create or replace function public.preventive_inspections_before_write()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_veh record;
begin
  select patente, nro_interno, trim(concat_ws(' ', marca, modelo, version)) as label
    into v_veh from public.vehicles where id = new.vehicle_id;

  if not found then raise exception 'La unidad seleccionada no existe'; end if;

  new.patente       := v_veh.patente;
  new.nro_interno   := coalesce(nullif(trim(new.nro_interno), ''), v_veh.nro_interno);
  new.vehicle_label := coalesce(nullif(trim(new.vehicle_label), ''), nullif(v_veh.label, ''));

  -- Una unidad está lista para presentarse a RTO si ningún punto tiene estado "reparar"
  new.overall_ready_for_rto := not (
    new.windshield_state = 'reparar'
    or new.tires_state = 'reparar'
    or new.brakes_state = 'reparar'
    or new.suspension_state = 'reparar'
    or new.lights_state = 'reparar'
    or new.seatbelts_state = 'reparar'
    or new.safety_elements_state = 'reparar'
    or new.documentation_state = 'reparar'
  );

  return new;
end;
$$;

drop trigger if exists trg_prev_insp_before_write on public.preventive_inspections;
create trigger trg_prev_insp_before_write before insert or update on public.preventive_inspections
  for each row execute function public.preventive_inspections_before_write();

drop trigger if exists trg_prev_insp_audit_cols on public.preventive_inspections;
create trigger trg_prev_insp_audit_cols before insert or update on public.preventive_inspections
  for each row execute function public.set_audit_columns();

-- Al guardar una inspección, actualiza en la unidad la fecha de RTO y el kilometraje si corresponde
create or replace function public.preventive_inspections_after_write()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.vehicles
     set rto_due_date = coalesce(new.rto_due_date, rto_due_date),
         km_actual    = case
                          when new.kilometraje is not null and (km_actual is null or new.kilometraje > km_actual)
                          then new.kilometraje
                          else km_actual
                        end
   where id = new.vehicle_id;
  return new;
end;
$$;

drop trigger if exists trg_prev_insp_after_write on public.preventive_inspections;
create trigger trg_prev_insp_after_write after insert or update on public.preventive_inspections
  for each row execute function public.preventive_inspections_after_write();

drop trigger if exists audit_preventive_inspections on public.preventive_inspections;
create trigger audit_preventive_inspections after insert or update or delete on public.preventive_inspections
  for each row execute function public.audit_trigger();

-- -----------------------------------------------------------------------------
-- Registra una inspección y genera automáticamente pendientes por cada problema detectado
-- -----------------------------------------------------------------------------
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
    vehicle_id, inspected_at, inspector_name, kilometraje, rto_due_date,
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
          ('Parabrisas (Inspección RTO)',           v_insp.windshield_state,      v_insp.windshield_notes),
          ('Cubiertas (Inspección RTO)',            v_insp.tires_state,           v_insp.tires_notes),
          ('Frenos (Inspección RTO)',               v_insp.brakes_state,          v_insp.brakes_notes),
          ('Suspensión (Inspección RTO)',           v_insp.suspension_state,      v_insp.suspension_notes),
          ('Luces (Inspección RTO)',                v_insp.lights_state,          v_insp.lights_notes),
          ('Cinturones de seguridad (Inspección RTO)', v_insp.seatbelts_state,    v_insp.seatbelts_notes),
          ('Elementos de seguridad (Inspección RTO)',  v_insp.safety_elements_state, v_insp.safety_elements_notes),
          ('Documentación (Inspección RTO)',        v_insp.documentation_state,   v_insp.documentation_notes)
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
        v_insp.rto_due_date,
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

-- -----------------------------------------------------------------------------
-- Actualizar Panel de Control con indicadores de RTO y Alertas de Mantenimiento
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_fleet_stats()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'total',                 (select count(*) from public.vehicles where status <> 'baja'),
    'operativo',             (select count(*) from public.vehicles where status = 'operativo'),
    'fuera_de_servicio',     (select count(*) from public.vehicles where status = 'fuera_de_servicio'),
    'en_taller',             (select count(*) from public.vehicles where status = 'en_taller'),
    'baja',                  (select count(*) from public.vehicles where status = 'baja'),
    'demo',                  (select count(*) from public.vehicles where is_demo),
    'wo_open',               (select count(*) from public.work_orders where status not in ('finalizada', 'cerrada')),
    'wo_finished',           (select count(*) from public.work_orders where status in ('finalizada', 'cerrada')),
    'wo_pending_approval',   (select count(*) from public.work_orders where status in ('finalizada', 'pendiente_autorizacion')),
    'parts_total',           (select count(*) from public.parts where active = true),
    'parts_low_stock',       (select count(*) from public.parts where active = true and quantity <= min_stock),
    'pending_open',          (select count(*) from public.pending_tasks where status not in ('reparado', 'cerrado')),
    'pending_urgent',        (select count(*) from public.pending_tasks where status not in ('reparado', 'cerrado') and priority in ('alta', 'urgente')),
    'appointments_upcoming', (select count(*) from public.appointments where status not in ('cancelado', 'realizado') and appointment_date >= current_date),
    -- Unidades con RTO vencida o que vence en los próximos 30 días
    'rto_due_soon',          (select count(*) from public.vehicles where status <> 'baja' and rto_due_date is not null and rto_due_date <= current_date + 30),
    'rto_expired',           (select count(*) from public.vehicles where status <> 'baja' and rto_due_date is not null and rto_due_date < current_date),
    -- Alertas de mantenimiento: RTO vencida/próxima + service preventivo por km vencido/próximo (a 1.000 km) + última inspección no apta RTO
    'maintenance_alerts',    (
      select count(*) from public.vehicles v
      where v.status <> 'baja'
        and (
          (v.rto_due_date is not null and v.rto_due_date <= current_date + 30)
          or (v.km_actual is not null and v.last_service_km is not null and v.service_interval_km is not null
              and (v.km_actual - v.last_service_km) >= (v.service_interval_km - 1000))
          or exists (
            select 1 from public.preventive_inspections pi
            where pi.vehicle_id = v.id
              and pi.id = (select id from public.preventive_inspections where vehicle_id = v.id order by inspected_at desc, created_at desc limit 1)
              and pi.overall_ready_for_rto = false
          )
        )
    ),
    'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'count', cnt) order by cnt desc)
        from (select coalesce(c.name, 'Sin categoría') as name, count(*) as cnt
              from public.vehicles v left join public.vehicle_categories c on c.id = v.category_id
              where v.status <> 'baja' group by 1) s), '[]'::jsonb),
    'by_type', coalesce((
        select jsonb_agg(jsonb_build_object('name', name, 'count', cnt) order by cnt desc)
        from (select coalesce(nullif(vehicle_type, ''), 'Sin tipo') as name, count(*) as cnt
              from public.vehicles where status <> 'baja' group by 1) s), '[]'::jsonb)
  );
$$;

-- Incluir inspecciones en el reseteo de administrador
create or replace function public.admin_reset_system_data(p_admin_password text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_uid        uuid := auth.uid();
  v_role       public.app_role;
  v_email      text;
  v_enc_pw     text;
  v_vehicles   int;
  v_orders     int;
  v_parts      int;
  v_pending    int;
  v_appts      int;
  v_insps      int;
begin
  if v_uid is null then raise exception 'Sesión inválida'; end if;

  select role, email into v_role, v_email from public.profiles where id = v_uid and active = true;
  if v_role is distinct from 'admin' then
    raise exception 'Solo un usuario con rol Administrador puede resetear los datos';
  end if;
  if coalesce(p_admin_password, '') = '' then
    raise exception 'Debe ingresar su contraseña de administrador';
  end if;

  select encrypted_password into v_enc_pw from auth.users where id = v_uid;
  if v_enc_pw is null or v_enc_pw <> crypt(p_admin_password, v_enc_pw) then
    raise exception 'Contraseña de administrador incorrecta';
  end if;

  select count(*) into v_orders from public.work_orders;
  select count(*) into v_vehicles from public.vehicles;
  select count(*) into v_parts from public.parts;
  select count(*) into v_pending from public.pending_tasks;
  select count(*) into v_appts from public.appointments;
  select count(*) into v_insps from public.preventive_inspections;

  delete from public.preventive_inspections;
  delete from public.appointments;
  delete from public.pending_task_attachments;
  delete from public.pending_tasks;

  delete from public.work_order_photos;
  delete from public.work_order_items;
  delete from public.work_order_status_history;
  delete from public.work_orders;
  alter sequence public.work_order_number_seq restart with 1;

  delete from public.service_template_items;
  delete from public.service_templates;
  delete from public.part_category_compatibility;
  delete from public.stock_movements;
  delete from public.parts;

  delete from public.vehicles;
  delete from public.import_batches;
  delete from public.audit_log;

  insert into public.audit_log (table_name, record_id, action, new_data, user_id, user_email)
  values (
    'system', 'reset', 'DELETE',
    jsonb_build_object(
      'event', 'RESETEO_DATOS_PRUEBA',
      'deleted_vehicles', v_vehicles,
      'deleted_work_orders', v_orders,
      'deleted_parts', v_parts,
      'deleted_pending_tasks', v_pending,
      'deleted_appointments', v_appts,
      'deleted_inspections', v_insps
    ),
    v_uid, v_email
  );

  return jsonb_build_object(
    'ok', true,
    'deleted_vehicles', v_vehicles,
    'deleted_work_orders', v_orders,
    'deleted_parts', v_parts,
    'deleted_pending_tasks', v_pending,
    'deleted_appointments', v_appts,
    'deleted_inspections', v_insps
  );
end;
$$;

revoke all on function public.admin_reset_system_data(text) from public, anon;
grant execute on function public.admin_reset_system_data(text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS para inspecciones
-- -----------------------------------------------------------------------------
alter table public.preventive_inspections enable row level security;

drop policy if exists pi_select on public.preventive_inspections;
create policy pi_select on public.preventive_inspections for select to authenticated
  using (public.has_permission('preventive', 'view') or public.has_permission('vehicles', 'view'));

drop policy if exists pi_insert on public.preventive_inspections;
create policy pi_insert on public.preventive_inspections for insert to authenticated
  with check (public.has_permission('preventive', 'create') or public.has_permission('preventive', 'edit'));

drop policy if exists pi_update on public.preventive_inspections;
create policy pi_update on public.preventive_inspections for update to authenticated
  using (public.has_permission('preventive', 'edit'))
  with check (public.has_permission('preventive', 'edit'));

-- Dar permiso al mecánico también para ver y cargar inspecciones previas
insert into public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_export)
values ('mecanico', 'preventive', true, true, true, false, false)
on conflict (role, module) do update
  set can_view = true, can_create = true, can_edit = true;

-- Tiempo real
do $$ begin
  alter publication supabase_realtime add table public.preventive_inspections;
exception when others then null; end $$;
