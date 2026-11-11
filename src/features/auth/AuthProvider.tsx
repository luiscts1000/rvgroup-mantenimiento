import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { ModuleKey, PermAction, Permission, Profile } from '@/types/db';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  permissions: Permission[];
  loading: boolean;
  inactive: boolean;
  can: (module: ModuleKey, action?: PermAction) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [inactive, setInactive] = useState(false);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      setPermissions([]);
      setInactive(false);
      return;
    }
    const [{ data: prof }, { data: perms }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle(),
      supabase.rpc('my_permissions'),
    ]);
    if (prof && !prof.active) {
      setInactive(true);
      await supabase.auth.signOut();
      return;
    }
    setInactive(false);
    setProfile((prof as Profile) ?? null);
    setPermissions((perms as Permission[]) ?? []);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Diferido para no bloquear el callback de Supabase
        setTimeout(() => void loadProfile(s), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const can = useCallback(
    (module: ModuleKey, action: PermAction = 'view') => {
      if (profile?.role === 'admin') return true;
      const p = permissions.find((x) => x.module === module);
      if (!p) return false;
      return Boolean(p[`can_${action}` as keyof Permission]);
    },
    [permissions, profile],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      permissions,
      loading,
      inactive,
      can,
      refresh: () => loadProfile(session),
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, profile, permissions, loading, inactive, can, loadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
