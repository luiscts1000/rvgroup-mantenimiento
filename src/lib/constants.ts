import {
  LayoutDashboard,
  Truck,
  Wrench,
  Package,
  ClipboardList,
  CalendarClock,
  ShieldCheck,
  History,
  BarChart3,
  Users,
  Settings,
  DollarSign,
  type LucideIcon,
} from 'lucide-react';
import type {
  AppointmentStatus,
  AppRole,
  CheckItemState,
  MaintenanceType,
  ModuleKey,
  PartCategory,
  PendingPriority,
  PendingStatus,
  StockMovementType,
  VehicleStatus,
  WorkOrderStatus,
} from '@/types/db';

/** Etapa de desarrollo actualmente habilitada. */
export const CURRENT_STAGE = 6;

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  short: string;
  path: string;
  icon: LucideIcon;
  stage: number;
}

export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: 'Panel de control', short: 'Panel', path: '/', icon: LayoutDashboard, stage: 1 },
  { key: 'vehicles', label: 'Unidades de RV Group', short: 'Unidades', path: '/unidades', icon: Truck, stage: 1 },
  { key: 'work_orders', label: 'Órdenes de reparación', short: 'Órdenes', path: '/ordenes', icon: Wrench, stage: 2 },
  { key: 'inventory', label: 'Inventario y repuestos', short: 'Inventario', path: '/inventario', icon: Package, stage: 3 },
  { key: 'pending', label: 'Pendientes generales', short: 'Pendientes', path: '/pendientes', icon: ClipboardList, stage: 4 },
  { key: 'appointments', label: 'Turnos y proveedores', short: 'Turnos', path: '/turnos', icon: CalendarClock, stage: 4 },
  { key: 'preventive', label: 'Mantenimiento preventivo y RTO', short: 'Preventivo', path: '/preventivo', icon: ShieldCheck, stage: 5 },
  { key: 'services', label: 'Tarifario M.O. y servicios', short: 'Tarifas M.O.', path: '/servicios', icon: DollarSign, stage: 3 },
  { key: 'history', label: 'Historial de mantenimiento', short: 'Historial', path: '/historial', icon: History, stage: 6 },
  { key: 'reports', label: 'Estadísticas y reportes', short: 'Reportes', path: '/reportes', icon: BarChart3, stage: 6 },
  { key: 'users', label: 'Usuarios y permisos', short: 'Usuarios', path: '/usuarios', icon: Users, stage: 1 },
  { key: 'settings', label: 'Configuración', short: 'Config.', path: '/configuracion', icon: Settings, stage: 1 },
];

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Administrador',
  gerencia: 'Gerencia',
  mecanico: 'Mecánico',
  invitado: 'Invitado',
};

export const ROLE_COLORS: Record<AppRole, string> = {
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  gerencia: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  mecanico: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  invitado: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const STATUS_LABELS: Record<VehicleStatus, string> = {
  operativo: 'Operativo',
  fuera_de_servicio: 'Fuera de servicio',
  en_taller: 'En taller',
  baja: 'Baja',
};

export const STATUS_COLORS: Record<VehicleStatus, string> = {
  operativo: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-900/40 dark:text-emerald-300',
  fuera_de_servicio: 'bg-red-100 text-red-800 ring-red-600/20 dark:bg-red-900/40 dark:text-red-300',
  en_taller: 'bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-900/40 dark:text-amber-300',
  baja: 'bg-slate-200 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-400',
};

export const STATUS_DOT: Record<VehicleStatus, string> = {
  operativo: 'bg-emerald-500',
  fuera_de_servicio: 'bg-red-500',
  en_taller: 'bg-amber-500',
  baja: 'bg-slate-400',
};

/** Sugerencias para el campo "Tipo de vehículo" (texto libre). */
export const VEHICLE_TYPE_SUGGESTIONS = ['Pick-up', 'Utilitario', 'Furgón', 'Minibús', 'Camión', 'Automóvil', 'Otro'];

export const PERM_ACTIONS = [
  { key: 'can_view', label: 'Ver' },
  { key: 'can_create', label: 'Crear' },
  { key: 'can_edit', label: 'Editar' },
  { key: 'can_delete', label: 'Eliminar / Baja' },
  { key: 'can_export', label: 'Exportar' },
] as const;

export const WO_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  abierta: 'Abierta',
  asignada: 'Asignada al Mecánico',
  en_proceso: 'En proceso en Taller',
  pendiente_repuestos: 'Pendiente de repuestos',
  pendiente_autorizacion: 'Pendiente de autorización',
  finalizada: 'Completada por Mecánico (P/ Cerrar)',
  cerrada: 'Cerrada / OT Archivada',
};

