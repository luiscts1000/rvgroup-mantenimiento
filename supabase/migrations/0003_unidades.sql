-- =============================================================================
-- Migración 0003: Unidades de RV Group (flota), categorías e importación masiva
-- =============================================================================

do $$ begin
  create type public.vehicle_status as enum ('operativo', 'fuera_de_servicio', 'en_taller', 'baja');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------
create or replace function public.normalize_patente(p text)
returns text language sql immutable
as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), ''); $$;

create or replace function public.set_audit_columns()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Categorías de vehículos
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  brand       text,
  model       text,
  version     text,
  sort_order  int not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id)
);

-- Precarga de categorías iniciales solicitadas por RV Group
-- (solo nombre/marca/modelo/versión, sin datos técnicos inventados)
insert into public.vehicle_categories (name, brand, model, version, sort_order) values
  ('Ford Ranger 2.2',              'Ford',          'Ranger',   '2.2', 10),
  ('Ford Ranger 2.0',              'Ford',          'Ranger',   '2.0', 20),
  ('Mercedes-Benz Sprinter 414',   'Mercedes-Benz', 'Sprinter', '414', 30),
  ('Mercedes-Benz Sprinter 416',   'Mercedes-Benz', 'Sprinter', '416', 40),
  ('Mercedes-Benz Sprinter 515',   'Mercedes-Benz', 'Sprinter', '515', 50),
  ('Mercedes-Benz Sprinter 516',   'Mercedes-Benz', 'Sprinter', '516', 60),
  ('Mercedes-Benz Sprinter 517',   'Mercedes-Benz', 'Sprinter', '517', 70),
  ('Minibuses',                    null,            null,       null,  80)
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- Lotes de importación
-- -----------------------------------------------------------------------------
create table if not exists public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  entity          text not null default 'vehicles',
  file_name       text not null,
  column_mapping  jsonb,
  total_rows      int not null default 0,
  inserted        int not null default 0,
  skipped         int not null default 0,
  skipped_detail  jsonb,
  user_id         uuid references public.profiles (id) default auth.uid(),
  created_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Vehículos
-- -----------------------------------------------------------------------------
create table if not exists public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  registro_nro     text,
  patente          text not null,
  nro_interno      text,
  marca            text,
  modelo           text,
  version          text,
  anio             int check (anio is null or anio between 1950 and 2100),
  chasis           text,
  motor            text,
  km_actual        int check (km_actual is null or km_actual >= 0),
  vehicle_type     text,
  category_id      uuid references public.vehicle_categories (id) on delete set null,
  tire_type_size   text,
  tire_count       int check (tire_count is null or tire_count between 0 and 30),
  status           public.vehicle_status not null default 'operativo',
  observaciones    text,
  is_demo          boolean not null default false,
  import_batch_id  uuid references public.import_batches (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id),
  updated_by       uuid references public.profiles (id),
  constraint vehicles_patente_format check (patente = public.normalize_patente(patente) and length(patente) between 5 and 10)
);

-- La patente es la clave de negocio: imposible duplicarla
create unique index if not exists ux_vehicles_patente on public.vehicles (patente);
-- Número interno y chasis únicos cuando se informan (las bajas no bloquean el número interno)
create unique index if not exists ux_vehicles_nro_interno on public.vehicles (upper(nro_interno))
  where nro_interno is not null and status <> 'baja';
create unique index if not exists ux_vehicles_chasis on public.vehicles (upper(chasis)) where chasis is not null;
create index if not exists idx_vehicles_status on public.vehicles (status);
create index if not exists idx_vehicles_category on public.vehicles (category_id);

-- Normalización + reglas de negocio
create or replace function public.vehicles_before_write()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.patente      := public.normalize_patente(new.patente);
  new.nro_interno  := nullif(trim(new.nro_interno), '');
  new.chasis       := nullif(upper(trim(new.chasis)), '');
  new.motor        := nullif(upper(trim(new.motor)), '');
  new.registro_nro := nullif(trim(new.registro_nro), '');

  if tg_op = 'UPDATE' and auth.uid() is not null then
    -- Dar de baja una unidad requiere permiso de eliminación
    if new.status = 'baja' and old.status <> 'baja' and not public.has_permission('vehicles', 'delete') then
      raise exception 'No tiene permiso para dar de baja unidades';
    end if;
    -- El origen demo / lote no se modifica manualmente
    new.is_demo := old.is_demo;
    new.import_batch_id := old.import_batch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vehicles_before_write on public.vehicles;
create trigger trg_vehicles_before_write before insert or update on public.vehicles
  for each row execute function public.vehicles_before_write();

drop trigger if exists trg_vehicles_audit_cols on public.vehicles;
create trigger trg_vehicles_audit_cols before insert or update on public.vehicles
  for each row execute function public.set_audit_columns();

drop trigger if exists trg_categories_audit_cols on public.vehicle_categories;
create trigger trg_categories_audit_cols before insert or update on public.vehicle_categories
  for each row execute function public.set_audit_columns();

