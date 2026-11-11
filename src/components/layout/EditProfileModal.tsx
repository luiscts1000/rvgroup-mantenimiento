import { useState, useEffect, type FormEvent } from 'react';
import { toast } from 'sonner';
import { User, Phone, Check } from 'lucide-react';
import { Button, Field, Modal } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase, friendlyError } from '@/lib/supabase';

interface EditProfileModalProps {
  open: boolean;
  onClose: () => void;
}

export function EditProfileModal({ open, onClose }: EditProfileModalProps) {
  const { profile, refresh } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && profile) {
      setFullName(profile.full_name || '');
      setPhone(profile.phone || '');
    }
  }, [open, profile]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (!fullName.trim()) {
      return toast.error('Ingrese su nombre y apellido');
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: phone.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id);

      if (error) throw error;

      await refresh();
      toast.success('¡Nombre y datos de perfil actualizados con éxito!');
      onClose();
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Mi Perfil · Nombre y Apellido"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={loading} icon={<Check className="h-4 w-4" />}>
            Guardar cambios
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          <p>
            Tu nombre aparecerá en todas las órdenes de trabajo, movimientos de pañol, firmas y en la barra superior del sistema.
          </p>
        </div>

        <Field label="Nombre y Apellido completo" required>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
              <User className="h-4 w-4" />
            </span>
            <input
              type="text"
              className="input text-sm font-semibold"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ej.: Luis Rodríguez"
              autoFocus
              required
            />
          </div>
        </Field>

        <Field label="Teléfono de contacto (opcional)">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800">
              <Phone className="h-4 w-4" />
            </span>
            <input
              type="tel"
              className="input text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej.: 299-1234567"
            />
          </div>
        </Field>

        <div className="text-[11px] text-slate-400">
          Cuenta vinculada: <span className="font-mono">{profile?.email}</span>
        </div>

        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
