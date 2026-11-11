import { useState } from 'react';
import { toast } from 'sonner';
import { supabase, friendlyError } from '@/lib/supabase';
import { Button, Field, Modal } from '@/components/ui';

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPassword('');
    setConfirm('');
    setError(null);
    onClose();
  };

  async function save() {
    setError(null);
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (password !== confirm) return setError('Las contraseñas no coinciden.');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(friendlyError(error));
    toast.success('Contraseña actualizada.');
    close();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Cambiar mi contraseña"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button onClick={save} loading={loading}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <Field label="Nueva contraseña" required hint="Mínimo 8 caracteres">
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Repetir contraseña" required>
          <input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}
