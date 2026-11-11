# RV GROUP SRL – Plataforma de Mantenimiento Vehicular

## Estado actual del proyecto (Guardado y sincronizado en OneDrive)

- **Base de datos en la nube (Supabase):** activa y sincronizada en tiempo real (`https://rximclitvzuhxblqlorv.supabase.co`).
- **Migraciones SQL ejecutadas en Supabase (`supabase/migrations/`):**
  - `0001_base_usuarios_permisos.sql` — Perfiles, roles (`admin`, `gerencia`, `mecanico`, `invitado`), matriz de permisos y RLS.
  - `0002_auditoria.sql` — Auditoría automática de altas, bajas y modificaciones.
  - `0003_unidades.sql` — Categorías precargadas, unidades, importador Excel sin duplicados.
  - `0004_ordenes_reparacion_y_reset.sql` — Órdenes de reparación, fotos en Storage, numeración correlativa y función `admin_reset_system_data` con validación de contraseña de administrador.
  - `0005_inventario_y_servicios.sql` — Inventario de repuestos, movimientos de stock, descuento/reintegro automático en OR y plantillas de servicios predefinidos por modelo y por patente.
  - `0006_pendientes_y_turnos.sql` — Trabajos pendientes (sin borrado físico de resueltos), turnos con talleres externos y comprobantes adjuntos.
  - `0007_preventivo_y_rto.sql` — Vencimientos de RTO, control de service preventivo por kilometraje e inspecciones previas a RTO de 8 puntos con generación automática de pendientes.
- **Edge Function desplegada:** `admin-users` (gestión de usuarios y contraseñas desde el panel de Administrador).
- **Etapas completadas:**
  - **Etapa 1:** Autenticación, Usuarios y Permisos, Panel de Control, Unidades e Importador/Exportador Excel, Reseteo de datos de prueba con contraseña de Administrador.
  - **Etapa 2:** Órdenes de Reparación (OR), adjuntos fotográficos y comprobante PDF con membrete de **RV GROUP SRL**.
  - **Etapa 3:** Inventario de repuestos, control de stock mínimo, movimientos auditados y Servicios Predefinidos (por categoría/modelo y específicos por patente).
  - **Etapa 4:** Tablero de Pendientes Generales y Agenda/Calendario de Turnos con Proveedores (con mensaje listo para WhatsApp).
  - **Etapa 5:** Mantenimiento Preventivo y RTO (vencimientos, alertas de service por km e inspección previa a RTO de 8 rubros con creación automática de pendientes).
- **Próximas etapas para continuar:**
  - **Etapa 6:** Historial integral por unidad (`/historial`) + Estadísticas, Rankings, Gráficos y Reportes exportables a PDF/Excel (`/reportes`).
  - **Etapa 7:** Publicación final en la nube (URL accesible desde cualquier dispositivo sin depender de la PC local), PWA instalable y guía de uso final.

---

## Cómo abrir y ejecutar el proyecto en otra computadora

Como la carpeta del proyecto está dentro de **OneDrive** (`MANTENIMIENTO\Proyectos\Coordinacion\rvgroup-mantenimiento`), todos los archivos del código y la conexión a Supabase (`.env.local`) se sincronizan automáticamente.

Además, **todos los datos que cargues (unidades, órdenes, repuestos, pendientes, turnos, inspecciones y usuarios) están guardados en la nube de Supabase**, por lo que verás exactamente la misma información desde cualquier computadora.

### Pasos en la otra computadora:

1. Asegurarse de que OneDrive haya terminado de sincronizar la carpeta `rvgroup-mantenimiento`.
2. Tener instalado **Node.js** (versión 18 o superior).
3. Abrir una terminal (PowerShell) dentro de la carpeta `rvgroup-mantenimiento` y ejecutar:

```powershell
# 1. Instalar o verificar dependencias locales (solo si cambia de sistema o faltan paquetes)
npm.cmd install

# 2. Iniciar el servidor de desarrollo
npm.cmd run dev
```

4. Abrir en el navegador **`http://127.0.0.1:5173`** e iniciar sesión con tu cuenta de Administrador (`luisctsrodriguez@gmail.com`).

---

## Comandos útiles de verificación

```powershell
# Verificar tipos de TypeScript
npm.cmd run typecheck

# Ejecutar pruebas unitarias
npm.cmd test

# Compilar versión de producción (genera la carpeta dist/ con la PWA)
npm.cmd run build
```

### Logo oficial de RV Group
Si deseás mostrar el logo oficial en el inicio de sesión, en el menú lateral y en los PDFs de órdenes de reparación, guardá la imagen como **`public/logo-rvgroup.png`**.
