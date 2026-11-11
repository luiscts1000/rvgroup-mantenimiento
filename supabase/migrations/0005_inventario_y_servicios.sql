-- =============================================================================
-- Migración 0005: ETAPA 3 – Inventario, Movimientos de Stock y Servicios Predefinidos
-- =============================================================================

do $$ begin
  create type public.part_category as enum (
    'filtros',
    'aceites',
    'lubricantes',
    'liquidos',
    'frenos',
    'suspension',
    'repuestos_motor',
    'electricidad',
    'aire_acondicionado',
    'cubiertas',
    'baterias',
    'otros'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.stock_movement_type as enum (
    'ingreso',
    'egreso_or',
    'devolucion_or',
    'devolucion',
    'ajuste'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Catálogo de repuestos / insumos
-- -----------------------------------------------------------------------------
create table if not exists public.parts (
  id              uuid primary key default gen_random_uuid(),
  internal_code   text not null,
  original_code   text,
  description     text not null,
  category        public.part_category not null default 'otros',
  brand           text,
  compatibility_notes text,
  quantity        numeric(12, 2) not null default 0,
  min_stock       numeric(12, 2) not null default 0 check (min_stock >= 0),
  unit            text not null default 'un.',
  purchase_price  numeric(12, 2) check (purchase_price is null or purchase_price >= 0),
  supplier        text,
  location        text,
  active          boolean not null default true,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles (id),
  updated_by      uuid references public.profiles (id)
);

create unique index if not exists ux_parts_internal_code on public.parts (upper(trim(internal_code)));
create index if not exists idx_parts_category on public.parts (category);
create index if not exists idx_parts_active on public.parts (active);

create or replace function public.parts_before_write()
returns trigger language plpgsql
as $$
begin
  new.internal_code := upper(trim(new.internal_code));
  new.original_code := nullif(upper(trim(new.original_code)), '');
  new.description   := trim(new.description);
  return new;
end;
$$;

drop trigger if exists trg_parts_before_write on public.parts;
create trigger trg_parts_before_write before insert or update on public.parts
  for each row execute function public.parts_before_write();

drop trigger if exists trg_parts_audit_cols on public.parts;
create trigger trg_parts_audit_cols before insert or update on public.parts
  for each row execute function public.set_audit_columns();

drop trigger if exists audit_parts on public.parts;
create trigger audit_parts after insert or update or delete on public.parts
  for each row execute function public.audit_trigger();

-- Compatibilidad explícita entre un repuesto y categorías de vehículos
create table if not exists public.part_category_compatibility (
  part_id      uuid not null references public.parts (id) on delete cascade,
  category_id  uuid not null references public.vehicle_categories (id) on delete cascade,
  primary key (part_id, category_id)
);

-- -----------------------------------------------------------------------------
-- Movimientos de stock (fuente de verdad del inventario)
-- -----------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id                  bigint generated always as identity primary key,
  part_id             uuid not null references public.parts (id) on delete cascade,
  movement_type       public.stock_movement_type not null,
  quantity_delta      numeric(12, 2) not null check (quantity_delta <> 0),
  resulting_quantity  numeric(12, 2) not null,
  unit_cost           numeric(12, 2),
  work_order_id       uuid references public.work_orders (id) on delete set null,
  work_order_item_id  uuid,
  reason              text,
  user_id             uuid references public.profiles (id),
  user_email          text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_stock_mov_part on public.stock_movements (part_id, created_at desc);
create index if not exists idx_stock_mov_wo on public.stock_movements (work_order_id);

-- Función interna para aplicar una variación de stock y registrar el movimiento
create or replace function public.apply_stock_delta(
  p_part_id            uuid,
  p_type               public.stock_movement_type,
  p_delta              numeric,
  p_unit_cost          numeric default null,
  p_work_order_id      uuid default null,
  p_work_order_item_id uuid default null,
  p_reason             text default null
)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_new_qty numeric;
  v_email   text;
begin
  if p_delta = 0 or p_part_id is null then
    select quantity into v_new_qty from public.parts where id = p_part_id;
    return coalesce(v_new_qty, 0);
  end if;

  update public.parts
     set quantity = quantity + p_delta,
         purchase_price = coalesce(p_unit_cost, purchase_price),
         updated_at = now()
   where id = p_part_id
   returning quantity into v_new_qty;

  if not found then
    raise exception 'El repuesto seleccionado no existe';
  end if;

  select email into v_email from public.profiles where id = auth.uid();

  insert into public.stock_movements (
    part_id, movement_type, quantity_delta, resulting_quantity,
    unit_cost, work_order_id, work_order_item_id, reason, user_id, user_email
  )
  values (
    p_part_id, p_type, p_delta, v_new_qty,
    p_unit_cost, p_work_order_id, p_work_order_item_id, p_reason, auth.uid(), v_email
  );

  return v_new_qty;
end;
$$;

-- Función pública para registrar ingresos, devoluciones o ajustes manuales desde Inventario
create or replace function public.record_stock_movement(
  p_part_id    uuid,
  p_type       public.stock_movement_type,
  p_quantity   numeric,
  p_unit_cost  numeric default null,
  p_reason     text default null
)
returns numeric
language plpgsql security invoker set search_path = public
as $$
declare
  v_delta numeric;
  v_cur   numeric;
begin
  if not public.has_permission('inventory', 'edit') and not public.has_permission('inventory', 'create') then
    raise exception 'No tiene permiso para registrar movimientos de inventario';
  end if;

  if p_type = 'ajuste' then
    -- En "ajuste", p_quantity representa el stock físico real relevado
    select quantity into v_cur from public.parts where id = p_part_id;
    v_delta := p_quantity - coalesce(v_cur, 0);
    if v_delta = 0 then return coalesce(v_cur, 0); end if;
  elsif p_type in ('ingreso', 'devolucion') then
    if p_quantity <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
    v_delta := p_quantity;
  else
    if p_quantity <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
    v_delta := -p_quantity;
  end if;

  return public.apply_stock_delta(p_part_id, p_type, v_delta, p_unit_cost, null, null, p_reason);
end;
$$;

-- Importación masiva de repuestos desde Excel
create or replace function public.import_parts(p_rows jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_item     jsonb;
  v_part_id  uuid;
  v_qty      numeric;
  v_inserted int := 0;
  v_updated  int := 0;
begin
  if not public.has_permission('inventory', 'create') then
    raise exception 'No tiene permiso para importar repuestos';
  end if;

  for v_item in select * from jsonb_array_elements(p_rows) loop
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);

    select id into v_part_id
      from public.parts
     where upper(trim(internal_code)) = upper(trim(v_item ->> 'internal_code'));

    if v_part_id is null then
      insert into public.parts (
        internal_code, original_code, description, category, brand,
        compatibility_notes, quantity, min_stock, unit, purchase_price, supplier, location
      )
      values (
        v_item ->> 'internal_code',
        v_item ->> 'original_code',
        v_item ->> 'description',
        coalesce((v_item ->> 'category')::public.part_category, 'otros'),
        v_item ->> 'brand',
        v_item ->> 'compatibility_notes',
        0,
        coalesce((v_item ->> 'min_stock')::numeric, 0),
        coalesce(nullif(v_item ->> 'unit', ''), 'un.'),
        (v_item ->> 'purchase_price')::numeric,
        v_item ->> 'supplier',
        v_item ->> 'location'
      )
      returning id into v_part_id;

      if v_qty <> 0 then
        perform public.apply_stock_delta(v_part_id, 'ingreso', v_qty, (v_item ->> 'purchase_price')::numeric, null, null, 'Stock inicial (importación Excel)');
      end if;
      v_inserted := v_inserted + 1;
    else
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'skipped', v_updated);
end;
$$;

-- -----------------------------------------------------------------------------
-- Vinculación entre Órdenes de Reparación e Inventario (sin descuentos duplicados)
-- -----------------------------------------------------------------------------
alter table public.work_order_items
  add column if not exists part_id uuid references public.parts (id) on delete set null;

create or replace function public.wo_items_stock_sync()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_wo_num int;
  v_pat    text;
  v_label  text;
begin
  select order_number, patente into v_wo_num, v_pat
    from public.work_orders
   where id = coalesce(new.work_order_id, old.work_order_id);

  v_label := 'OR-' || lpad(coalesce(v_wo_num::text, '?'), 5, '0') || ' (' || coalesce(v_pat, '') || ')';

  if tg_op = 'INSERT' then
    if new.part_id is not null then
      perform public.apply_stock_delta(
        new.part_id, 'egreso_or', -new.quantity, new.unit_cost,
        new.work_order_id, new.id, 'Utilizado en ' || v_label
      );
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.part_id is not null then
      perform public.apply_stock_delta(
        old.part_id, 'devolucion_or', old.quantity, old.unit_cost,
        old.work_order_id, old.id, 'Reintegro por modificación/quita en ' || v_label
      );
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.part_id is distinct from new.part_id then
      if old.part_id is not null then
        perform public.apply_stock_delta(
          old.part_id, 'devolucion_or', old.quantity, old.unit_cost,
          old.work_order_id, old.id, 'Cambio de repuesto en ' || v_label
        );
      end if;
      if new.part_id is not null then
        perform public.apply_stock_delta(
          new.part_id, 'egreso_or', -new.quantity, new.unit_cost,
          new.work_order_id, new.id, 'Utilizado en ' || v_label
        );
      end if;
    elsif new.part_id is not null and new.quantity <> old.quantity then
      -- Solo descuenta o reintegra la DIFERENCIA (evita descuentos duplicados)
      perform public.apply_stock_delta(
        new.part_id,
        case when new.quantity > old.quantity then 'egreso_or'::public.stock_movement_type else 'devolucion_or'::public.stock_movement_type end,
        old.quantity - new.quantity,
        new.unit_cost,
        new.work_order_id,
        new.id,
        'Ajuste de cantidad en ' || v_label
      );
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_wo_items_stock on public.work_order_items;
create trigger trg_wo_items_stock
  after insert or update or delete on public.work_order_items
  for each row execute function public.wo_items_stock_sync();

-- -----------------------------------------------------------------------------
-- Servicios Predefinidos y Configuración por Modelo / Categoría y por Patente
-- -----------------------------------------------------------------------------
create table if not exists public.service_types (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null unique,
  default_maint_type  public.maintenance_type not null default 'preventivo',
  description         text,
  sort_order          int  not null default 100,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

-- Precarga de los 12 servicios habituales solicitados por RV Group
insert into public.service_types (name, default_maint_type, sort_order) values
  ('Servicio básico',          'preventivo', 10),
  ('Servicio completo',        'preventivo', 20),
  ('Cambio de aceite',         'preventivo', 30),
  ('Cambio de filtros',        'preventivo', 40),
  ('Frenos',                   'correctivo', 50),
  ('Suspensión',               'correctivo', 60),
  ('Tren delantero',           'correctivo', 70),
  ('Aire acondicionado',       'correctivo', 80),
  ('Sistema de refrigeración', 'correctivo', 90),
  ('Electricidad',             'correctivo', 100),
  ('Neumáticos',               'preventivo', 110),
  ('Reparación general',       'correctivo', 120)
on conflict (name) do nothing;

-- Plantilla de configuración de un servicio para una Categoría/Modelo O para una Patente individual
create table if not exists public.service_templates (
  id                uuid primary key default gen_random_uuid(),
  service_type_id   uuid not null references public.service_types (id) on delete cascade,
  category_id       uuid references public.vehicle_categories (id) on delete cascade,
  vehicle_id        uuid references public.vehicles (id) on delete cascade,
  oil_type          text,
  oil_liters        numeric(10, 2) check (oil_liters is null or oil_liters >= 0),
  other_fluids      text,
  default_work      text,
  notes             text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.profiles (id),
  updated_by        uuid references public.profiles (id),
  -- Exactamente uno de los dos alcances: por categoría/modelo o por patente individual
  constraint service_templates_scope_chk check (
    (category_id is not null and vehicle_id is null)
    or (category_id is null and vehicle_id is not null)
  )
);

create unique index if not exists ux_service_template_category
  on public.service_templates (service_type_id, category_id) where category_id is not null;
create unique index if not exists ux_service_template_vehicle
  on public.service_templates (service_type_id, vehicle_id) where vehicle_id is not null;

drop trigger if exists trg_service_templates_audit_cols on public.service_templates;
create trigger trg_service_templates_audit_cols before insert or update on public.service_templates
  for each row execute function public.set_audit_columns();

-- Repuestos / filtros que integran la plantilla del servicio
create table if not exists public.service_template_items (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.service_templates (id) on delete cascade,
  part_id       uuid references public.parts (id) on delete set null,
  role_label    text, -- Ej.: "Filtro de aceite", "Filtro de habitáculo (1 y 2)", etc.
  part_code     text,
  description   text not null,
  quantity      numeric(10, 2) not null default 1 check (quantity > 0),
  unit          text not null default 'un.',
  optional      boolean not null default false,
  sort_order    int  not null default 0
);

create index if not exists idx_sti_template on public.service_template_items (template_id, sort_order);

-- Vincula opcionalmente la OR con el servicio predefinido elegido
alter table public.work_orders
  add column if not exists service_type_id uuid references public.service_types (id) on delete set null;

-- Resuelve automáticamente la configuración correspondiente a una unidad y un servicio:
-- Prioriza la configuración específica de la PATENTE; si no existe, usa la de su CATEGORÍA/MODELO.
create or replace function public.resolve_service_for_vehicle(
  p_vehicle_id      uuid,
  p_service_type_id uuid
)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_cat_id uuid;
  v_tpl    public.service_templates%rowtype;
  v_scope  text;
  v_items  jsonb;
begin
  select category_id into v_cat_id from public.vehicles where id = p_vehicle_id;

  -- 1° Prioridad: configuración por patente individual
  select * into v_tpl
    from public.service_templates
   where service_type_id = p_service_type_id
     and vehicle_id = p_vehicle_id
     and active = true
   limit 1;

  if found then
    v_scope := 'patente';
  elsif v_cat_id is not null then
    -- 2° Prioridad: configuración por categoría/modelo
    select * into v_tpl
      from public.service_templates
     where service_type_id = p_service_type_id
       and category_id = v_cat_id
       and active = true
     limit 1;
    if found then v_scope := 'categoria'; end if;
  end if;

  if v_scope is null then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'part_id',     i.part_id,
        'role_label',  i.role_label,
        'part_code',   coalesce(p.internal_code, i.part_code),
        'description', coalesce(p.description, i.description),
        'quantity',    i.quantity,
        'unit',        coalesce(p.unit, i.unit),
        'unit_cost',   p.purchase_price,
        'stock',       p.quantity,
        'optional',    i.optional
      )
      order by i.sort_order, i.id
    ),
    '[]'::jsonb
  )
  into v_items
  from public.service_template_items i
  left join public.parts p on p.id = i.part_id
  where i.template_id = v_tpl.id;

  return jsonb_build_object(
    'found',        true,
    'scope',        v_scope,
    'template_id',  v_tpl.id,
    'oil_type',     v_tpl.oil_type,
    'oil_liters',   v_tpl.oil_liters,
    'other_fluids', v_tpl.other_fluids,
    'default_work', v_tpl.default_work,
    'notes',        v_tpl.notes,
    'items',        v_items
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Actualizar panel de control e incluir stock bajo y reseteo de prueba
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_fleet_stats()
returns jsonb
language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'total',               (select count(*) from public.vehicles where status <> 'baja'),
    'operativo',           (select count(*) from public.vehicles where status = 'operativo'),
    'fuera_de_servicio',   (select count(*) from public.vehicles where status = 'fuera_de_servicio'),
    'en_taller',           (select count(*) from public.vehicles where status = 'en_taller'),
    'baja',                (select count(*) from public.vehicles where status = 'baja'),
    'demo',                (select count(*) from public.vehicles where is_demo),
    'wo_open',             (select count(*) from public.work_orders where status not in ('finalizada', 'cerrada')),
    'wo_finished',         (select count(*) from public.work_orders where status in ('finalizada', 'cerrada')),
    'wo_pending_approval', (select count(*) from public.work_orders where status in ('finalizada', 'pendiente_autorizacion')),
    'parts_total',         (select count(*) from public.parts where active = true),
    'parts_low_stock',     (select count(*) from public.parts where active = true and quantity <= min_stock),
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

-- Actualizar la función de reseteo de administrador para incluir inventario y plantillas
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
  v_templates  int;
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
  select count(*) into v_templates from public.service_templates;
  select count(*) into v_batches from public.import_batches;

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
      'deleted_service_templates', v_templates,
      'deleted_import_batches', v_batches
    ),
    v_uid, v_email
  );

  return jsonb_build_object(
    'ok', true,
    'deleted_vehicles', v_vehicles,
    'deleted_work_orders', v_orders,
    'deleted_parts', v_parts,
    'deleted_service_templates', v_templates,
    'deleted_import_batches', v_batches
  );
