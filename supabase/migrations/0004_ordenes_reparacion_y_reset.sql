-- =============================================================================
-- Migración 0004: ETAPA 2 – Órdenes de Reparación (OR), fotografías y PDF
-- + Función de reseteo de datos de prueba (solo Administrador con contraseña)
-- =============================================================================

do $$ begin
  create type public.work_order_status as enum (
    'abierta',
    'asignada',
    'en_proceso',
    'pendiente_repuestos',
    'pendiente_autorizacion',
    'finalizada',
    'cerrada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.maintenance_type as enum (
    'preventivo',
    'correctivo',
    'emergencia',
    'rto',
    'otro'
  );
exception when duplicate_object then null; end $$;

-- Secuencia correlativa para número de OR
create sequence if not exists public.work_order_number_seq start 1;

-- -----------------------------------------------------------------------------
-- Órdenes de reparación
-- -----------------------------------------------------------------------------
create table if not exists public.work_orders (
  id                     uuid primary key default gen_random_uuid(),
  order_number           int  not null unique default nextval('public.work_order_number_seq'),
  opened_at              timestamptz not null default now(),
  closed_at              timestamptz,
  vehicle_id             uuid not null references public.vehicles (id) on delete restrict,
  -- Copia de referencia de la unidad al momento de la apertura
  patente                text not null,
  nro_interno            text,
  marca_modelo           text,
  kilometraje            int  check (kilometraje is null or kilometraje >= 0),
  maintenance_type       public.maintenance_type not null default 'correctivo',
  requester_name         text,
  mechanic_id            uuid references public.profiles (id) on delete set null,
  mechanic_name          text,
  failure_description    text,
  requested_work         text,
  diagnosis              text,
  work_performed         text,
  oil_type               text,
  oil_liters             numeric(10, 2) check (oil_liters is null or oil_liters >= 0),
  other_fluids           text,
  labor_detail           text,
  labor_hours            numeric(10, 2) check (labor_hours is null or labor_hours >= 0),
  labor_cost             numeric(12, 2) check (labor_cost is null or labor_cost >= 0),
  observations           text,
  status                 public.work_order_status not null default 'abierta',
  approved_by            uuid references public.profiles (id) on delete set null,
  approved_by_name       text,
  approved_at            timestamptz,
  pdf_path               text,
  is_demo                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.profiles (id),
  updated_by             uuid references public.profiles (id)
);

create index if not exists idx_wo_vehicle on public.work_orders (vehicle_id);
create index if not exists idx_wo_status on public.work_orders (status);
create index if not exists idx_wo_mechanic on public.work_orders (mechanic_id);
create index if not exists idx_wo_opened on public.work_orders (opened_at desc);

-- -----------------------------------------------------------------------------
-- Repuestos / insumos utilizados en la OR
-- (En Etapa 3 se vinculará opcionalmente con el catálogo de inventario `part_id`)
-- -----------------------------------------------------------------------------
create table if not exists public.work_order_items (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  part_code      text,
  description    text not null,
  quantity       numeric(10, 2) not null default 1 check (quantity > 0),
  unit           text not null default 'un.',
  unit_cost      numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  sort_order     int  not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles (id)
);

create index if not exists idx_wo_items_order on public.work_order_items (work_order_id);

-- -----------------------------------------------------------------------------
-- Fotografías adjuntas a la OR (almacenadas en Supabase Storage)
-- -----------------------------------------------------------------------------
create table if not exists public.work_order_photos (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  storage_path   text not null,
  caption        text,
  stage          text default 'reparacion', -- ingreso | diagnostico | reparacion | entrega
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles (id),
  created_by_email text
);

create index if not exists idx_wo_photos_order on public.work_order_photos (work_order_id);

