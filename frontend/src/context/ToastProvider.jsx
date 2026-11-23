import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// alias kapital supaya dikenali ESLint no-unused-vars saat dipakai sebagai <Motion.div>
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { ToastContext } from './FeedbackContext';

const DURATION = { success: 3500, info: 4000, warning: 5000, error: 6000 };

// warna dari token tema, jadi ikut berubah di setiap palet (termasuk tema gelap)
const STYLE = {
  success: { icon: 'fa-circle-check', accent: 'text-success-fg', bar: 'bg-success-fg' },
  error: { icon: 'fa-circle-exclamation', accent: 'text-danger', bar: 'bg-danger' },
  warning: { icon: 'fa-triangle-exclamation', accent: 'text-warning-fg', bar: 'bg-warning-fg' },
  info: { icon: 'fa-circle-info', accent: 'text-primary', bar: 'bg-primary' },
};

function ToastItem({ toast, onDismiss }) {
  const { icon, accent, bar } = STYLE[toast.type];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION[toast.type]);
  const startedAt = useRef(0);

  // hilang otomatis; dijeda saat kursor di atas toast supaya sempat dibaca
  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, toast.id, onDismiss]);

  return (
    <Motion.div
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
      transition={{ type: 'tween', duration: 0.2 }}
      role={toast.type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="pointer-events-auto relative w-full sm:w-80 overflow-hidden rounded-lg border border-line bg-surface text-fg shadow-lg"
    >
      <span className={`absolute left-0 inset-y-0 w-1 ${bar}`} aria-hidden="true"></span>
      <div className="flex items-start gap-3 py-3 pl-4 pr-2">
        <i className={`fa ${icon} ${accent} mt-0.5`} aria-hidden="true"></i>
        <p className="flex-1 min-w-0 text-sm break-words">{toast.message}</p>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="w-6 h-6 shrink-0 rounded hover:bg-subtle text-muted cursor-pointer"
        >
          <i className="fa fa-xmark text-xs"></i>
        </button>
      </div>
    </Motion.div>
  );
}

/** Notifikasi singkat di pojok kanan atas, pengganti alert(). */
export default function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((type, message) => {
    if (!message) return;
    const id = nextId.current++;
    // maksimal 4 toast; yang paling lama dibuang
    setToasts((list) => [...list.slice(-3), { id, type, message }]);
  }, []);

  const api = useMemo(() => ({
    success: (msg) => show('success', msg),
    error: (msg) => show('error', msg),
    warning: (msg) => show('warning', msg),
    info: (msg) => show('info', msg),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed z-[60] top-16 right-0 left-0 sm:left-auto px-4 flex flex-col items-end gap-2"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