-- Auditoría
drop trigger if exists audit_vehicles on public.vehicles;
create trigger audit_vehicles after insert or update or delete on public.vehicles
  for each row execute function public.audit_trigger();

drop trigger if exists audit_vehicle_categories on public.vehicle_categories;
create trigger audit_vehicle_categories after insert or update or delete on public.vehicle_categories
  for each row execute function public.audit_trigger();

-- -----------------------------------------------------------------------------
-- Importación masiva (transaccional, sin duplicados aunque haya usuarios simultáneos)
-- p_rows: arreglo JSON con los campos de vehicles ya validados por la interfaz
-- -----------------------------------------------------------------------------
create or replace function public.import_vehicles(
  p_file_name text,
  p_mapping   jsonb,
  p_rows      jsonb,
  p_is_demo   boolean default false
)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_batch    uuid;
  v_total    int := jsonb_array_length(p_rows);
  v_inserted int;
  v_skipped  jsonb;
begin
  if not public.has_permission('vehicles', 'create') then
    raise exception 'No tiene permiso para importar unidades';
  end if;
  if v_total = 0 then
    raise exception 'No hay registros para importar';
  end if;
  if v_total > 5000 then
    raise exception 'Máximo 5000 registros por importación';
  end if;

  insert into public.import_batches (entity, file_name, column_mapping, total_rows)
  values ('vehicles', p_file_name, p_mapping, v_total)
  returning id into v_batch;

  insert into public.vehicles (registro_nro, patente, nro_interno, marca, modelo, version, anio, chasis, motor,
                               km_actual, vehicle_type, category_id, tire_type_size, tire_count, status,
                               observaciones, is_demo, import_batch_id)
  select r.registro_nro, r.patente, r.nro_interno, r.marca, r.modelo, r.version, r.anio, r.chasis, r.motor,
         r.km_actual, r.vehicle_type, r.category_id, r.tire_type_size, r.tire_count,
         coalesce(r.status, 'operativo'), r.observaciones, coalesce(p_is_demo, false), v_batch
  from jsonb_to_recordset(p_rows) as r(
    registro_nro text, patente text, nro_interno text, marca text, modelo text, version text, anio int,
    chasis text, motor text, km_actual int, vehicle_type text, category_id uuid, tire_type_size text,
    tire_count int, status public.vehicle_status, observaciones text)
  on conflict do nothing;  -- cualquier duplicado (patente, n° interno, chasis) se omite

  get diagnostics v_inserted = row_count;

  select coalesce(jsonb_agg(public.normalize_patente(e ->> 'patente')), '[]'::jsonb) into v_skipped
  from jsonb_array_elements(p_rows) e
  where not exists (select 1 from public.vehicles v
                    where v.patente = public.normalize_patente(e ->> 'patente') and v.import_batch_id = v_batch);

  update public.import_batches
     set inserted = v_inserted, skipped = v_total - v_inserted, skipped_detail = v_skipped
   where id = v_batch;

  return jsonb_build_object('batch_id', v_batch, 'total', v_total, 'inserted', v_inserted,
                            'skipped', v_total - v_inserted, 'skipped_patentes', v_skipped);
end;
$$;

-- -----------------------------------------------------------------------------
-- Indicadores del panel de control (etapa 1)
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
-- Eliminación de DATOS DE DEMOSTRACIÓN (solo administrador, solo is_demo = true)
-- -----------------------------------------------------------------------------
create or replace function public.delete_demo_data()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar los datos de demostración';
  end if;
  delete from public.vehicles where is_demo = true;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.vehicle_categories enable row level security;
alter table public.vehicles           enable row level security;
alter table public.import_batches     enable row level security;

drop policy if exists categories_select on public.vehicle_categories;
create policy categories_select on public.vehicle_categories for select to authenticated
  using (public.is_active_user());
drop policy if exists categories_insert on public.vehicle_categories;
create policy categories_insert on public.vehicle_categories for insert to authenticated
  with check (public.has_permission('settings', 'edit'));
drop policy if exists categories_update on public.vehicle_categories;
create policy categories_update on public.vehicle_categories for update to authenticated
  using (public.has_permission('settings', 'edit')) with check (public.has_permission('settings', 'edit'));

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated
  using (public.has_permission('vehicles', 'view'));
drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (public.has_permission('vehicles', 'create'));
drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.has_permission('vehicles', 'edit')) with check (public.has_permission('vehicles', 'edit'));
-- Sin política DELETE: las unidades se dan de baja (estado 'baja'), nunca se borran.

drop policy if exists batches_select on public.import_batches;
create policy batches_select on public.import_batches for select to authenticated
  using (public.has_permission('vehicles', 'view'));
drop policy if exists batches_insert on public.import_batches;
create policy batches_insert on public.import_batches for insert to authenticated
  with check (public.has_permission('vehicles', 'create'));
drop policy if exists batches_update on public.import_batches;
create policy batches_update on public.import_batches for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Tiempo real: los cambios se ven al instante en todos los dispositivos
-- -----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.vehicles;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.vehicle_categories;
exception when others then null; end $$;
