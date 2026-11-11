-- =============================================================================
-- RV GROUP SRL - Plataforma de Mantenimiento Vehicular
-- Migración 0001: Usuarios, roles y permisos
-- Ejecutar en: Supabase > SQL Editor (en orden: 0001, 0002, 0003)
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Roles del sistema
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'gerencia', 'mecanico', 'invitado');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Perfiles (1 a 1 con auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  phone       text,
  role        public.app_role not null default 'invitado',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Módulos del sistema (12 secciones del menú)
-- -----------------------------------------------------------------------------
create table if not exists public.app_modules (
  key         text primary key,
  name        text not null,
  sort_order  int  not null,
  stage       int  not null   -- etapa de desarrollo en la que se habilita
);

insert into public.app_modules (key, name, sort_order, stage) values
  ('dashboard',    'Panel de control',                 1, 1),
  ('vehicles',     'Unidades de RV Group',             2, 1),
  ('work_orders',  'Órdenes de reparación',            3, 2),
  ('inventory',    'Inventario y repuestos',           4, 3),
  ('pending',      'Pendientes generales',             5, 4),
  ('appointments', 'Turnos y proveedores',             6, 4),
  ('preventive',   'Mantenimiento preventivo y RTO',   7, 5),
  ('services',     'Servicios predefinidos',           8, 3),
  ('history',      'Historial de mantenimiento',       9, 6),
  ('reports',      'Estadísticas y reportes',         10, 6),
  ('users',        'Usuarios y permisos',             11, 1),
  ('settings',     'Configuración',                   12, 1)
on conflict (key) do update
  set name = excluded.name, sort_order = excluded.sort_order, stage = excluded.stage;

-- -----------------------------------------------------------------------------
-- Permisos base por rol
-- -----------------------------------------------------------------------------
create table if not exists public.role_permissions (
  role        public.app_role not null,
  module      text not null references public.app_modules (key) on delete cascade,
  can_view    boolean not null default false,
  can_create  boolean not null default false,
  can_edit    boolean not null default false,
  can_delete  boolean not null default false,
  can_export  boolean not null default false,
  primary key (role, module)
);

-- -----------------------------------------------------------------------------
-- Permisos específicos por usuario (NULL = hereda del rol)
-- -----------------------------------------------------------------------------
create table if not exists public.user_permissions (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  module      text not null references public.app_modules (key) on delete cascade,
  can_view    boolean,
  can_create  boolean,
  can_edit    boolean,
  can_delete  boolean,
  can_export  boolean,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id),
  primary key (user_id, module)
);

-- Permisos por defecto ---------------------------------------------------------
-- ADMIN: todo
insert into public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_export)
select 'admin', key, true, true, true, true, true from public.app_modules
on conflict do nothing;

-- GERENCIA: visualización y exportación (sin usuarios ni configuración)
insert into public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_export)
select 'gerencia', key, true, false, false, false, true from public.app_modules
where key not in ('users', 'settings')
on conflict do nothing;

-- MECÁNICOS: OR asignadas y carga de trabajos; consulta de unidades
insert into public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_export) values
  ('mecanico', 'dashboard',   true,  false, false, false, false),
  ('mecanico', 'vehicles',    true,  false, false, false, false),
  ('mecanico', 'work_orders', true,  false, true,  false, false),
  ('mecanico', 'inventory',   true,  false, false, false, false),
  ('mecanico', 'pending',     true,  true,  false, false, false),
  ('mecanico', 'services',    true,  false, false, false, false),
  ('mecanico', 'history',     true,  false, false, false, false)
on conflict do nothing;

-- INVITADOS: consulta limitada
insert into public.role_permissions (role, module, can_view, can_create, can_edit, can_delete, can_export) values
  ('invitado', 'dashboard', true, false, false, false, false),
  ('invitado', 'vehicles',  true, false, false, false, false)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Funciones de seguridad (SECURITY DEFINER para evitar recursión en RLS)