export const WO_STATUS_COLORS: Record<WorkOrderStatus, string> = {
  abierta: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  asignada: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  en_proceso: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  pendiente_repuestos: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  pendiente_autorizacion: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  finalizada: 'bg-rvgreen-100 text-rvgreen-900 ring-1 ring-rvgreen-500/40 font-bold dark:bg-rvgreen-900/40 dark:text-rvgreen-300',
  cerrada: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const WO_STATUS_DOT: Record<WorkOrderStatus, string> = {
  abierta: 'bg-sky-500',
  asignada: 'bg-indigo-500',
  en_proceso: 'bg-amber-500',
  pendiente_repuestos: 'bg-orange-500',
  pendiente_autorizacion: 'bg-purple-500',
  finalizada: 'bg-rvgreen-500',
  cerrada: 'bg-slate-500',
};

export const MAINTENANCE_TYPE_LABELS: Record<MaintenanceType, string> = {
  preventivo: 'Mantenimiento preventivo',
  correctivo: 'Mantenimiento correctivo',
  emergencia: 'Emergencia / auxilio',
  rto: 'Revisión / Inspección (RTO)',
  otro: 'Reparación',
};

export const PHOTO_STAGE_LABELS: Record<string, string> = {
  ingreso: 'Ingreso de unidad',
  diagnostico: 'Diagnóstico / falla',
  reparacion: 'Trabajo realizado',
  entrega: 'Entrega / cierre',
};

export function formatOrderNumber(n: number | null | undefined): string {
  if (!n && n !== 0) return 'OT N° 00 00-????';
  return `OT N° 00 00-${String(n).padStart(4, '0')}`;
}

export const PART_CATEGORY_LABELS: Record<PartCategory, string> = {
  filtros: 'Filtros',
  aceites: 'Aceites',
  lubricantes: 'Lubricantes',
  liquidos: 'Líquidos',
  frenos: 'Frenos',
  suspension: 'Suspensión',
  repuestos_motor: 'Repuestos de motor',
  electricidad: 'Electricidad',
  aire_acondicionado: 'Aire acondicionado',
  cubiertas: 'Cubiertas',
  baterias: 'Baterías',
  otros: 'Otros',
};

export const PART_UNIT_SUGGESTIONS = ['un.', 'litros', 'juego', 'par', 'kg', 'metros'];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  ingreso: 'Ingreso de stock',
  egreso_or: 'Salida / Entrega de pañol',
  devolucion_or: 'Reintegro desde OR',
  devolucion: 'Devolución al pañol',
  ajuste: 'Ajuste de inventario',
};

export const FILTER_ROLE_SUGGESTIONS = [
  'Filtro de aceite',
  'Filtro de aire',
  'Filtro de combustible',
  'Filtro de habitáculo',
  'Filtro de habitáculo (secundario)',
  'Aceite de motor',
  'Pastillas de freno delanteras',
  'Pastillas de freno traseras',
  'Amortiguadores',
  'Cubiertas',
];

export const PENDING_TASK_SUGGESTIONS = [
  'Cambio de parabrisas',
  'Cambio de amortiguadores',
  'Cambio de pastillas de freno',
  'Cambio de cubiertas',
  'Reparación de aire acondicionado',
  'Reparación de tacógrafo',
  'Problemas eléctricos',
  'Reparaciones mecánicas',
  'Preparación para RTO',
  'Otros trabajos',
];

export const PENDING_PRIORITY_LABELS: Record<PendingPriority, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
};

