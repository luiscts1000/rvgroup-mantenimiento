import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LogOut,
  Menu,
  Moon,
  Sun,
  X,
  ChevronsLeft,
  ChevronsRight,
  Lock,
  KeyRound,
  ShieldCheck,
  Bell,
  Download,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/AuthProvider';
import { MODULES, ROLE_LABELS, CURRENT_STAGE, type ModuleDef } from '@/lib/constants';
import { cn, getUserDisplayName } from '@/lib/utils';
import { Logo } from './Logo';
import { ChangePasswordModal } from './ChangePasswordModal';
import { AlertsCenterModal } from './AlertsCenterModal';
import { EditProfileModal } from './EditProfileModal';
import { useFleetStats } from '@/features/vehicles/api';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('rv-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function NavItem({
  m,
  collapsed,
  onClick,
  customLabel,
}: {
  m: ModuleDef;
  collapsed?: boolean;
  onClick?: () => void;
  customLabel?: string;
}) {
  const locked = m.stage > CURRENT_STAGE;
  const Icon = m.icon;
  const displayLabel = customLabel || m.label;
  return (
    <NavLink
      to={m.path}
      end={m.path === '/'}
      onClick={onClick}
      title={collapsed ? displayLabel : undefined}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 hover:translate-x-1',
          isActive
            ? 'bg-gradient-to-r from-rvgreen-500 to-rvgreen-400 font-bold text-slate-950 shadow-[0_6px_16px_-3px_rgba(124,209,0,0.45)]'
            : 'text-brand-100/90 hover:bg-white/10 hover:text-white',
          locked && 'opacity-60',
          collapsed && 'justify-center px-2',
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110" />
      {!collapsed && <span className="flex-1 truncate">{displayLabel}</span>}
      {!collapsed && locked && (
        <span className="flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase">
          <Lock className="h-3 w-3" /> Etapa {m.stage}
        </span>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  const { profile, can, signOut } = useAuth();
  const { dark, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rv-sidebar') === '1');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const location = useLocation();

  const [profileOpen, setProfileOpen] = useState(false);

  const { data: stats } = useFleetStats();

  const totalAlertsCount =
    (stats?.rto_expired ?? 0) +
    (stats?.rto_due_soon ?? 0) +
    (stats?.maintenance_alerts ?? 0) +
    (stats?.parts_low_stock ?? 0) +
    (stats?.pending_urgent ?? 0);

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => localStorage.setItem('rv-sidebar', collapsed ? '1' : '0'), [collapsed]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      toast.success('¡Aplicación RV Group instalada con éxito!');
    }
  };

  const isMechanicOnly = profile?.role === 'mecanico';
  const userDisplayName = getUserDisplayName(profile);

  // El mecánico solo ve su apartado de Hojas de Trabajo (Órdenes de Reparación)
  const visible = isMechanicOnly
    ? MODULES.filter((m) => m.key === 'work_orders')
    : MODULES.filter((m) => can(m.key, 'view'));

  const bottomNav = visible.filter((m) => m.stage <= CURRENT_STAGE).slice(0, 4);

  const userBlock = (
    <div className="border-t border-white/10 bg-black/15 p-3.5">
      <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rvgreen-500 to-brand-600 text-sm font-extrabold text-white shadow-md ring-2 ring-white/20 transition hover:scale-105"
          title="Editar mi nombre y datos de perfil"
        >
          {(userDisplayName || '?').charAt(0).toUpperCase()}
        </button>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p
                onClick={() => setProfileOpen(true)}
                className="cursor-pointer truncate text-sm font-semibold text-white transition hover:text-rvgreen-300"
                title="Haga clic para editar su nombre y datos"
              >
                {userDisplayName}
              </p>
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white"
                title="Editar mi nombre"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-rvgreen-300">
              <span className="h-1.5 w-1.5 rounded-full bg-rvgreen-400" />
              {profile ? ROLE_LABELS[profile.role] : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] bg-slate-50/80 dark:bg-slate-950">
      {/* Menú lateral (computadoras) */}
      <aside
        className={cn(
          'sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-r border-brand-800/40 bg-gradient-to-b from-[#0a274c] via-[#113f78] to-[#081d38] shadow-2xl transition-all dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 lg:flex',
          collapsed ? 'w-[78px]' : 'w-68',
        )}
      >
        <div
          className={cn(
            'flex flex-col justify-center border-b border-white/10 bg-white/[0.04] px-4 py-4',
            collapsed && 'items-center px-2 py-3',
          )}
        >
          <Logo light compact={collapsed} />
          {!collapsed && (
            <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rvgreen-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rvgreen-400" />
              {isMechanicOnly ? 'Portal Taller · Hojas OT' : 'Gestión Integral de Flota'}
            </div>
          )}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {visible.map((m) => (
            <NavItem
              key={m.key}
              m={m}
              collapsed={collapsed}
              customLabel={isMechanicOnly && m.key === 'work_orders' ? 'Hojas de Trabajo (OT)' : undefined}
            />
          ))}
        </nav>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-medium text-brand-200 transition hover:bg-white/10 hover:text-white"
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" /> Contraer menú
            </>
          )}
        </button>
        {userBlock}
      </aside>

      {/* Menú desplegable (celulares / tablets) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-gradient-to-b from-[#0a274c] via-[#113f78] to-[#081d38] shadow-2xl dark:from-slate-950 dark:to-slate-900">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3.5">
              <Logo light />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-xl p-2 text-white hover:bg-white/10"
                aria-label="Cerrar menú"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
              {visible.map((m) => (
                <NavItem
                  key={m.key}
                  m={m}
                  customLabel={isMechanicOnly && m.key === 'work_orders' ? 'Hojas de Trabajo (OT)' : undefined}
                />
              ))}
            </nav>
            {userBlock}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior ejecutiva */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/95 px-3 shadow-xs backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 sm:px-6">
          {!isMechanicOnly && (
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <div className="lg:hidden">
            <Logo compact />
          </div>

          <div className="hidden items-center gap-2.5 lg:flex">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1 text-xs font-bold text-brand-800 dark:border-brand-800 dark:bg-brand-950/50 dark:text-brand-200">
              <ShieldCheck className="h-3.5 w-3.5 text-rvgreen-600" />
              RV GROUP SRL · División Transporte
            </span>
            {isMechanicOnly && (
              <span className="rounded-full bg-rvgreen-100 px-3 py-1 text-xs font-bold text-rvgreen-800 dark:bg-rvgreen-900/40 dark:text-rvgreen-300">
                Modo Taller Móvil (Hojas de Trabajo)
              </span>
            )}
          </div>

          <div className="flex-1" />

          {/* Botón PWA: Instalar aplicación */}
          {deferredPrompt && !isInstalled && (
            <button
              onClick={handleInstallApp}
              className="inline-flex items-center gap-1.5 rounded-xl border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-800 shadow-xs transition hover:bg-brand-100 hover:shadow-sm dark:border-brand-700 dark:bg-brand-950/60 dark:text-brand-200"
              title="Instalar RV Mantenimiento como aplicación en este dispositivo"
            >
              <Download className="h-3.5 w-3.5 text-rvgreen-600" />
              <span className="hidden sm:inline">Instalar App</span>
            </button>
          )}

          {/* Campana de Alertas Operativas */}
          {!isMechanicOnly && (
            <button
              onClick={() => setAlertsOpen(true)}
              className="relative rounded-xl p-2 text-slate-600 transition hover:-translate-y-0.5 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              title={`Alertas y vencimientos (${totalAlertsCount})`}
            >
              <Bell className="h-5 w-5" />
              {totalAlertsCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-xs">
                  {totalAlertsCount > 99 ? '99+' : totalAlertsCount}
                </span>
              )}
            </button>
          )}

          {/* Chip de Usuario con Nombre y Apellido */}
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-slate-50/80 px-2.5 py-1 text-xs transition hover:border-brand-300 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:bg-slate-800"
            title="Editar mi nombre y datos de perfil"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-700 text-[11px] font-bold text-white dark:bg-brand-600">
              {(userDisplayName || '?').charAt(0).toUpperCase()}
            </span>
            <span className="max-w-[130px] truncate font-semibold text-slate-800 dark:text-slate-200 sm:max-w-[180px]">
              {userDisplayName}
            </span>
          </button>

          <button
            onClick={toggle}
            className="rounded-xl p-2 text-slate-600 transition hover:-translate-y-0.5 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title={dark ? 'Tema claro' : 'Tema oscuro'}
          >
            {dark ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5" />}
          </button>
          <button
            onClick={() => setPwdOpen(true)}
            className="rounded-xl p-2 text-slate-600 transition hover:-translate-y-0.5 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Cambiar mi contraseña"
          >
            <KeyRound className="h-5 w-5" />
          </button>
          <button
            onClick={() => void signOut()}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-xs transition hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </header>

        <main className="mx-auto w-full max-w-[1600px] flex-1 p-3 pb-24 sm:p-6 lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Barra inferior (celulares) — si es mecánico no necesita barra de 5 pestañas porque ya está en Hojas de Trabajo */}
      {!isMechanicOnly && (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-lg dark:border-slate-800 dark:bg-slate-950 lg:hidden">
          {bottomNav.map((m) => {
            const Icon = m.icon;
            return (
              <NavLink
                key={m.key}
                to={m.path}
                end={m.path === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold',
                    isActive ? 'text-brand-700 dark:text-rvgreen-400' : 'text-slate-500',
                  )
                }
              >
                <Icon className="h-5 w-5" />
                {m.short}
              </NavLink>
            );
          })}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-slate-500"
          >
            <Menu className="h-5 w-5" />
            Más
          </button>
        </nav>
      )}

      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />
      <AlertsCenterModal open={alertsOpen} onClose={() => setAlertsOpen(false)} />
      <EditProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
