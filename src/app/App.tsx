import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { isSupabaseConfigured } from '@/lib/supabase';
import { MODULES, CURRENT_STAGE } from '@/lib/constants';
import type { ModuleKey, PermAction } from '@/types/db';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { LoginPage, ResetPasswordPage } from '@/features/auth/LoginPage';
import { AppLayout } from '@/components/layout/AppLayout';
import { ComingSoonPage, SetupGuidePage } from '@/components/layout/ComingSoonPage';
import { EmptyState, Spinner } from '@/components/ui';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { VehiclesPage } from '@/features/vehicles/VehiclesPage';
import { VehicleDetailPage } from '@/features/vehicles/VehicleDetailPage';
import { ImportWizardPage } from '@/features/vehicles/ImportWizardPage';
import { useFleetRealtime } from '@/features/vehicles/api';
import { WorkOrdersPage } from '@/features/workOrders/WorkOrdersPage';
import { WorkOrderDetailPage } from '@/features/workOrders/WorkOrderDetailPage';
import { useWorkOrdersRealtime } from '@/features/workOrders/api';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { usePartsRealtime } from '@/features/inventory/api';
import { ServicesPage } from '@/features/services/ServicesPage';
import { PendingPage } from '@/features/pending/PendingPage';
import { usePendingAndAppointmentsRealtime } from '@/features/pending/api';
import { AppointmentsPage } from '@/features/appointments/AppointmentsPage';
import { PreventivePage } from '@/features/preventive/PreventivePage';
import { usePreventiveRealtime } from '@/features/preventive/api';
import { HistoryPage } from '@/features/history/HistoryPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { UsersPage } from '@/features/users/UsersPage';
import { SettingsPage } from '@/features/settings/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
});

function RequireAuth() {
  const { session, loading } = useAuth();
  useFleetRealtime();
  useWorkOrdersRealtime();
  usePartsRealtime();
  usePendingAndAppointmentsRealtime();
  usePreventiveRealtime();
  if (loading) return <Spinner className="min-h-[100dvh]" />;
  if (!session) return <Navigate to="/ingresar" replace />;
  return <AppLayout />;
}

function Guard({ module, action = 'view', children }: { module: ModuleKey; action?: PermAction; children: ReactNode }) {
  const { profile, can, loading } = useAuth();
  if (loading) return <Spinner />;
  // Si el usuario tiene rol Mecánico, solo accede a las Hojas de Trabajo (/ordenes)
  if (profile?.role === 'mecanico' && module !== 'work_orders') {
    return <Navigate to="/ordenes" replace />;
  }
  if (!can(module, action)) {
    return <EmptyState title="Acceso restringido" description="Su usuario no tiene permisos para acceder a esta sección." />;
  }
  return <>{children}</>;
}

export function App() {
  if (!isSupabaseConfigured) return <SetupGuidePage />;
  const futureModules = MODULES.filter((m) => m.stage > CURRENT_STAGE);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/ingresar" element={<LoginPage />} />
            <Route path="/restablecer-clave" element={<ResetPasswordPage />} />
            <Route element={<RequireAuth />}>
              <Route
                index
                element={
                  <Guard module="dashboard">
                    <DashboardPage />
                  </Guard>
                }
              />
              <Route
                path="unidades"
                element={
                  <Guard module="vehicles">
                    <VehiclesPage />
                  </Guard>
                }
              />
              <Route
                path="unidades/importar"
                element={
                  <Guard module="vehicles" action="create">
                    <ImportWizardPage />
                  </Guard>
                }
              />
              <Route
                path="unidades/:id"
                element={
                  <Guard module="vehicles">
                    <VehicleDetailPage />
                  </Guard>
                }
              />
              <Route
                path="ordenes"
                element={
                  <Guard module="work_orders">
                    <WorkOrdersPage />
                  </Guard>
                }
              />
              <Route
                path="ordenes/:id"
                element={
                  <Guard module="work_orders">
                    <WorkOrderDetailPage />
                  </Guard>
                }
              />
              <Route
                path="inventario"
                element={
                  <Guard module="inventory">
                    <InventoryPage />
                  </Guard>
                }
              />
              <Route
                path="servicios"
                element={
                  <Guard module="services">
                    <ServicesPage />
                  </Guard>
                }
              />
              <Route
                path="pendientes"
                element={
                  <Guard module="pending">
                    <PendingPage />
                  </Guard>
                }
              />
              <Route
                path="turnos"
                element={
                  <Guard module="appointments">
                    <AppointmentsPage />
                  </Guard>
                }
              />
              <Route
                path="preventivo"
                element={
                  <Guard module="preventive">
                    <PreventivePage />
                  </Guard>
                }
              />
              <Route
                path="historial"
                element={
                  <Guard module="history">
                    <HistoryPage />
                  </Guard>
                }
              />
              <Route
                path="reportes"
                element={
                  <Guard module="reports">
                    <ReportsPage />
                  </Guard>
                }
              />
              <Route
                path="usuarios"
                element={
                  <Guard module="users">
                    <UsersPage />
                  </Guard>
                }
              />
              <Route
                path="configuracion"
                element={
                  <Guard module="settings">
                    <SettingsPage />
                  </Guard>
                }
              />
              {futureModules.map((m) => (
                <Route
                  key={m.key}
                  path={m.path.slice(1)}
                  element={
                    <Guard module={m.key}>
                      <ComingSoonPage mod={m} />
                    </Guard>
                  }
                />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