-- -----------------------------------------------------------------------------
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and active = true), false);
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select active from public.profiles where id = auth.uid()), false);
$$;

-- p_action: 'view' | 'create' | 'edit' | 'delete' | 'export'
create or replace function public.has_permission(p_module text, p_action text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role public.app_role;
  v_user boolean;
  v_base boolean;
begin
  select role into v_role from public.profiles where id = auth.uid() and active = true;
  if v_role is null then return false; end if;
  if v_role = 'admin' then return true; end if;

  select case p_action
           when 'view' then can_view when 'create' then can_create when 'edit' then can_edit
           when 'delete' then can_delete when 'export' then can_export end
    into v_user
    from public.user_permissions where user_id = auth.uid() and module = p_module;

  if v_user is not null then return v_user; end if;

  select case p_action
           when 'view' then can_view when 'create' then can_create when 'edit' then can_edit
           when 'delete' then can_delete when 'export' then can_export end
    into v_base
    from public.role_permissions where role = v_role and module = p_module;

  return coalesce(v_base, false);
end;
$$;

-- Permisos efectivos del usuario actual (usados por la interfaz)
create or replace function public.my_permissions()
returns table (module text, can_view boolean, can_create boolean, can_edit boolean, can_delete boolean, can_export boolean)
language sql stable security definer set search_path = public
as $$
  select m.key,
         public.has_permission(m.key, 'view'),
         public.has_permission(m.key, 'create'),
         public.has_permission(m.key, 'edit'),
         public.has_permission(m.key, 'delete'),
         public.has_permission(m.key, 'export')
  from public.app_modules m
  order by m.sort_order;
$$;

-- -----------------------------------------------------------------------------
-- Alta automática de perfil al crear un usuario en Auth.
-- El PRIMER usuario del sistema se convierte en ADMINISTRADOR (arranque inicial).
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.app_role := 'invitado';
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  elsif (new.raw_app_meta_data ->> 'role') in ('admin', 'gerencia', 'mecanico', 'invitado') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.app_role;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), v_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Protección de perfiles: evita escaladas de privilegios
-- -----------------------------------------------------------------------------
create or replace function public.protect_profile_changes()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.email := old.email;  -- el email solo se cambia desde Auth

  -- Llamadas con service_role (Edge Function) no tienen auth.uid(): se permiten
  if auth.uid() is null then return new; end if;

  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if not public.has_permission('users', 'edit') then
      raise exception 'No tiene permiso para modificar roles o estados de usuarios';
    end if;
    if (new.role = 'admin' or old.role = 'admin') and not public.is_admin() then
      raise exception 'Solo un administrador puede asignar o quitar el rol de administrador';
    end if;
    if old.id = auth.uid() and (new.role <> 'admin' or new.active = false) and old.role = 'admin' then
      raise exception 'No puede quitarse a sí mismo el rol de administrador ni desactivarse';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_profile on public.profiles;
create trigger trg_protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile_changes();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.app_modules      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_permission('users', 'edit'))
  with check (id = auth.uid() or public.has_permission('users', 'edit'));

-- app_modules
drop policy if exists modules_select on public.app_modules;
create policy modules_select on public.app_modules for select to authenticated using (true);

-- role_permissions
drop policy if exists role_perm_select on public.role_permissions;
create policy role_perm_select on public.role_permissions for select to authenticated
  using (public.is_active_user());
drop policy if exists role_perm_write on public.role_permissions;
create policy role_perm_write on public.role_permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- user_permissions
drop policy if exists user_perm_select on public.user_permissions;
create policy user_perm_select on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_permission('users', 'view'));
drop policy if exists user_perm_write on public.user_permissions;
create policy user_perm_write on public.user_permissions for all to authenticated
  using (public.has_permission('users', 'edit')) with check (public.has_permission('users', 'edit'));
