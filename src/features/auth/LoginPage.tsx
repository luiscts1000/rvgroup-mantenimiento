import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LogIn, Mail, KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, friendlyError } from '@/lib/supabase';
import { Button, Field } from '@/components/ui';
import { Logo } from '@/components/layout/Logo';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { session, inactive } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        navigate('/', { replace: true });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/restablecer-clave`,
        });
        if (error) throw error;
        toast.success(
          'Si el email está registrado, recibirá un enlace para restablecer la contraseña.',
        );
        setMode('login');
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-gradient-to-br from-[#071c38] via-[#113f78] to-[#0a2547] p-4">
      {/* Resplandores decorativos con colores del logo (Azul y Verde Hoja) */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full bg-rvgreen-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -bottom-32 h-96 w-96 rounded-full bg-brand-400/25 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo light size="lg" />
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rvgreen-400/40 bg-white/10 px-3.5 py-1 text-xs font-bold uppercase tracking-widest text-rvgreen-300 backdrop-blur-xs">
            <ShieldCheck className="h-3.5 w-3.5 text-rvgreen-400" />
            Sistema de Mantenimiento y Flota
          </span>
        </div>

        <form
          onSubmit={onSubmit}
          className="card relative overflow-hidden rounded-2xl border border-white/20 bg-white/95 p-6 shadow-2xl backdrop-blur-md dark:bg-slate-900/95 sm:p-8"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-rvgreen-500 via-rvgreen-400 to-brand-600" />
          <div className="mb-5">
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">
              {mode === 'login' ? 'Acceso Corporativo' : 'Recuperar contraseña'}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {mode === 'login'
                ? 'Coordinación de Mantenimiento y Portal de Taller Móvil'
                : 'Le enviaremos un enlace seguro a su correo electrónico'}
            </p>
          </div>
          {inactive && (
            <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">
              Su usuario está desactivado. Contacte al administrador.
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <Field label="Correo electrónico" required>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  className="input pl-9"
                  autoComplete="username"
                  placeholder="usuario@rvgroup.com.ar"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </Field>
            {mode === 'login' && (
              <Field label="Contraseña" required>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="password"
                    className="input pl-9"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </Field>
            )}
            <Button
              type="submit"
              className="w-full py-2.5 text-base"
              loading={loading}
              icon={<LogIn className="h-4 w-4" />}
            >
              {mode === 'login' ? 'Ingresar a RV Group' : 'Enviar enlace'}
            </Button>
          </div>
          <button
            type="button"
            className="mt-4 w-full text-center text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
            onClick={() => {
              setError(null);
              setMode(mode === 'login' ? 'forgot' : 'login');
            }}
          >
            {mode === 'login' ? '¿Olvidó su contraseña?' : 'Volver al ingreso'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs font-medium text-brand-100/80">
          © {new Date().getFullYear()} RV GROUP SRL · División Transporte y Servicios
        </p>
      </div>
    </div>
  );
}

/** Pantalla a la que llega el enlace de recuperación por email. */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirm) return setError('Las contraseñas no coinciden.');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(friendlyError(error));
    toast.success('Contraseña actualizada correctamente.');
    navigate('/', { replace: true });
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-[#071c38] via-[#113f78] to-[#0a2547] p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 rounded-2xl p-6 shadow-2xl">
        <h1 className="text-lg font-bold">Nueva contraseña</h1>
        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <Field label="Nueva contraseña" required hint="Mínimo 8 caracteres">
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Repetir contraseña" required>
          <input
            type="password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Guardar contraseña
        </Button>
      </form>
    </div>
  );
}