end;
$$;

revoke all on function public.admin_reset_system_data(text) from public, anon;
grant execute on function public.admin_reset_system_data(text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS de Inventario y Servicios Predefinidos
-- -----------------------------------------------------------------------------
alter table public.parts                       enable row level security;
alter table public.part_category_compatibility enable row level security;
alter table public.stock_movements             enable row level security;
alter table public.service_types               enable row level security;
alter table public.service_templates           enable row level security;
alter table public.service_template_items      enable row level security;

drop policy if exists parts_select on public.parts;
create policy parts_select on public.parts for select to authenticated
  using (public.has_permission('inventory', 'view') or public.has_permission('work_orders', 'view'));
drop policy if exists parts_insert on public.parts;
create policy parts_insert on public.parts for insert to authenticated
  with check (public.has_permission('inventory', 'create'));
drop policy if exists parts_update on public.parts;
create policy parts_update on public.parts for update to authenticated
  using (public.has_permission('inventory', 'edit')) with check (public.has_permission('inventory', 'edit'));
drop policy if exists parts_delete on public.parts;
create policy parts_delete on public.parts for delete to authenticated
  using (public.has_permission('inventory', 'delete'));

drop policy if exists pcc_select on public.part_category_compatibility;
create policy pcc_select on public.part_category_compatibility for select to authenticated
  using (public.is_active_user());
drop policy if exists pcc_write on public.part_category_compatibility;
create policy pcc_write on public.part_category_compatibility for all to authenticated
  using (public.has_permission('inventory', 'edit') or public.has_permission('inventory', 'create'))
  with check (public.has_permission('inventory', 'edit') or public.has_permission('inventory', 'create'));

drop policy if exists sm_select on public.stock_movements;
create policy sm_select on public.stock_movements for select to authenticated
  using (public.has_permission('inventory', 'view'));

drop policy if exists st_select on public.service_types;
create policy st_select on public.service_types for select to authenticated
  using (public.is_active_user());
drop policy if exists st_write on public.service_types;
create policy st_write on public.service_types for all to authenticated
  using (public.has_permission('services', 'edit') or public.has_permission('services', 'create'))
  with check (public.has_permission('services', 'edit') or public.has_permission('services', 'create'));

drop policy if exists tpl_select on public.service_templates;
create policy tpl_select on public.service_templates for select to authenticated
  using (public.has_permission('services', 'view') or public.has_permission('work_orders', 'view'));
drop policy if exists tpl_write on public.service_templates;
create policy tpl_write on public.service_templates for all to authenticated
  using (public.has_permission('services', 'edit') or public.has_permission('services', 'create'))
  with check (public.has_permission('services', 'edit') or public.has_permission('services', 'create'));

drop policy if exists tpli_select on public.service_template_items;
create policy tpli_select on public.service_template_items for select to authenticated
  using (public.has_permission('services', 'view') or public.has_permission('work_orders', 'view'));
drop policy if exists tpli_write on public.service_template_items;
create policy tpli_write on public.service_template_items for all to authenticated
  using (public.has_permission('services', 'edit') or public.has_permission('services', 'create'))
  with check (public.has_permission('services', 'edit') or public.has_permission('services', 'create'));

-- Tiempo real para inventario
do $$ begin
  alter publication supabase_realtime add table public.parts;
exception when others then null; end $$;
