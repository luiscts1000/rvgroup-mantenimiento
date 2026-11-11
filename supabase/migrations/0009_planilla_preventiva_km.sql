-- =============================================================================
-- Migración 0009: Planilla Unificada de Seguimiento Preventivo por Kilometraje
-- (Modelo | Interno | Patente | Km | Próximo Servi | Restante | Cubiertas |
--  Correas | Amort. Del | Amort. Tras | Cintas | Pastillas Del | Pastillas Tras |
--  Discos Tras | Discos Del | Fluidos)
-- =============================================================================

alter table public.vehicles
  add column if not exists next_service_km        int check (next_service_km is null or next_service_km >= 0),
  add column if not exists km_cubiertas           int check (km_cubiertas is null or km_cubiertas >= 0),
  add column if not exists km_correas             int check (km_correas is null or km_correas >= 0),
  add column if not exists km_amortiguadores_del  int check (km_amortiguadores_del is null or km_amortiguadores_del >= 0),
  add column if not exists km_amortiguadores_tras int check (km_amortiguadores_tras is null or km_amortiguadores_tras >= 0),
  add column if not exists km_cintas              int check (km_cintas is null or km_cintas >= 0),
  add column if not exists km_pastillas_del       int check (km_pastillas_del is null or km_pastillas_del >= 0),
  add column if not exists km_pastillas_tras      int check (km_pastillas_tras is null or km_pastillas_tras >= 0),
  add column if not exists km_discos_tras         int check (km_discos_tras is null or km_discos_tras >= 0),
  add column if not exists km_discos_del          int check (km_discos_del is null or km_discos_del >= 0),
  add column if not exists km_fluidos             int check (km_fluidos is null or km_fluidos >= 0);

