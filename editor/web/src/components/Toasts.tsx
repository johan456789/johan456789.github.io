import { CircleAlert, CircleCheck, Info } from 'lucide-preact';
import { app, dismissToast } from '../sync';
import { useStore } from '../state';

export function Toasts() {
  const toasts = useStore(app, (s) => s.toasts);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} class={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.kind === 'error' ? <CircleAlert size={18} /> : t.kind === 'success' ? <CircleCheck size={18} /> : <Info size={18} />}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
