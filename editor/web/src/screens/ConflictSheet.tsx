import { useEffect, useState } from 'preact/hooks';
import { Button, Segmented, Sheet } from '../components/ui';
import { app, getRecord, resolveConflict, toast } from '../sync';
import { useStore } from '../state';
import { goBack } from '../route';

export function ConflictSheet(props: { open: boolean; onClose: () => void; file: string }) {
  const hasConflict = useStore(app, (s) => !!s.local[props.file]?.conflict);
  const [view, setView] = useState<'choose' | 'mine' | 'theirs'>('choose');
  const [busy, setBusy] = useState(false);
  const rec = getRecord(props.file);
  const c = rec?.conflict;

  useEffect(() => {
    if (props.open) setView('choose');
  }, [props.open]);
  useEffect(() => {
    if (props.open && !hasConflict) props.onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConflict, props.open]);

  const exists = c?.kind === 'exists';
  const gone = c && c.content === null;

  const choose = async (choice: 'mine' | 'theirs') => {
    setBusy(true);
    const r = await resolveConflict(props.file, choice);
    setBusy(false);
    if (r === 'gone') {
      props.onClose();
      toast('The PC copy was deleted, so your version was discarded', 'info');
      goBack();
    } else if (r === 'ok') {
      props.onClose();
      toast(choice === 'mine' ? 'Your version was saved to the PC' : 'Switched to the PC version', 'success');
    }
  };

  return (
    <Sheet open={props.open} onClose={props.onClose} title="Sync conflict" locked={busy} tall={view !== 'choose'}>
      {view === 'choose' ? (
        <>
          <p class="lead">
            {exists
              ? 'A post with this file name already exists on the PC'
              : gone
                ? 'This post was deleted on the PC since your last sync'
                : 'This post changed on the PC since your last sync'}
          </p>
          <p class="note">
            Your edits on this phone have not been sent. Nothing is overwritten until you choose. You can look at both versions first.
          </p>
          <div class="btn-col">
            <Button kind="primary" class="wide" busy={busy} onClick={() => void choose('mine')}>
              Keep my version
            </Button>
            <p class="choice-note">Replaces the PC copy with what is on this phone.</p>
            <Button kind="secondary" class="wide" disabled={busy} onClick={() => void choose('theirs')}>
              {gone ? 'Discard my version' : 'Use the PC version'}
            </Button>
            <p class="choice-note">Discards the edits made on this phone.</p>
            <Button kind="ghost" class="wide" disabled={busy} onClick={() => setView('mine')}>
              Compare both versions
            </Button>
          </div>
        </>
      ) : (
        <div class="compare">
          <Segmented<'mine' | 'theirs'>
            label="Version to view"
            value={view}
            onChange={setView}
            options={[
              { value: 'mine', label: 'My version' },
              { value: 'theirs', label: 'On the PC' },
            ]}
          />
          <pre class="compare-text" tabIndex={0} aria-label={view === 'mine' ? 'My version' : 'PC version'}>
            {view === 'mine' ? rec?.content : c?.content ?? '(The file no longer exists on the PC.)'}
          </pre>
          <div class="btn-row">
            <Button kind="secondary" onClick={() => setView('choose')}>
              Back
            </Button>
            <Button kind="primary" busy={busy} onClick={() => void choose(view === 'mine' ? 'mine' : 'theirs')}>
              {view === 'mine' ? 'Keep mine' : 'Use PC version'}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
