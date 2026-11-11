-- =============================================================================
-- Migración 0002: Registro de auditoría (quién hizo qué y cuándo)
-- =============================================================================

create table if not exists public.audit_log (
  id              bigint generated always as identity primary key,
  table_name      text not null,
  record_id       text,
  action          text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data        jsonb,
  new_data        jsonb,
  changed_fields  text[],
  user_id         uuid,
  user_email      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_table_record on public.audit_log (table_name, record_id);
create index if not exists idx_audit_created on public.audit_log (created_at desc);
create index if not exists idx_audit_user on public.audit_log (user_id);

create or replace function public.audit_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_email text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(key) into v_changed
    from jsonb_each(v_new) n
    where key not in ('updated_at', 'updated_by')
      and n.value is distinct from (v_old -> key);
    if v_changed is null then return new; end if;  -- sin cambios reales
  end if;

  select email into v_email from public.profiles where id = auth.uid();

  insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id, user_email)
  values (tg_table_name,
          coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id'),
          tg_op, v_old, v_new, v_changed, auth.uid(), v_email);

  return coalesce(new, old);
end;
$$;

-- Auditoría de tablas de la etapa 1 (las tablas de unidades se agregan en 0003)
drop trigger if exists audit_profiles on public.profiles;
create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger();

drop trigger if exists audit_user_permissions on public.user_permissions;
create trigger audit_user_permissions after insert or update or delete on public.user_permissions
  for each row execute function public.audit_trigger();

drop trigger if exists audit_role_permissions on public.role_permissions;
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function public.audit_trigger();

-- RLS: nadie puede insertar/modificar/borrar manualmente; solo lectura según permisos
alter table public.audit_log enable row level security;

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (
    public.is_admin()
    or (table_name in ('vehicles') and public.has_permission('vehicles', 'view'))
  );
