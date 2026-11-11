import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Logo oficial de RV Group Transporte con acabado ejecutivo, cápsula luminosa,
 * anillo de acento verde hoja / azul corporativo y animación suave al pasar el cursor.
 */
export function Logo({
  light,
  size = 'md',
  compact,
}: {
  light?: boolean;
  size?: 'md' | 'lg';
  compact?: boolean;
}) {
  const [srcIndex, setSrcIndex] = useState(0);
  const sources = ['/logo-rvgroup.png', '/logo-rvgroup.png.png'];
  const imgOk = srcIndex < sources.length;

  return (
    <div className="group inline-flex items-center gap-3 select-none transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.03]">
      {imgOk ? (
        <div
          className={cn(
            'relative inline-flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-white via-white to-slate-50 transition-all duration-300',
            light
              ? 'shadow-[0_10px_28px_-6px_rgba(124,209,0,0.45)] ring-2 ring-rvgreen-400/80 group-hover:ring-rvgreen-300 group-hover:shadow-[0_14px_34px_-4px_rgba(124,209,0,0.6)]'
              : 'shadow-md ring-2 ring-brand-600/20 group-hover:ring-rvgreen-500/60 group-hover:shadow-lg',
            size === 'lg'
              ? 'px-6 py-3.5'
              : compact
                ? 'p-1.5'
                : 'w-full px-3.5 py-2',
          )}
        >
          {/* Barra superior de acento corporativo (Verde hoja -> Azul RV Group) */}
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rvgreen-500 via-rvgreen-400 to-brand-600" />
          <img
            src={sources[srcIndex]}
            alt="RV Group Transporte"
            className={cn(
              size === 'lg'
                ? 'h-16 sm:h-20'
                : compact
                  ? 'h-7'
                  : 'h-11',
              'w-auto object-contain drop-shadow-[0_1px_2px_rgba(20,85,155,0.12)] transition-transform duration-300 group-hover:scale-[1.04]',
            )}
            onError={() => setSrcIndex((i) => i + 1)}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              'flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rvgreen-500 to-rvgreen-600 font-extrabold text-white shadow-lg ring-2 ring-white/40',
              size === 'lg' ? 'h-14 w-14 text-xl' : 'h-10 w-10 text-sm',
            )}
          >
            RV
          </div>
          {!compact && (
            <div className="leading-tight">
              <p
                className={cn(
                  'font-extrabold tracking-tight',
                  light ? 'text-white' : 'text-brand-700 dark:text-white',
                  size === 'lg' ? 'text-2xl' : 'text-sm',
                )}
              >
                RV GROUP
              </p>
              <p
                className={cn(
                  'text-[11px] font-bold uppercase tracking-widest',
                  light ? 'text-rvgreen-300' : 'text-rvgreen-600',
                )}
              >
                Transporte
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
