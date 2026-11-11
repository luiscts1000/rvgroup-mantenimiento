export type AppRole = 'admin' | 'gerencia' | 'mecanico' | 'invitado';
export type VehicleStatus = 'operativo' | 'fuera_de_servicio' | 'en_taller' | 'baja';
export type PermAction = 'view' | 'create' | 'edit' | 'delete' | 'export';
export type WorkOrderStatus =
  | 'abierta'
  | 'asignada'
  | 'en_proceso'
  | 'pendiente_repuestos'
  | 'pendiente_autorizacion'
  | 'finalizada'
  | 'cerrada';
export type MaintenanceType = 'preventivo' | 'correctivo' | 'emergencia' | 'rto' | 'otro';
export type PartCategory =
  | 'filtros'
  | 'aceites'
  | 'lubricantes'
  | 'liquidos'
  | 'frenos'
  | 'suspension'
  | 'repuestos_motor'
  | 'electricidad'
  | 'aire_acondicionado'
  | 'cubiertas'
  | 'baterias'
  | 'otros';
export type StockMovementType = 'ingreso' | 'egreso_or' | 'devolucion_or' | 'devolucion' | 'ajuste';
export type PendingPriority = 'baja' | 'media' | 'alta' | 'urgente';
export type PendingStatus =
  | 'pendiente'
  | 'en_gestion'
  | 'turno_solicitado'
  | 'turno_confirmado'
  | 'en_taller'
  | 'pendiente_repuestos'
  | 'reparado'
  | 'cerrado';
export type AppointmentStatus = 'a_gestionar' | 'solicitado' | 'confirmado' | 'reprogramado' | 'cancelado' | 'realizado';
export type CheckItemState = 'ok' | 'observacion' | 'reparar' | 'no_aplica';
export type ModuleKey =
  | 'dashboard'
  | 'vehicles'
  | 'work_orders'
  | 'inventory'
  | 'pending'
  | 'appointments'
  | 'preventive'
  | 'services'
  | 'history'
  | 'reports'
  | 'users'
  | 'settings';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: AppRole;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Permission {
  module: ModuleKey;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
}

export interface UserPermissionOverride {
  user_id: string;
  module: ModuleKey;
  can_view: boolean | null;
  can_create: boolean | null;
  can_edit: boolean | null;
  can_delete: boolean | null;
  can_export: boolean | null;
}

export interface VehicleCategory {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  version: string | null;
  sort_order: number;
  active: boolean;
}

export interface Vehicle {
  id: string;
  registro_nro: string | null;
  patente: string;
  nro_interno: string | null;
  marca: string | null;
  modelo: string | null;
  version: string | null;
  anio: number | null;
  chasis: string | null;
  motor: string | null;
  km_actual: number | null;
  vehicle_type: string | null;
  category_id: string | null;
  tire_type_size: string | null;
  tire_count: number | null;
  status: VehicleStatus;
  observaciones: string | null;
  rto_due_date?: string | null;
  service_interval_km?: number | null;
  last_service_km?: number | null;
  last_service_date?: string | null;
  next_service_km?: number | null;
  km_cubiertas?: number | null;
  km_correas?: number | null;
  km_amortiguadores_del?: number | null;
  km_amortiguadores_tras?: number | null;
  km_cintas?: number | null;
  km_pastillas_del?: number | null;
  km_pastillas_tras?: number | null;
  km_discos_tras?: number | null;
  km_discos_del?: number | null;
  km_fluidos?: number | null;
  is_demo: boolean;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  vehicle_categories?: { name: string } | null;
}

export type VehicleInput = Omit<
  Vehicle,
  'id' | 'is_demo' | 'import_batch_id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by' | 'vehicle_categories'
>;

export interface AuditEntry {
  id: number;
  table_name: string;
  record_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  user_id: string | null;
  user_email: string | null;
  created_at: string;
}

export interface ImportBatch {
  id: string;
  file_name: string;
  total_rows: number;
  inserted: number;
  skipped: number;
  skipped_detail: string[] | null;
  user_id: string | null;
  created_at: string;
}

export interface FleetStats {
  total: number;
  operativo: number;
  fuera_de_servicio: number;
  en_taller: number;
  baja: number;
  demo: number;
  wo_open: number;
  wo_finished: number;
  wo_pending_approval: number;
  parts_total: number;
  parts_low_stock: number;
  pending_open: number;
  pending_urgent: number;
  appointments_upcoming: number;
  rto_due_soon: number;
  rto_expired: number;
  maintenance_alerts: number;
  by_category: { name: string; count: number }[];
  by_type: { name: string; count: number }[];
}

