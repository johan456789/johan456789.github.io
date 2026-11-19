import { useEffect, useState } from 'preact/hooks';
import { Check, CloudOff, GitBranch, TriangleAlert } from 'lucide-preact';
import { app, docStatus, pendingCount } from '../sync';
import { useStore } from '../state';

/** Per-document indicator: Saved · Saving… · Offline, N changes waiting · Conflict. */
export function SyncIndicator(props: { file: string; onConflict?: () => void }) {
  const status = useStore(app, (s) => docStatus(props.file, s));
  const count = useStore(app, (s) => pendingCount(s));
  // "Saving…" only shows if the save takes a moment; quick saves stay on "Saved" (no flicker per keystroke)
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (status !== 'saving') {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 1100);
    return () => clearTimeout(t);
  }, [status]);

  if (status === 'conflict') {
    return (
      <button class="sync sync-conflict" onClick={props.onConflict} aria-label="Conflict. Review versions">
        <TriangleAlert size={13} /> Conflict · Resolve
      </button>
    );
  }
  if (status === 'pending') {
    return (
      <span class="sync sync-offline" role="status" aria-label={`Offline, ${count} ${count === 1 ? 'change' : 'changes'} waiting`}>
        <CloudOff size={13} /> Offline · {count} waiting
      </span>
    );
  }
  if (status === 'saving' && slow) {
    return (
      <span class="sync sync-saving" role="status">
        <span class="pulse-dot" aria-hidden="true" /> Saving…
      </span>
    );
  }
  return (
    <span class="sync sync-saved" role="status">
      <Check size={13} /> Saved
    </span>
  );
}

/** Connection + branch pill for the home header. */
export function ConnectionPill() {
  const online = useStore(app, (s) => s.online);
  const checked = useStore(app, (s) => s.checked);
  const branch = useStore(app, (s) => s.branch);
  const count = useStore(app, (s) => pendingCount(s));
  if (!checked) return <span class="pill pill-muted">Connecting…</span>;
  return (
    <div class="pill-row">
      <span class={`pill ${online ? 'pill-ok' : 'pill-off'}`}>
        <span class="dot" aria-hidden="true" />
        {online ? 'Connected' : count ? `Offline · ${count} waiting` : 'Offline'}
      </span>
      {online && branch && (
        <span class="pill pill-muted" title="Current git branch">
          <GitBranch size={13} />
          <span class="pill-branch">{branch}</span>
        </span>
      )}
    </div>
  );
}