-- Cargar los valores reales de la planilla de control preventivo de RV Group
with sheet_data (
  patente, km, prox_servi, cubiertas, correas, amort_del, amort_tras,
  cintas, past_del, past_tras, discos_tras, discos_del, fluidos
) as (
  values
    ('AG991AK', 38488,  30000,  null,   null,   null,   null,   null,   null,   null,   null,   null,   null),
    ('AI088SR', 66885,  63317,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AH801YL', 57358,  54000,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AH326PF', 161310, 158000, 152000, 150000, 150000, 120000, 140000, 130000, null,   null,   null,   80000),
    ('AG961RW', 35309,  32000,  null,   null,   null,   null,   null,   null,   null,   null,   null,   null),
    ('AF696UI', 80400,  77874,  null,   240000, 240000, 160000, 270000, 162500, null,   null,   null,   250000),
    ('AG807TS', 203749, 202000, 191000, 160000, 190000, 190000, 160000, 208000, null,   null,   null,   250000),
    ('AI088SV', 45427,  44000,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AH885FX', 80133,  79680,  40000,  120000, 106500, 70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AG210UG', 256073, 255923, 230000, 260000, 240000, 250000, 280000, 213000, null,   null,   null,   250000),
    ('AG210UF', 301181, 301095, 273000, 358000, 358000, 250000, 358000, 280000, null,   null,   null,   250000),
    ('AH795FA', 82389,  83060,  40000,  120000, 100000, 120000, 140000, 90000,  null,   null,   null,   250001),
    ('AH000DX', 172072, 173000, 94008,  150000, 150000, 150000, 140000, 126000, null,   null,   null,   160000),
    ('AF750XG', 80333,  81266,  273000, 358000, 358000, 250000, 358000, 280000, null,   null,   null,   250000),
    ('AH986LV', 79262,  80452,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AG210VQ', 283974, 285236, 246000, 253918, 250000, 318000, 250000, 277000, null,   null,   null,   250000),
    ('AH080YD', 152672, 154575, 152000, 150000, 160000, 70000,  120000, 127000, 119000, 120000, 120000, 250000),
    ('AH995WC', 59155,  62245,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AI449NI', 6526,   10000,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AH326QS', 150780, 154290, 103000, 120000, 100000, 120000, 140000, 90000,  null,   null,   null,   250000),
    ('AI555JW', 6031,   10000,  40000,  150000, 100000, 120000, 140000, 90000,  null,   null,   null,   80000),
    ('AH905OL', 111631, 116000, 40000,  150000, 120000, 120000, 140000, 90000,  90000,  null,   null,   80000),
    ('AF674FB', 141058, 145752, 117000, 150000, 163000, 110000, 173000, 120000, 140000, 173000, 173000, null),
    ('AI202DZ', 38858,  43800,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AG210UC', 218703, 223700, 177000, 240000, 240000, 160000, 270000, 162500, null,   null,   null,   250000),
    ('AF658YD', 77845,  83587,  null,   240000, 240000, 160000, 270000, 162500, null,   null,   null,   250000),
    ('AG426QP', 187449, 193412, 166000, 150000, 200000, 184000, 184000, 164000, 158000, 160000, 160000, null),
    ('AF696UG', 75462,  81436,  null,   240000, 240000, 160000, 270000, 162500, null,   null,   null,   250000),
    ('AH885EP', 106000, 112000, 98000,  150000, 120000, 120000, 140000, 90000,  90000,  null,   null,   80000),
    ('AI449NT', 15802,  22148,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AH519DP', 112620, 119400, 115000, 120000, 90000,  70000,  80000,  96000,  96000,  80000,  80000,  250000),
    ('AH518LY', 95279,  102700, 67000,  120000, 100000, 120000, 140000, 90000,  null,   null,   null,   250000),
    ('AH519DN', 113712, 121144, 120000, 120000, 117000, 80000,  80000,  80000,  90000,  80000,  80000,  250000),
    ('AH986LU', 49495,  57526,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AG910FB', 171868, 180200, 105400, 150000, 150000, 150000, 232953, 121000, null,   null,   null,   80000),
    ('AH396DH', 62781,  71120,  40000,  150000, 120000, 120000, 140000, 90000,  null,   null,   null,   80000),
    ('AI555KG', 12595,  21144,  40000,  150000, 100000, 120000, 140000, 90000,  null,   null,   null,   80000),
    ('AH986LW', 45322,  54000,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AI165GC', 33285,  42161,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AF554JY', 87241,  96323,  null,   240000, 240000, 160000, 270000, 162500, null,   null,   null,   250000),
    ('AH326QT', 126868, 136000, 80000,  120000, 100000, 120000, 140000, 90000,  null,   null,   null,   250000),
    ('AG900UF', 176711, 185922, 96766,  150000, 150000, 150000, 140000, 195500, null,   null,   null,   160000),
    ('AF696UJ', 87536,  96800,  null,   240000, 240000, 160000, 270000, 162500, null,   null,   null,   250000),
    ('AH326PE', 82078,  91500,  40000,  150000, 100000, 120000, 140000, 90000,  null,   null,   null,   80000),
    ('AG713FG', 194754, 204250, 146000, 207109, 240000, 160000, 260000, 208000, null,   null,   null,   250000),
    ('AI555KE', 12334,  22324,  40000,  150000, 100000, 120000, 140000, 90000,  null,   null,   null,   80000),
    ('AH885FY', 81500,  91500,  67000,  120000, 70000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AI165JL', 22748,  32748,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AH885FW', 86046,  96412,  90000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AH795FO', 87593,  100278, 40000,  120000, 100000, 120000, 140000, 90000,  null,   null,   null,   250001),
    ('AH518MA', 130062, 144353, 78800,  120000, 100000, 120000, 140000, 90000,  null,   null,   null,   250000),
    ('AH518LZ', 119638, 135638, 83000,  135000, 120000, 120000, 140000, 90000,  null,   null,   null,   250000),
    ('AI202DO', 13837,  30000,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000),
    ('AH995WD', 8871,   67140,  40000,  120000, 80000,  70000,  80000,  50000,  50000,  80000,  80000,  250000)
)
update public.vehicles v
   set km_actual              = s.km,
       next_service_km        = s.prox_servi,
       km_cubiertas           = s.cubiertas,
       km_correas             = s.correas,
       km_amortiguadores_del  = s.amort_del,
       km_amortiguadores_tras = s.amort_tras,
       km_cintas              = s.cintas,
       km_pastillas_del       = s.past_del,
       km_pastillas_tras      = s.past_tras,
       km_discos_tras         = s.discos_tras,
       km_discos_del          = s.discos_del,
       km_fluidos             = s.fluidos
  from sheet_data s
 where v.patente = s.patente;

-- Para unidades Toyota Hilux nuevas sin parámetros preventivos cargados aún, precargar estándar Toyota Hilux
update public.vehicles
   set next_service_km        = coalesce(next_service_km, 10000),
       km_cubiertas           = coalesce(km_cubiertas, 40000),
       km_correas             = coalesce(km_correas, 150000),
       km_amortiguadores_del  = coalesce(km_amortiguadores_del, 100000),
       km_amortiguadores_tras = coalesce(km_amortiguadores_tras, 120000),
       km_cintas              = coalesce(km_cintas, 140000),
       km_pastillas_del       = coalesce(km_pastillas_del, 90000),
       km_fluidos             = coalesce(km_fluidos, 80000)
 where lower(coalesce(marca, '') || ' ' || coalesce(modelo, '')) like '%hilux%'
   and next_service_km is null;

-- Actualizar dashboard_fleet_stats para considerar next_service_km en maintenance_alerts
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
    'rto_due_soon',          (select count(*) from public.vehicles where status <> 'baja' and rto_due_date is not null and rto_due_date <= current_date + 30),
    'rto_expired',           (select count(*) from public.vehicles where status <> 'baja' and rto_due_date is not null and rto_due_date < current_date),
    'maintenance_alerts',    (
      select count(*) from public.vehicles v
      where v.status <> 'baja'
        and (
          (v.rto_due_date is not null and v.rto_due_date <= current_date + 30)
          or (v.km_actual is not null and v.next_service_km is not null and (v.next_service_km - v.km_actual) <= 1000)
          or (v.km_actual is not null and v.next_service_km is null and v.last_service_km is not null and v.service_interval_km is not null
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
