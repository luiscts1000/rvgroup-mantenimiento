-- =============================================================================
-- Migración 0006: ETAPA 4 – Pendientes Generales y Turnos con Proveedores Externos
-- =============================================================================

do $$ begin
  create type public.pending_priority as enum ('baja', 'media', 'alta', 'urgente');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pending_status as enum (
    'pendiente',
    'en_gestion',
    'turno_solicitado',
    'turno_confirmado',
    'en_taller',
    'pendiente_repuestos',
    'reparado',
    'cerrado'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.appointment_status as enum (
    'a_gestionar',
    'solicitado',
    'confirmado',
    'reprogramado',
    'cancelado',
    'realizado'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Tabla de Pendientes Generales (NUNCA se eliminan al solucionarse)
-- -----------------------------------------------------------------------------
create table if not exists public.pending_tasks (
  id                       uuid primary key default gen_random_uuid(),
  vehicle_id               uuid not null references public.vehicles (id) on delete restrict,
  patente                  text not null,
  nro_interno              text,
  vehicle_label            text,
  detected_at              date not null default current_date,
  task_title               text not null, -- Ej.: Cambio de parabrisas, Reparación de aire acondicionado…
  description              text,
  priority                 public.pending_priority not null default 'media',
  status                   public.pending_status not null default 'pendiente',
  responsible              text,
  estimated_resolution_at  date,
  resolved_at              timestamptz,
  closed_at                timestamptz,
  -- Datos rápidos de turno reflejados en la fila del tablero
  has_appointment          boolean not null default false,
  appointment_date         date,
  appointment_time         text,
  provider_name            text,
  observations             text,
  work_order_id            uuid references public.work_orders (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references public.profiles (id),
  updated_by               uuid references public.profiles (id)
);

create index if not exists idx_pending_vehicle on public.pending_tasks (vehicle_id);
create index if not exists idx_pending_status on public.pending_tasks (status);
create index if not exists idx_pending_priority on public.pending_tasks (priority);
create index if not exists idx_pending_detected on public.pending_tasks (detected_at desc);

-- Archivos adjuntos (fotos y comprobantes) de un pendiente
create table if not exists public.pending_task_attachments (
  id               uuid primary key default gen_random_uuid(),
  pending_task_id  uuid not null references public.pending_tasks (id) on delete cascade,
  storage_path     text not null,
  file_name        text not null,
  mime_type        text,
  kind             text not null default 'foto', -- 'foto' | 'comprobante'
  caption          text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id),
  created_by_email text
);

create index if not exists idx_pta_pending on public.pending_task_attachments (pending_task_id);

-- -----------------------------------------------------------------------------
-- Tabla de Turnos y Proveedores Externos
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references public.vehicles (id) on delete restrict,
  patente           text not null,
  nro_interno       text,
  vehicle_label     text,
  reason            text not null,
  provider_name     text not null,
  address           text,
  appointment_date  date not null,
  appointment_time  text,
  responsible       text,
  phone             text,
  observations      text,
  status            public.appointment_status not null default 'a_gestionar',
  receipt_path      text,
  receipt_name      text,
  pending_task_id   uuid references public.pending_tasks (id) on delete set null,
  work_order_id     uuid references public.work_orders (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles (id),
  updated_by        uuid references public.profiles (id)
);

create index if not exists idx_appt_date on public.appointments (appointment_date, appointment_time);
create index if not exists idx_appt_vehicle on public.appointments (vehicle_id);
create index if not exists idx_appt_pending on public.appointments (pending_task_id);
create index if not exists idx_appt_status on public.appointments (status);

-- -----------------------------------------------------------------------------
-- Triggers de sincronización de datos de unidad y vínculo Turno <-> Pendiente
-- -----------------------------------------------------------------------------
create or replace function public.pending_tasks_before_write()
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
  new.has_appointment := (new.appointment_date is not null or nullif(trim(coalesce(new.provider_name, '')), '') is not null or new.status in ('turno_solicitado', 'turno_confirmado'));

  if new.status = 'reparado' and (tg_op = 'INSERT' or old.status is distinct from 'reparado') then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  if new.status = 'cerrado' and (tg_op = 'INSERT' or old.status is distinct from 'cerrado') then
    new.resolved_at := coalesce(new.resolved_at, now());
    new.closed_at   := coalesce(new.closed_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pending_before_write on public.pending_tasks;
create trigger trg_pending_before_write before insert or update on public.pending_tasks
  for each row execute function public.pending_tasks_before_write();

drop trigger if exists trg_pending_audit_cols on public.pending_tasks;
create trigger trg_pending_audit_cols before insert or update on public.pending_tasks
  for each row execute function public.set_audit_columns();

drop trigger if exists audit_pending_tasks on public.pending_tasks;
create trigger audit_pending_tasks after insert or update or delete on public.pending_tasks
  for each row execute function public.audit_trigger();

create or replace function public.appointments_before_write()
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
  return new;
end;
$$;

drop trigger if exists trg_appt_before_write on public.appointments;
create trigger trg_appt_before_write before insert or update on public.appointments
  for each row execute function public.appointments_before_write();

drop trigger if exists trg_appt_audit_cols on public.appointments;
create trigger trg_appt_audit_cols before insert or update on public.appointments
  for each row execute function public.set_audit_columns();

drop trigger if exists audit_appointments on public.appointments;
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function public.audit_trigger();

-- Cuando se crea o actualiza un turno vinculado a un pendiente, refleja fecha, taller y estado en la fila del pendiente
create or replace function public.appointments_sync_pending()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.pending_task_id is not null then
    update public.pending_tasks
       set has_appointment  = (new.status <> 'cancelado'),
           appointment_date = case when new.status = 'cancelado' then null else new.appointment_date end,
           appointment_time = case when new.status = 'cancelado' then null else new.appointment_time end,
           provider_name    = case when new.status = 'cancelado' then provider_name else new.provider_name end,
           status = case
             when status in ('reparado', 'cerrado') then status
             when new.status = 'realizado' then 'reparado'::public.pending_status
             when new.status = 'confirmado' then 'turno_confirmado'::public.pending_status
             when new.status in ('solicitado', 'reprogramado') then 'turno_solicitado'::public.pending_status
             when new.status = 'a_gestionar' and status = 'pendiente' then 'en_gestion'::public.pending_status
             else status
           end
     where id = new.pending_task_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_appt_sync_pending on public.appointments;
create trigger trg_appt_sync_pending after insert or update on public.appointments
  for each row execute function public.appointments_sync_pending();

-- -----------------------------------------------------------------------------
-- Conversión de un Pendiente en Orden de Reparación (vinculados, sin duplicar)
-- -----------------------------------------------------------------------------
create or replace function public.convert_pending_to_work_order(p_pending_id uuid)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_p      public.pending_tasks%rowtype;
  v_wo_id  uuid;
begin
  if not public.has_permission('work_orders', 'create') and not public.has_permission('work_orders', 'edit') then
    raise exception 'No tiene permiso para generar órdenes de reparación';
  end if;

  select * into v_p from public.pending_tasks where id = p_pending_id for update;
  if not found then
    raise exception 'El pendiente seleccionado no existe';
  end if;

  -- Si ya tenía una OR vinculada, la devuelve directamente para evitar duplicación
  if v_p.work_order_id is not null then
    return v_p.work_order_id;
  end if;

  insert into public.work_orders (
    vehicle_id, patente, nro_interno, marca_modelo,
    maintenance_type, requester_name,
    failure_description, requested_work, observations, status
  )
  values (
    v_p.vehicle_id, v_p.patente, v_p.nro_interno, v_p.vehicle_label,
    case when lower(v_p.task_title) like '%rto%' then 'rto'::public.maintenance_type else 'correctivo'::public.maintenance_type end,
    v_p.responsible,
    v_p.description,
    v_p.task_title,
    v_p.observations,
    'abierta'
  )
  returning id into v_wo_id;

  update public.pending_tasks
     set work_order_id = v_wo_id,
         status = case when status in ('reparado', 'cerrado') then status else 'en_taller'::public.pending_status end
   where id = p_pending_id;

  -- Si había turnos vinculados a este pendiente, quedan también vinculados a la OR
  update public.appointments
     set work_order_id = v_wo_id
   where pending_task_id = p_pending_id and work_order_id is null;

  return v_wo_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Actualizar indicadores del Panel de Control y función de reseteo
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
  v_batches    int;
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
  select count(*) into v_batches from public.import_batches;

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
      'deleted_appointments', v_appts
    ),
    v_uid, v_email
  );

  return jsonb_build_object(
    'ok', true,
    'deleted_vehicles', v_vehicles,
    'deleted_work_orders', v_orders,
    'deleted_parts', v_parts,
    'deleted_pending_tasks', v_pending,
    'deleted_appointments', v_appts
  );
end;
$$;

revoke all on function public.admin_reset_system_data(text) from public, anon;
grant execute on function public.admin_reset_system_data(text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS (IMPORTANTE: sin política DELETE en pending_tasks para preservar el historial)
-- -----------------------------------------------------------------------------
alter table public.pending_tasks            enable row level security;
alter table public.pending_task_attachments enable row level security;
alter table public.appointments             enable row level security;

drop policy if exists pt_select on public.pending_tasks;
create policy pt_select on public.pending_tasks for select to authenticated
  using (public.has_permission('pending', 'view') or public.has_permission('vehicles', 'view'));
drop policy if exists pt_insert on public.pending_tasks;
create policy pt_insert on public.pending_tasks for insert to authenticated
  with check (public.has_permission('pending', 'create') or public.has_permission('pending', 'edit'));
drop policy if exists pt_update on public.pending_tasks;
create policy pt_update on public.pending_tasks for update to authenticated
  using (public.has_permission('pending', 'edit') or public.has_permission('pending', 'create'))
  with check (public.has_permission('pending', 'edit') or public.has_permission('pending', 'create'));
-- Sin política DELETE en pending_tasks: los pendientes nunca se borran cuando se solucionan.

drop policy if exists pta_select on public.pending_task_attachments;
create policy pta_select on public.pending_task_attachments for select to authenticated
  using (public.has_permission('pending', 'view'));
drop policy if exists pta_insert on public.pending_task_attachments;
create policy pta_insert on public.pending_task_attachments for insert to authenticated
  with check (public.has_permission('pending', 'edit') or public.has_permission('pending', 'create'));
drop policy if exists pta_delete on public.pending_task_attachments;
create policy pta_delete on public.pending_task_attachments for delete to authenticated
  using (public.has_permission('pending', 'edit'));

drop policy if exists appt_select on public.appointments;
create policy appt_select on public.appointments for select to authenticated
  using (public.has_permission('appointments', 'view') or public.has_permission('pending', 'view'));
drop policy if exists appt_insert on public.appointments;
create policy appt_insert on public.appointments for insert to authenticated
  with check (public.has_permission('appointments', 'create') or public.has_permission('appointments', 'edit'));
drop policy if exists appt_update on public.appointments;
create policy appt_update on public.appointments for update to authenticated
  using (public.has_permission('appointments', 'edit') or public.has_permission('appointments', 'create'))
  with check (public.has_permission('appointments', 'edit') or public.has_permission('appointments', 'create'));
drop policy if exists appt_delete on public.appointments;
create policy appt_delete on public.appointments for delete to authenticated
  using (public.has_permission('appointments', 'delete'));

-- Permitir adjuntos y comprobantes de pendientes y turnos en el bucket work-orders
drop policy if exists wo_storage_select on storage.objects;
create policy wo_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'work-orders'
    and (
      public.has_permission('work_orders', 'view')
      or public.has_permission('pending', 'view')
      or public.has_permission('appointments', 'view')
    )
  );

drop policy if exists wo_storage_insert on storage.objects;
create policy wo_storage_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'work-orders'
    and (
      public.has_permission('work_orders', 'edit')
      or public.has_permission('pending', 'edit')
      or public.has_permission('pending', 'create')
      or public.has_permission('appointments', 'edit')
      or public.has_permission('appointments', 'create')
    )
  );

-- Tiempo real
do $$ begin
  alter publication supabase_realtime add table public.pending_tasks;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.appointments;
exception when others then null; end $$;
