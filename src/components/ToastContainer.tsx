import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastMessage } from '../types';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-white/[0.12] bg-[#171A21] p-3.5 shadow-xl text-xs"
        >
          {toast.type === 'success' && (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          {toast.type === 'error' && (
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          )}
          {toast.type === 'info' && (
            <Info className="h-4 w-4 text-[#60A5FA] shrink-0 mt-0.5" aria-hidden="true" />
          )}

          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-medium text-[#F3F4F6]">{toast.title}</p>
            {toast.detail && <p className="text-[#9CA3AF] leading-snug">{toast.detail}</p>}
          </div>

          <button
            type="button"
            aria-label={`Dismiss notification: ${toast.title}`}
            onClick={() => onDismiss(toast.id)}
            className="rounded p-0.5 text-[#6B7280] hover:text-[#F3F4F6] transition-colors shrink-0"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