export interface WorkOrder {
  id: string;
  order_number: number;
  opened_at: string;
  closed_at: string | null;
  vehicle_id: string;
  service_type_id?: string | null;
  patente: string;
  nro_interno: string | null;
  marca_modelo: string | null;
  kilometraje: number | null;
  maintenance_type: MaintenanceType;
  requester_name: string | null;
  mechanic_id: string | null;
  mechanic_name: string | null;
  failure_description: string | null;
  requested_work: string | null;
  diagnosis: string | null;
  work_performed: string | null;
  oil_type: string | null;
  oil_liters: number | null;
  other_fluids: string | null;
  labor_detail: string | null;
  labor_hours: number | null;
  labor_cost: number | null;
  observations: string | null;
  status: WorkOrderStatus;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  pdf_path: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface WorkOrderItem {
  id: string;
  work_order_id: string;
  part_id: string | null;
  part_code: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_cost: number | null;
  sort_order: number;
  created_at: string;
}

export interface Part {
  id: string;
  internal_code: string;
  original_code: string | null;
  description: string;
  category: PartCategory;
  brand: string | null;
  compatibility_notes: string | null;
  quantity: number;
  min_stock: number;
  unit: string;
  purchase_price: number | null;
  supplier: string | null;
  location: string | null;
  active: boolean;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  part_category_compatibility?: { category_id: string }[];
}

export interface StockMovement {
  id: number;
  part_id: string;
  movement_type: StockMovementType;
  quantity_delta: number;
  resulting_quantity: number;
  unit_cost: number | null;
  work_order_id: string | null;
  work_order_item_id: string | null;
  reason: string | null;
  user_id: string | null;
  user_email: string | null;
  created_at: string;
  parts?: { internal_code: string; description: string; unit: string } | null;
}

export interface ServiceType {
  id: string;
  name: string;
  default_maint_type: MaintenanceType;
  description: string | null;
  sort_order: number;
  active: boolean;
}

export interface ServiceTemplate {
  id: string;
  service_type_id: string;
  category_id: string | null;
  vehicle_id: string | null;
  oil_type: string | null;
  oil_liters: number | null;
  other_fluids: string | null;
  default_work: string | null;
  notes: string | null;
  active: boolean;
  updated_at: string;
  service_types?: { name: string } | null;
  vehicle_categories?: { name: string } | null;
  vehicles?: { patente: string; nro_interno: string | null; marca: string | null; modelo: string | null; version: string | null } | null;
  service_template_items?: ServiceTemplateItem[];
}

export interface ServiceTemplateItem {
  id: string;
  template_id: string;
  part_id: string | null;
  role_label: string | null;
  part_code: string | null;
  description: string;
  quantity: number;
  unit: string;
  optional: boolean;
  sort_order: number;
}

export interface PendingTask {
  id: string;
  vehicle_id: string;
  patente: string;
  nro_interno: string | null;
  vehicle_label: string | null;
  detected_at: string;
  task_title: string;
  description: string | null;
  priority: PendingPriority;
  status: PendingStatus;
  responsible: string | null;
  estimated_resolution_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  has_appointment: boolean;
  appointment_date: string | null;
  appointment_time: string | null;
  provider_name: string | null;
  observations: string | null;
  work_order_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingTaskAttachment {
  id: string;
  pending_task_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  kind: 'foto' | 'comprobante';
  caption: string | null;
  created_at: string;
  created_by_email: string | null;
}

export interface Appointment {
  id: string;
  vehicle_id: string;
  patente: string;
  nro_interno: string | null;
  vehicle_label: string | null;
  reason: string;
  provider_name: string;
  address: string | null;
  appointment_date: string;
  appointment_time: string | null;
  responsible: string | null;
  phone: string | null;
  observations: string | null;
  status: AppointmentStatus;
  receipt_path: string | null;
  receipt_name: string | null;
  pending_task_id: string | null;
  work_order_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkOrderPhoto {
  id: string;
  work_order_id: string;
  storage_path: string;
  caption: string | null;
  stage: string | null;
  created_at: string;
  created_by: string | null;
  created_by_email: string | null;
}

export interface WorkOrderStatusEntry {
  id: number;
  work_order_id: string;
  from_status: WorkOrderStatus | null;
  to_status: WorkOrderStatus;
  note: string | null;
  user_id: string | null;
  user_email: string | null;
  created_at: string;
}

export interface PreventiveInspection {
  id: string;
  vehicle_id: string;
  patente: string;
  nro_interno: string | null;
  vehicle_label: string | null;
  inspected_at: string;
  inspector_name: string | null;
  kilometraje: number | null;
  rto_due_date: string | null;
  windshield_state: CheckItemState;
  windshield_notes: string | null;
  tires_state: CheckItemState;
  tires_notes: string | null;
  brakes_state: CheckItemState;
  brakes_notes: string | null;
  suspension_state: CheckItemState;
  suspension_notes: string | null;
  lights_state: CheckItemState;
  lights_notes: string | null;
  seatbelts_state: CheckItemState;
  seatbelts_notes: string | null;
  safety_elements_state: CheckItemState;
  safety_elements_notes: string | null;
  documentation_state: CheckItemState;
  documentation_notes: string | null;
  overall_ready_for_rto: boolean;
  observations: string | null;
  generated_pending_count: number;
  created_at: string;
  updated_at: string;
}
