-- =============================================================================
-- Migración 0011: Agregar categorías para Toyota Hilux
-- =============================================================================

insert into public.vehicle_categories (name, brand, model, version, sort_order) values
  ('Toyota Hilux',      'Toyota', 'Hilux', null,  25),
  ('Toyota Hilux 2.4',  'Toyota', 'Hilux', '2.4', 26),
  ('Toyota Hilux 2.8',  'Toyota', 'Hilux', '2.8', 27)
on conflict (name) do update
set brand = excluded.brand,
    model = excluded.model,
    version = excluded.version;
