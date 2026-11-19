import { useState } from 'preact/hooks';
import { Button, Sheet } from '../components/ui';
import { app, deletePost, toast } from '../sync';
import { useStore } from '../state';
import { goBack } from '../route';
import { errMessage } from '../util';

export function DeleteSheet(props: { open: boolean; onClose: () => void; file: string; title: string }) {
  const online = useStore(app, (s) => s.online);
  const [busy, setBusy] = useState(false);
  const isNewLocal = !!app.get().local[props.file]?.isNew && !app.get().posts.some((p) => p.file === props.file);
  const canDelete = online || isNewLocal;

  const run = async () => {
    setBusy(true);
    try {
      await deletePost(props.file);
      props.onClose();
      toast('Post deleted', 'success');
      goBack();
    } catch (e) {
      toast(errMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Delete post"
      locked={busy}
      footer={
        <div class="btn-col">
          <Button kind="danger" class="wide" disabled={!canDelete} busy={busy} onClick={() => void run()}>
            Delete post
          </Button>
          <Button kind="ghost" class="wide" onClick={props.onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      }
    >
      <p class="lead">
        Delete <strong>{props.title}</strong>?
      </p>
      <p class="note">
        The file <code>{props.file}</code> is removed from the PC working tree. Git still has any committed version, so it can be restored from history.
      </p>
      {!canDelete && <p class="note warn">Deleting needs a connection to your PC. Reconnect and try again.</p>}
    </Sheet>
  );
}