export const PENDING_PRIORITY_COLORS: Record<PendingPriority, string> = {
  baja: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  media: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  alta: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  urgente: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

export const PENDING_STATUS_LABELS: Record<PendingStatus, string> = {
  pendiente: 'Pendiente',
  en_gestion: 'En gestión',
  turno_solicitado: 'Turno solicitado',
  turno_confirmado: 'Turno confirmado',
  en_taller: 'En taller',
  pendiente_repuestos: 'Pendiente de repuestos',
  reparado: 'Reparado',
  cerrado: 'Cerrado',
};

export const PENDING_STATUS_COLORS: Record<PendingStatus, string> = {
  pendiente: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  en_gestion: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  turno_solicitado: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  turno_confirmado: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  en_taller: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  pendiente_repuestos: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  reparado: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  cerrado: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const PENDING_STATUS_DOT: Record<PendingStatus, string> = {
  pendiente: 'bg-red-500',
  en_gestion: 'bg-amber-500',
  turno_solicitado: 'bg-sky-500',
  turno_confirmado: 'bg-indigo-500',
  en_taller: 'bg-purple-500',
  pendiente_repuestos: 'bg-orange-500',
  reparado: 'bg-emerald-500',
  cerrado: 'bg-slate-400',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  a_gestionar: 'A gestionar',
  solicitado: 'Solicitado',
  confirmado: 'Confirmado',
  reprogramado: 'Reprogramado',
  cancelado: 'Cancelado',
  realizado: 'Realizado',
};

export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, string> = {
  a_gestionar: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  solicitado: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  confirmado: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  reprogramado: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  cancelado: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  realizado: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
};

export const CHECK_ITEM_LABELS: Record<CheckItemState, string> = {
  ok: 'OK',
  observacion: 'Con observación',
  reparar: 'Reparar antes de RTO',
  no_aplica: 'No aplica',
};

export const CHECK_ITEM_COLORS: Record<CheckItemState, string> = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  observacion: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  reparar: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  no_aplica: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

export interface InspectionCheckItemDef {
  key: 'windshield' | 'tires' | 'brakes' | 'suspension' | 'lights' | 'seatbelts' | 'safety_elements' | 'documentation';
  stateField:
    | 'windshield_state'
    | 'tires_state'
    | 'brakes_state'
    | 'suspension_state'
    | 'lights_state'
    | 'seatbelts_state'
    | 'safety_elements_state'
    | 'documentation_state';
  notesField:
    | 'windshield_notes'
    | 'tires_notes'
    | 'brakes_notes'
    | 'suspension_notes'
    | 'lights_notes'
    | 'seatbelts_notes'
    | 'safety_elements_notes'
    | 'documentation_notes';
  label: string;
  hint: string;
}

export const RTO_CHECKLIST_ITEMS: InspectionCheckItemDef[] = [
  {
    key: 'windshield',
    stateField: 'windshield_state',
    notesField: 'windshield_notes',
    label: 'Estado del parabrisas',
    hint: 'Rajaduras, impactos en zona de barrido, escobillas y lavaparabrisas',
  },
  {
    key: 'tires',
    stateField: 'tires_state',
    notesField: 'tires_notes',
    label: 'Estado de cubiertas',
    hint: 'Profundidad de dibujo, desgaste parejo, auxilio y presión',
  },
  {
    key: 'brakes',
    stateField: 'brakes_state',
    notesField: 'brakes_notes',
    label: 'Estado de frenos',
    hint: 'Pastillas, discos, cintas, freno de mano y nivel de líquido',
  },
  {
    key: 'suspension',
    stateField: 'suspension_state',
    notesField: 'suspension_notes',
    label: 'Estado de suspensión y dirección',
    hint: 'Amortiguadores, extremos, bujes, parrillas y alineación',
  },
  {
    key: 'lights',
    stateField: 'lights_state',
    notesField: 'lights_notes',
    label: 'Luces reglamentarias',
    hint: 'Bajas, altas, posición, giro, balizas, freno, retroceso y patente',
  },
  {
    key: 'seatbelts',
    stateField: 'seatbelts_state',
    notesField: 'seatbelts_notes',
    label: 'Cinturones de seguridad',
    hint: 'Inerciales, hebillas, anclajes y apoya cabezas en todas las plazas',
  },
  {
    key: 'safety_elements',
    stateField: 'safety_elements_state',
    notesField: 'safety_elements_notes',
    label: 'Elementos de seguridad',
    hint: 'Matafuego vigente y cargado, balizas triangulares, botiquín, chaleco y bandas reflectivas',
  },
  {
    key: 'documentation',
    stateField: 'documentation_state',
    notesField: 'documentation_notes',
    label: 'Documentación de la unidad',
    hint: 'Cédula verde/azul, seguro vigente, oblea/certificado RTO anterior, tacógrafo si aplica',
  },
];
