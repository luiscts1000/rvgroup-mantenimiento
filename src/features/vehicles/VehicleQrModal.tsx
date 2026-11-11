import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, Printer, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Modal } from '@/components/ui';
import { formatPatente } from '@/lib/patente';
import { formatNumber } from '@/lib/utils';
import type { Vehicle } from '@/types/db';

interface VehicleQrModalProps {
  open: boolean;
  onClose: () => void;
  vehicle: Vehicle | null;
}

export function VehicleQrModal({ open, onClose, vehicle }: VehicleQrModalProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const vehicleUrl = vehicle
    ? `${window.location.origin}/unidades/${vehicle.id}`
    : '';

  useEffect(() => {
    if (!vehicle || !open) return;
    setLoading(true);

    QRCode.toDataURL(vehicleUrl, {
      width: 480,
      margin: 1.5,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'H',
    })
      .then((url) => {
        setDataUrl(url);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error al generar código QR:', err);
        setLoading(false);
      });
  }, [vehicle, vehicleUrl, open]);

  if (!vehicle) return null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(vehicleUrl);
    toast.success('Enlace de la unidad copiado al portapapeles');
  };

  const handleDownloadPng = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `QR-${vehicle.patente}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.success(`Código QR de ${vehicle.patente} descargado`);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <QrCode className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          <span>Ficha QR de la Unidad · {formatPatente(vehicle.patente)}</span>
        </div>
      }
      size="sm"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="ghost" size="sm" icon={<Copy className="h-4 w-4" />} onClick={handleCopyLink}>
            Copiar link
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={handleDownloadPng}>
              Descargar PNG
            </Button>
            <Button size="sm" icon={<Printer className="h-4 w-4" />} onClick={handlePrint}>
              Imprimir etiqueta
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col items-center text-center">
        {/* Tarjeta imprimible de la unidad (estilo sticker físico de parabrisas / puerta) */}
        <div
          id="printable-vehicle-qr"
          className="w-full max-w-xs rounded-2xl border-2 border-slate-900 bg-white p-5 text-slate-900 shadow-sm print:m-0 print:border-2 print:p-6 print:shadow-none"
        >
          {/* Cabecera oficial RV Group */}
          <div className="border-b border-slate-200 pb-2 text-center">
            <span className="font-extrabold tracking-wider text-brand-800 text-sm uppercase">RV GROUP SRL</span>
            <p className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase">Mantenimiento y Flota</p>
          </div>

          {/* Patente e Interno en grande */}
          <div className="my-3 text-center">
            <div className="font-mono text-3xl font-black tracking-wider text-slate-950">
              {formatPatente(vehicle.patente)}
            </div>
            {vehicle.nro_interno && (
              <span className="mt-1 inline-block rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">
                INT. {vehicle.nro_interno}
              </span>
            )}
            <p className="mt-1 text-xs text-slate-600">
              {vehicle.marca} {vehicle.modelo} {vehicle.version || ''}
            </p>
          </div>

          {/* Imagen del código QR */}
          <div className="flex justify-center p-2">
            {loading ? (
              <div className="flex h-48 w-48 items-center justify-center rounded-xl bg-slate-50">
                <span className="text-xs text-slate-400">Generando QR…</span>
              </div>
            ) : (
              <img
                src={dataUrl}
                alt={`Código QR ${vehicle.patente}`}
                className="h-48 w-48 rounded-xl border border-slate-100 p-1"
              />
            )}
          </div>

          {/* Información complementaria */}
          <div className="border-t border-slate-200 pt-2 text-[10px] text-slate-500">
            <p className="font-medium text-slate-700">
              {vehicle.km_actual != null ? `${formatNumber(vehicle.km_actual)} km registrados` : 'Kilometraje a verificar'}
            </p>
            <p className="mt-0.5 italic">
              Escanee desde el celular para consultar historial técnico, servicios realizados y estado de RTO.
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Pegue esta etiqueta adhesiva en el marco de la puerta o parabrisas para que los supervisores o gerencia verifiquen la unidad al instante.
        </p>
      </div>
    </Modal>
  );
}
