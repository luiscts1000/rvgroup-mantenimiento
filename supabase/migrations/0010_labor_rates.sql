-- =============================================================================
-- Migración 0010: Tarifario Oficial de Mano de Obra y Valor Hora de Taller
-- =============================================================================

create table if not exists public.labor_rates (
  id                  text primary key,
  name                text not null,
  category            text not null default 'General',
  estimated_hours     numeric(6, 2) not null default 1.0 check (estimated_hours > 0),
  price               numeric(12, 2) not null default 0 check (price >= 0),
  hourly_rate_applied numeric(12, 2),
  notes               text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by_name     text
);

create table if not exists public.labor_settings (
  id                  int primary key default 1,
  hourly_rate         numeric(12, 2) not null default 28000 check (hourly_rate > 0),
  notes               text,
  last_updated        timestamptz not null default now(),
  updated_by_name     text,
  constraint single_row_labor_settings check (id = 1)
);

-- RLS
alter table public.labor_rates enable row level security;
alter table public.labor_settings enable row level security;

drop policy if exists labor_rates_select on public.labor_rates;
create policy labor_rates_select on public.labor_rates for select to authenticated
  using (true);

drop policy if exists labor_rates_write on public.labor_rates;
create policy labor_rates_write on public.labor_rates for all to authenticated
  using (public.has_permission('services', 'edit') or public.has_permission('services', 'create') or public.is_admin())
  with check (public.has_permission('services', 'edit') or public.has_permission('services', 'create') or public.is_admin());

drop policy if exists labor_settings_select on public.labor_settings;
create policy labor_settings_select on public.labor_settings for select to authenticated
  using (true);

drop policy if exists labor_settings_write on public.labor_settings;
create policy labor_settings_write on public.labor_settings for all to authenticated
  using (public.has_permission('services', 'edit') or public.has_permission('services', 'create') or public.is_admin())
  with check (public.has_permission('services', 'edit') or public.has_permission('services', 'create') or public.is_admin());