-- -----------------------------------------------------------------------------
-- Historial de estados de cada OR
-- -----------------------------------------------------------------------------
create table if not exists public.work_order_status_history (
  id             bigint generated always as identity primary key,
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  from_status    public.work_order_status,
  to_status      public.work_order_status not null,
  note           text,
  user_id        uuid,
  user_email     text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_wo_hist_order on public.work_order_status_history (work_order_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Reglas automáticas al guardar una OR
-- -----------------------------------------------------------------------------
create or replace function public.work_orders_before_write()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_veh record;
  v_role public.app_role;
  v_name text;
begin
  -- Completar datos desde la unidad
  select patente, nro_interno,
         trim(concat_ws(' ', marca, modelo, version)) as mm,
         km_actual
    into v_veh
    from public.vehicles where id = new.vehicle_id;

  if not found then
    raise exception 'La unidad seleccionada no existe';
  end if;

  new.patente      := v_veh.patente;
  new.nro_interno  := coalesce(nullif(trim(new.nro_interno), ''), v_veh.nro_interno);
  new.marca_modelo := coalesce(nullif(trim(new.marca_modelo), ''), nullif(v_veh.mm, ''));

  if new.mechanic_id is not null and (tg_op = 'INSERT' or new.mechanic_id is distinct from old.mechanic_id) then
    select coalesce(nullif(full_name, ''), email) into new.mechanic_name
      from public.profiles where id = new.mechanic_id;
  elsif new.mechanic_id is null then
    new.mechanic_name := nullif(trim(new.mechanic_name), '');
  end if;

  -- Si se asigna mecánico y estaba abierta, pasa a asignada
  if tg_op = 'INSERT' and new.status = 'abierta' and (new.mechanic_id is not null or new.mechanic_name is not null) then
    new.status := 'asignada';
  end if;

  -- Control de cierre: un mecánico puede marcar "finalizada", pero solo quien tiene
  -- permiso de creación/administración en OR (responsable/admin) puede aprobar el "cerrada".
  if auth.uid() is not null then
    select role, coalesce(nullif(full_name, ''), email) into v_role, v_name
      from public.profiles where id = auth.uid();

    if new.status = 'cerrada' and (tg_op = 'INSERT' or old.status is distinct from 'cerrada') then
      if v_role = 'mecanico' and not public.has_permission('work_orders', 'create') then
        raise exception 'El cierre definitivo de la orden debe ser aprobado por el responsable de mantenimiento';
      end if;
      new.closed_at        := coalesce(new.closed_at, now());
      new.approved_by      := auth.uid();
      new.approved_by_name := v_name;
      new.approved_at      := now();
    end if;

    if new.status = 'finalizada' and (tg_op = 'INSERT' or old.status is distinct from 'finalizada') then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_wo_before_write on public.work_orders;
create trigger trg_wo_before_write before insert or update on public.work_orders
  for each row execute function public.work_orders_before_write();

drop trigger if exists trg_wo_audit_cols on public.work_orders;
create trigger trg_wo_audit_cols before insert or update on public.work_orders
  for each row execute function public.set_audit_columns();

-- Después de guardar: registrar cambio de estado y actualizar km de la unidad si es mayor
create or replace function public.work_orders_after_write()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_email text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    select email into v_email from public.profiles where id = auth.uid();
    insert into public.work_order_status_history (work_order_id, from_status, to_status, user_id, user_email)
    values (new.id, case when tg_op = 'UPDATE' then old.status else null end, new.status, auth.uid(), v_email);
  end if;

  if new.kilometraje is not null then
    update public.vehicles
       set km_actual = greatest(coalesce(km_actual, 0), new.kilometraje)
     where id = new.vehicle_id
       and (km_actual is null or new.kilometraje > km_actual);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_wo_after_write on public.work_orders;
create trigger trg_wo_after_write after insert or update on public.work_orders
  for each row execute function public.work_orders_after_write();

-- Auditoría
drop trigger if exists audit_work_orders on public.work_orders;
create trigger audit_work_orders after insert or update or delete on public.work_orders
  for each row execute function public.audit_trigger();

-- Permitir ver auditoría de OR a quienes ven OR
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (
    public.is_admin()
    or (table_name = 'vehicles' and public.has_permission('vehicles', 'view'))
    or (table_name = 'work_orders' and public.has_permission('work_orders', 'view'))
  );

-- -----------------------------------------------------------------------------
-- Actualizar indicadores del panel con métricas reales de OR
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_fleet_stats()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'total',             (select count(*) from public.vehicles where status <> 'baja'),
    'operativo',         (select count(*) from public.vehicles where status = 'operativo'),
    'fuera_de_servicio', (select count(*) from public.vehicles where status = 'fuera_de_servicio'),
    'en_taller',         (select count(*) from public.vehicles where status = 'en_taller'),
    'baja',              (select count(*) from public.vehicles where status = 'baja'),
    'demo',              (select count(*) from public.vehicles where is_demo),
    'wo_open',           (select count(*) from public.work_orders where status not in ('finalizada', 'cerrada')),
    'wo_finished',       (select count(*) from public.work_orders where status in ('finalizada', 'cerrada')),
    'wo_pending_approval',(select count(*) from public.work_orders where status in ('finalizada', 'pendiente_autorizacion')),
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

-- -----------------------------------------------------------------------------
-- RLS para Órdenes de reparación
-- -----------------------------------------------------------------------------
alter table public.work_orders                enable row level security;
alter table public.work_order_items           enable row level security;
alter table public.work_order_photos          enable row level security;
alter table public.work_order_status_history  enable row level security;

drop policy if exists wo_select on public.work_orders;
create policy wo_select on public.work_orders for select to authenticated
  using (public.has_permission('work_orders', 'view'));

drop policy if exists wo_insert on public.work_orders;
create policy wo_insert on public.work_orders for insert to authenticated
  with check (public.has_permission('work_orders', 'create') or public.has_permission('work_orders', 'edit'));

drop policy if exists wo_update on public.work_orders;
create policy wo_update on public.work_orders for update to authenticated
  using (
    public.has_permission('work_orders', 'edit')
    and (
      public.current_app_role() <> 'mecanico'
      or mechanic_id = auth.uid()
      or mechanic_id is null
    )
  )
  with check (public.has_permission('work_orders', 'edit'));

drop policy if exists wo_delete on public.work_orders;
create policy wo_delete on public.work_orders for delete to authenticated
  using (public.has_permission('work_orders', 'delete'));

-- Items
drop policy if exists woi_select on public.work_order_items;
create policy woi_select on public.work_order_items for select to authenticated
  using (public.has_permission('work_orders', 'view'));
drop policy if exists woi_write on public.work_order_items;
create policy woi_write on public.work_order_items for all to authenticated
  using (public.has_permission('work_orders', 'edit'))
  with check (public.has_permission('work_orders', 'edit'));

-- Photos
drop policy if exists wop_select on public.work_order_photos;
create policy wop_select on public.work_order_photos for select to authenticated
  using (public.has_permission('work_orders', 'view'));
drop policy if exists wop_insert on public.work_order_photos;
create policy wop_insert on public.work_order_photos for insert to authenticated
  with check (public.has_permission('work_orders', 'edit'));
drop policy if exists wop_delete on public.work_order_photos;
create policy wop_delete on public.work_order_photos for delete to authenticated
  using (public.has_permission('work_orders', 'edit'));

-- Historial de estados
drop policy if exists woh_select on public.work_order_status_history;
create policy woh_select on public.work_order_status_history for select to authenticated
  using (public.has_permission('work_orders', 'view'));

-- -----------------------------------------------------------------------------
-- Bucket de Storage para fotografías y PDFs de órdenes de reparación
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-orders',
  'work-orders',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists wo_storage_select on storage.objects;
create policy wo_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'work-orders' and public.has_permission('work_orders', 'view'));

drop policy if exists wo_storage_insert on storage.objects;
create policy wo_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'work-orders' and public.has_permission('work_orders', 'edit'));

