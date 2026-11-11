import { useRef, useState, useEffect } from 'react';
import { RotateCcw, Check, PenTool } from 'lucide-react';
import { Button, Modal } from '@/components/ui';

interface SignaturePadModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (signatureDataUrl: string) => void;
  title?: string;
  signerName?: string;
  roleLabel?: string;
}

export function SignaturePadModal({
  open,
  onClose,
  onSave,
  title = 'Firma digital en pantalla',
  signerName,
  roleLabel = 'Firmante',
}: SignaturePadModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Ajustar resolución interna al tamaño CSS
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      ctx.scale(2, 2);

      // Fondo blanco limpio
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Estilo de línea de firma (azul oscuro profesional tipo lapicera)
      ctx.strokeStyle = '#0f2c59';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Línea de base punteada tenue
      ctx.save();
      ctx.strokeStyle = '#cbd5e1';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(20, rect.height - 35);
      ctx.lineTo(rect.width - 20, rect.height - 35);
      ctx.stroke();
      ctx.restore();

      setHasDrawn(false);
    }, 100);

    return () => clearTimeout(timer);
  }, [open]);

  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Ignorar si ya se liberó
    }
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.strokeStyle = '#cbd5e1';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, rect.height - 35);
    ctx.lineTo(rect.width - 20, rect.height - 35);
    ctx.stroke();
    ctx.restore();

    setHasDrawn(false);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={title}
      footer={
        <div className="flex w-full items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClear}
            icon={<RotateCcw className="h-4 w-4" />}
            className="text-xs text-slate-600"
          >
            Limpiar firma
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={!hasDrawn}
              icon={<Check className="h-4 w-4" />}
            >
              Confirmar firma
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <PenTool className="h-4 w-4 text-brand-600 dark:text-brand-400" />
            <span>Firmá con el dedo, lápiz óptico o mouse sobre el recuadro blanco:</span>
          </div>
          {signerName && (
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {roleLabel}: {signerName}
            </span>
          )}
        </div>

        {/* Lienzo de Firma */}
        <div className="relative touch-none overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white shadow-inner dark:border-slate-700">
          <canvas
            ref={canvasRef}
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            className="h-56 w-full cursor-crosshair touch-none"
            style={{ touchAction: 'none' }}
          />

          <div className="pointer-events-none absolute bottom-2 left-4 text-[11px] text-slate-400">
            Línea de firma y conformidad
          </div>
        </div>

        {signerName && (
          <p className="text-center font-mono text-xs text-slate-500">
            Aclaración: <b className="text-slate-700 dark:text-slate-300">{signerName}</b>
          </p>
        )}
      </div>
    </Modal>
  );
}
