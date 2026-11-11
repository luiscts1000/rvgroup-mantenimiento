-- =============================================================================
-- Migración 0008: ETAPA 6 – Historial Integral por Unidad y Reportes / Estadísticas
-- =============================================================================

-- Ampliar políticas de lectura (SELECT) para que los usuarios con permiso en
-- "history" o "reports" puedan consultar todas las fuentes del historial y estadísticas.

drop policy if exists wo_select on public.work_orders;
create policy wo_select on public.work_orders for select to authenticated
  using (
    public.has_permission('work_orders', 'view')
    or public.has_permission('history', 'view')
    or public.has_permission('reports', 'view')
  );

drop policy if exists woi_select on public.work_order_items;
create policy woi_select on public.work_order_items for select to authenticated
  using (
    public.has_permission('work_orders', 'view')
    or public.has_permission('history', 'view')
    or public.has_permission('reports', 'view')
  );

drop policy if exists wop_select on public.work_order_photos;
create policy wop_select on public.work_order_photos for select to authenticated
  using (
    public.has_permission('work_orders', 'view')
    or public.has_permission('history', 'view')
  );

drop policy if exists pt_select on public.pending_tasks;
create policy pt_select on public.pending_tasks for select to authenticated
  using (
    public.has_permission('pending', 'view')
    or public.has_permission('vehicles', 'view')
    or public.has_permission('history', 'view')
    or public.has_permission('reports', 'view')
  );

drop policy if exists pta_select on public.pending_task_attachments;
create policy pta_select on public.pending_task_attachments for select to authenticated
  using (
    public.has_permission('pending', 'view')
    or public.has_permission('history', 'view')
  );

drop policy if exists appt_select on public.appointments;
create policy appt_select on public.appointments for select to authenticated
  using (
    public.has_permission('appointments', 'view')
    or public.has_permission('pending', 'view')
    or public.has_permission('history', 'view')
    or public.has_permission('reports', 'view')
  );

drop policy if exists pi_select on public.preventive_inspections;
create policy pi_select on public.preventive_inspections for select to authenticated
  using (
    public.has_permission('preventive', 'view')
    or public.has_permission('vehicles', 'view')
    or public.has_permission('history', 'view')
    or public.has_permission('reports', 'view')
  );

drop policy if exists wo_storage_select on storage.objects;
create policy wo_storage_select on storage.objects for select to authenticated
  using (
    bucket_id = 'work-orders'
    and (
      public.has_permission('work_orders', 'view')
      or public.has_permission('pending', 'view')
      or public.has_permission('appointments', 'view')
      or public.has_permission('history', 'view')
    )
  );