drop policy if exists wo_storage_update on storage.objects;
create policy wo_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'work-orders' and public.has_permission('work_orders', 'edit'))
  with check (bucket_id = 'work-orders' and public.has_permission('work_orders', 'edit'));

drop policy if exists wo_storage_delete on storage.objects;
create policy wo_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'work-orders' and public.has_permission('work_orders', 'edit'));

-- -----------------------------------------------------------------------------
-- Tiempo real para OR
-- -----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.work_orders;
exception when others then null; end $$;

-- -----------------------------------------------------------------------------
-- RESETEO COMPLETO DE DATOS DE PRUEBA (exclusivo Administrador + contraseña)
-- Borra órdenes, fotos (registros), unidades, lotes de importación y auditoría.
-- Conserva usuarios, permisos y las 8 categorías iniciales de RV Group.
-- -----------------------------------------------------------------------------
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
  v_batches    int;
begin
  if v_uid is null then
    raise exception 'Sesión inválida';
  end if;

  select role, email into v_role, v_email
    from public.profiles where id = v_uid and active = true;

  if v_role is distinct from 'admin' then
    raise exception 'Solo un usuario con rol Administrador puede resetear los datos';
  end if;

  if coalesce(p_admin_password, '') = '' then
    raise exception 'Debe ingresar su contraseña de administrador';
  end if;

  select encrypted_password into v_enc_pw
    from auth.users where id = v_uid;

  if v_enc_pw is null or v_enc_pw <> crypt(p_admin_password, v_enc_pw) then
    raise exception 'Contraseña de administrador incorrecta';
  end if;

  select count(*) into v_orders from public.work_orders;
  select count(*) into v_vehicles from public.vehicles;
  select count(*) into v_batches from public.import_batches;

  -- Desactivar triggers de auditoría durante el vaciado
  delete from public.work_order_photos;
  delete from public.work_order_items;
  delete from public.work_order_status_history;
  delete from public.work_orders;
  alter sequence public.work_order_number_seq restart with 1;

  delete from public.vehicles;
  delete from public.import_batches;
  delete from public.audit_log;

  -- Dejar constancia del reseteo en el registro de auditoría limpio
  insert into public.audit_log (table_name, record_id, action, new_data, user_id, user_email)
  values (
    'system',
    'reset',
    'DELETE',
    jsonb_build_object(
      'event', 'RESETEO_DATOS_PRUEBA',
      'deleted_vehicles', v_vehicles,
      'deleted_work_orders', v_orders,
      'deleted_import_batches', v_batches
    ),
    v_uid,
    v_email
  );

  return jsonb_build_object(
    'ok', true,
    'deleted_vehicles', v_vehicles,
    'deleted_work_orders', v_orders,
    'deleted_import_batches', v_batches
  );
end;
$$;

revoke all on function public.admin_reset_system_data(text) from public, anon;
grant execute on function public.admin_reset_system_data(text) to authenticated;
