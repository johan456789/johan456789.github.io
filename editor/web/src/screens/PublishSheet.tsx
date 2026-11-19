import { useEffect, useRef, useState } from 'preact/hooks';
import { ArrowUpRight, Check, CircleAlert, FilePlus2, FileMinus2, FilePen, GitBranch, TriangleAlert } from 'lucide-preact';
import { Button, Field, Sheet, Spinner } from '../components/ui';
import { api, ApiError, NetworkError } from '../api';
import { app, docStatus, flushDoc, hasUnsynced, probe, refreshPosts, toast } from '../sync';
import { useStore } from '../state';
import type { Meta, MetaPatch } from '../frontmatter';
import type { GitInfo } from '../types';
import { errMessage } from '../util';

const STEPS = [
  { key: 'branch', label: 'Prepare branch' },
  { key: 'commit', label: 'Commit changes' },
  { key: 'push', label: 'Push to GitHub' },
  { key: 'pr', label: 'Open pull request' },
] as const;

type Phase =
  | { s: 'idle' }
  | { s: 'running'; step: number }
  | { s: 'done'; branch: string; prUrl: string | null; compareUrl: string | null; commit: string | null }
  | { s: 'error'; step: string; message: string };

export function PublishSheet(props: {
  open: boolean;
  onClose: () => void;
  file: string;
  meta: Meta;
  applyMeta: (p: MetaPatch) => void;
  onOpenConflict: () => void;
}) {
  const online = useStore(app, (s) => s.online);
  const branch = useStore(app, (s) => s.branch);
  const defaultBranch = useStore(app, (s) => s.defaultBranch);
  const status = useStore(app, (s) => docStatus(props.file, s));
  const unsynced = useStore(app, (s) => hasUnsynced(s));
  const [git, setGit] = useState<GitInfo | null>(null);
  const [gitErr, setGitErr] = useState('');
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const progress = useRef<HTMLDivElement>(null);
  const slug = props.file.replace(/\.(md|mdx)$/, '');
  const title = props.meta.title || slug;

  const loadGit = async () => {
    try {
      setGit(await api.git());
      setGitErr('');
    } catch (e) {
      if (e instanceof NetworkError) setGitErr('Cannot reach the PC.');
      else setGitErr(errMessage(e));
    }
  };

  useEffect(() => {
    if (!props.open) return;
    setPhase({ s: 'idle' });
    setMessage(`post: ${title}`);
    setGit(null);
    setGitErr('');
    void flushDoc(props.file).then(() => { if (online) void loadGit(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  // refresh the change list when the document finishes saving
  useEffect(() => {
    if (props.open && online && status === 'saved') void loadGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, online, props.open]);

  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => {
    if (phase.s === 'running' || phase.s === 'error') progress.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [phase.s]);

  const blocker: string | null = !online
    ? 'You are offline. Publishing needs a connection to your PC. Your edits are safe and will sync when you are back.'
    : status === 'conflict'
      ? 'This post has a sync conflict. Resolve it before publishing.'
      : unsynced
        ? 'Waiting for your latest edits to finish syncing…'
        : null;

  const running = phase.s === 'running';
  const onDefault = !!git && git.branch === git.defaultBranch;
  const msgOk = message.trim().length > 0;
  const noChanges = !!git && git.changes.length === 0 && !onDefault && git.ahead === 0;

  const publish = async () => {
    setPhase({ s: 'running', step: onDefault ? 0 : 1 });
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setPhase((p) => (p.s === 'running' ? { s: 'running', step: Math.min(p.step + 1, 3) } : p));
    }, 1100);
    try {
      const r = await api.publish(message.trim(), title, slug);
      clearInterval(timer.current);
      setPhase({ s: 'done', ...r });
      void probe();
      void refreshPosts();
    } catch (e) {
      clearInterval(timer.current);
      if (e instanceof NetworkError) setPhase({ s: 'error', step: 'connection', message: 'Lost the connection to your PC. Nothing was lost; check the Git state and try again.' });
      else if (e instanceof ApiError) setPhase({ s: 'error', step: e.data?.step || 'publish', message: e.message });
      else setPhase({ s: 'error', step: 'publish', message: errMessage(e) });
    }
  };

  const checkpoint = async () => {
    setCheckpointBusy(true);
    try {
      const r = await api.commit(message.trim());
      toast(`Checkpoint saved (${r.commit})`, 'success');
      await loadGit();
      void refreshPosts();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'nothing_to_commit') toast('Nothing new to commit', 'info');
      else toast(errMessage(e), 'error');
    } finally {
      setCheckpointBusy(false);
    }
  };

  const markPublished = async () => {
    props.applyMeta({ draft: false });
    await flushDoc(props.file);
    await loadGit();
  };

  const stepIndex = (key: string) => STEPS.findIndex((s) => s.key === key);

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={phase.s === 'done' ? 'Published' : 'Publish'}
      locked={running}
      tall
      footer={
        phase.s === 'done' ? (
          <div class="btn-col">
            {(phase.prUrl || phase.compareUrl) && (
              <Button kind="primary" class="wide" href={(phase.prUrl || phase.compareUrl)!}>
                {phase.prUrl ? 'View pull request' : 'Open compare page'} <ArrowUpRight size={18} />
              </Button>
            )}
            <Button kind="ghost" class="wide" onClick={props.onClose}>
              Done
            </Button>
          </div>
        ) : (
          <div class="btn-col">
            <Button kind="primary" class="wide" disabled={!!blocker || !msgOk || !git || running} busy={running} onClick={() => void publish()}>
              {running ? 'Publishing…' : phase.s === 'error' ? 'Try again' : 'Publish'}
            </Button>
            <Button kind="secondary" class="wide" disabled={!!blocker || !msgOk || !git || running || checkpointBusy || (!!git && git.changes.length === 0)} busy={checkpointBusy} onClick={() => void checkpoint()}>
              Save checkpoint
            </Button>
          </div>
        )
      }
    >
      {phase.s === 'done' ? (
        <div class="success">
          <div class="success-ico">
            <Check size={30} strokeWidth={2.6} />
          </div>
          <h3>{phase.prUrl ? 'Pull request is ready' : 'Pushed to GitHub'}</h3>
          <p class="note">
            Branch <code>{phase.branch}</code>
            {phase.commit ? ` · commit ${phase.commit}` : ''}
          </p>
          {!phase.prUrl && (
            <p class="note">The GitHub CLI is not available on the PC, so open the compare page to create the pull request.</p>
          )}
          <p class="note">After the pull request is merged, switch back to {defaultBranch} from the home screen.</p>
        </div>
      ) : (
        <div class="form">
          <div class="branch-card">
            <GitBranch size={18} aria-hidden="true" />
            <div>
              <div class="branch-name">{git?.branch || branch || '…'}</div>
              <div class="field-hint">
                {onDefault
                  ? `You are on ${git!.defaultBranch}. Publishing creates the branch post/${slug} first (or a numbered one if an unmerged post/${slug} exists).`
                  : git
                    ? 'Publishing commits to this branch and updates its pull request.'
                    : 'Checking the repository…'}
              </div>
            </div>
          </div>

          {props.meta.draft && (
            <div class="callout warn">
              <TriangleAlert size={18} aria-hidden="true" />
              <div>
                <strong>Still marked as draft</strong>
                <span>It will not appear on the published blog until the draft flag is removed.</span>
              </div>
              <Button kind="secondary" onClick={() => void markPublished()} disabled={running}>
                Mark as published
              </Button>
            </div>
          )}

          <div class="field">
            <div class="field-label">Changes</div>
            {gitErr ? (
              <div class="callout bad">
                <CircleAlert size={18} />
                <span>{gitErr}</span>
              </div>
            ) : !git ? (
              <div class="sk sk-block" aria-busy="true" />
            ) : git.changes.length === 0 ? (
              <p class="note">{noChanges ? 'Nothing to commit. The branch is already up to date.' : 'No file changes to commit.'}</p>
            ) : (
              <ul class="changes">
                {git.changes.map((c) => (
                  <li key={c.path}>
                    {c.status === 'new' ? <FilePlus2 size={16} class="c-new" /> : c.status === 'deleted' ? <FileMinus2 size={16} class="c-del" /> : <FilePen size={16} class="c-mod" />}
                    <span class="c-path">{c.path.replace(/^src\/(content\/docs\/)?/, '')}</span>
                    <span class="c-status">{c.status}</span>
                  </li>
                ))}
              </ul>
            )}
            {git && git.otherChanges > 0 && (
              <div class="field-hint">
                {git.otherChanges} other {git.otherChanges === 1 ? 'file' : 'files'} changed on the PC; they are left out.
              </div>
            )}
          </div>

          <Field label="Commit message" for="p-msg">
            <input
              id="p-msg"
              class="input"
              type="text"
              autoCapitalize="none"
              enterKeyHint="done"
              value={message}
              disabled={running}
              onInput={(e) => setMessage((e.target as HTMLInputElement).value)}
            />
          </Field>

          {blocker && (
            <div class="callout info" role="status">
              <CircleAlert size={18} aria-hidden="true" />
              <div>
                <span>{blocker}</span>
                {status === 'conflict' && (
                  <button type="button" class="link-btn" onClick={props.onOpenConflict}>
                    Resolve conflict
                  </button>
                )}
              </div>
            </div>
          )}

          <div ref={progress} class="progress">
          {phase.s !== 'idle' && (
            <ol class="steps" aria-label="Publish progress">
              {STEPS.map((st, i) => {
                const failed = phase.s === 'error' && stepIndex(phase.step) === i;
                const done = phase.s === 'running' ? i < phase.step : phase.s === 'error' ? stepIndex(phase.step) > i : false;
                const active = phase.s === 'running' && i === phase.step;
                const skipped = !onDefault && i === 0;
                return (
                  <li key={st.key} class={`${done ? 'done' : ''} ${active ? 'active' : ''} ${failed ? 'failed' : ''} ${skipped ? 'skipped' : ''}`}>
                    <span class="step-ico">{failed ? <CircleAlert size={16} /> : done || skipped ? <Check size={16} /> : active ? <Spinner /> : <span class="step-dot" />}</span>
                    {st.label}
                    {skipped && <small> · already on a branch</small>}
                  </li>
                );
              })}
            </ol>
          )}
          {phase.s === 'error' && (
            <div class="callout bad" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <div>
                <strong>Failed at step: {STEPS.find((s) => s.key === phase.step)?.label.toLowerCase() || phase.step}</strong>
                <span>{phase.message}</span>
              </div>
            </div>
          )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
