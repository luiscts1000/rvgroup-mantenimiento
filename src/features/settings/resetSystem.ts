import { supabase, friendlyError } from '@/lib/supabase';

export interface ResetOptions {
  deleteWorkOrders: boolean;
  deleteOperationalHistory: boolean;
  deleteVehicles: boolean;
  deleteParts: boolean;
  adminPassword?: string;
}

export interface ResetResult {
  deletedWorkOrders: number;
  deletedVehicles: number;
  deletedParts: number;
  deletedPending: number;
  deletedAppointments: number;
  deletedInspections: number;
}

/**
 * Limpieza integral de datos de prueba para dejar el sistema en blanco y comenzar en producción.
 * Se conservan intactos: perfiles de usuarios, permisos, tarifario de mano de obra y categorías de vehículos.
 */
export async function resetSystemTestData(options: ResetOptions): Promise<ResetResult> {
  const result: ResetResult = {
    deletedWorkOrders: 0,
    deletedVehicles: 0,
    deletedParts: 0,
    deletedPending: 0,
    deletedAppointments: 0,
    deletedInspections: 0,
  };

  // 1. Si el usuario ingresó contraseña, intentar primero la función RPC de base de datos
  if (options.adminPassword && options.adminPassword.trim()) {
    try {
      const { data, error } = await supabase.rpc('admin_reset_system_data', {
        p_admin_password: options.adminPassword.trim(),
      });
      if (!error && data) {
        const d = data as Record<string, number>;
        return {
          deletedWorkOrders: d.deleted_work_orders ?? 0,
          deletedVehicles: d.deleted_vehicles ?? 0,
          deletedParts: d.deleted_parts ?? 0,
          deletedPending: d.deleted_pending_tasks ?? 0,
          deletedAppointments: d.deleted_appointments ?? 0,
          deletedInspections: d.deleted_inspections ?? 0,
        };
      }
    } catch {
      // Continuar con el vaciado en cascada directo
    }
  }

  // 2. Vaciado en cascada directo respetando dependencias de Foreign Keys
  try {
    // A. Inspecciones preventivas
    const { count: inspsCount } = await supabase
      .from('preventive_inspections')
      .select('*', { count: 'exact', head: true });
    result.deletedInspections = inspsCount ?? 0;
    await supabase
      .from('preventive_inspections')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // B. Turnos con talleres externos
    const { count: apptsCount } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true });
    result.deletedAppointments = apptsCount ?? 0;
    await supabase
      .from('appointments')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // C. Pendientes generales y adjuntos
    await supabase
      .from('pending_task_attachments')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    const { count: pendCount } = await supabase
      .from('pending_tasks')
      .select('*', { count: 'exact', head: true });
    result.deletedPending = pendCount ?? 0;
    await supabase
      .from('pending_tasks')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // D. Órdenes de Reparación (fotos, items, historial de estados, órdenes)
    await supabase
      .from('work_order_photos')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await supabase
      .from('work_order_items')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    await supabase
      .from('work_order_status_history')
      .delete()
      .gte('id', 0);

    const { count: woCount } = await supabase
      .from('work_orders')
      .select('*', { count: 'exact', head: true });
    result.deletedWorkOrders = woCount ?? 0;
    await supabase
      .from('work_orders')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // E. Movimientos de stock de prueba
    await supabase
      .from('stock_movements')
      .delete()
      .gte('id', 0);

    // F. Si eligió vaciar Unidades / Vehículos
    if (options.deleteVehicles) {
      // Eliminar plantillas vinculadas a patentes individuales primero
      try {
        await supabase
          .from('service_templates')
          .delete()
          .not('vehicle_id', 'is', null);
      } catch {
        // Ignore
      }

      const { count: vCount } = await supabase
        .from('vehicles')
        .select('*', { count: 'exact', head: true });
      result.deletedVehicles = vCount ?? 0;

      await supabase
        .from('vehicles')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      try {
        await supabase
          .from('import_batches')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
      } catch {
        // Ignore
      }
    } else {
      // Si conservó las unidades, restablecer su estado a 'operativo'
      try {
        await supabase
          .from('vehicles')
          .update({ status: 'operativo' })
          .neq('id', '00000000-0000-0000-0000-000000000000');
      } catch {
        // Ignore
      }
    }

    // G. Si eligió vaciar Repuestos
    if (options.deleteParts) {
      try {
        await supabase
          .from('part_category_compatibility')
          .delete()
          .neq('part_id', '00000000-0000-0000-0000-000000000000');
      } catch {
        // Ignore
      }

      const { count: pCount } = await supabase
        .from('parts')
        .select('*', { count: 'exact', head: true });
      result.deletedParts = pCount ?? 0;

      await supabase
        .from('parts')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      // Si conserva los repuestos, poner stock en 0 si había movimientos ficticios
      try {
        await supabase
          .from('parts')
          .update({ quantity: 0 })
          .neq('id', '00000000-0000-0000-0000-000000000000');
      } catch {
        // Ignore
      }
    }

    // H. Limpiar datos temporales de almacenamiento local de pruebas
    try {
      const keysToRemove = [
        'rvgroup_cached_wo_photos',
        'rvgroup_pending_draft',
        'rvgroup_quick_dispatch_draft',
      ];
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    } catch {
      // Ignore
    }

    return result;
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}
