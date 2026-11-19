import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ChevronLeft, CloudOff, Ellipsis, Send, SlidersHorizontal, Trash2 } from 'lucide-preact';
import type { EditorView } from '@codemirror/view';
import { cmd, createEditor, focusBody, scrollToBody, type EditorHandle } from '../cm';
import { app, docStatus, editDoc, flushDoc, getRecord, loadDoc, onDocReplaced, queueImage, toast, uploadImageNow } from '../sync';
import { useStore } from '../state';
import { readMeta, updateFrontmatter, type MetaPatch } from '../frontmatter';
import { focusOnOpen, goBack } from '../route';
import { useMedia } from '../viewport';
import { prepareImage } from '../images';
import { Button, IconButton, Menu, Segmented } from '../components/ui';
import { SyncIndicator } from '../components/Sync';
import { Toolbar } from '../components/Toolbar';
import { PreviewPane } from '../components/Preview';
import { DetailsSheet } from './DetailsSheet';
import { PublishSheet } from './PublishSheet';
import { DeleteSheet } from './DeleteSheet';
import { ConflictSheet } from './ConflictSheet';
import { errMessage } from '../util';
import { NetworkError } from '../api';

type Mode = 'write' | 'preview';
type SheetName = 'details' | 'publish' | 'delete' | 'conflict' | null;

export function Editor({ file }: { file: string }) {
  const [load, setLoad] = useState<{ s: 'loading' } | { s: 'error'; msg: string } | { s: 'ready' }>({ s: 'loading' });
  const wide = useMedia('(min-width: 900px)');
  const [mode, setMode] = useState<Mode>('write');
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<SheetName>(null);
  const [menu, setMenu] = useState(false);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflictDismissed = useRef(false);
  const status = useStore(app, (s) => docStatus(file, s));
  const online = useStore(app, (s) => s.online);

  // load the document (local first, refresh from the PC when possible)
  useEffect(() => {
    let alive = true;
    setLoad({ s: 'loading' });
    loadDoc(file)
      .then(() => alive && setLoad({ s: 'ready' }))
      .catch((e) => alive && setLoad({ s: 'error', msg: errMessage(e) }));
    return () => {
      alive = false;
      void flushDoc(file);
    };
  }, [file]);

  // mount CodeMirror once the record exists
  useEffect(() => {
    if (load.s !== 'ready' || !host.current) return;
    const rec = getRecord(file);
    if (!rec) return;
    setText(rec.content);
    const h = createEditor(host.current, rec.content, {
      onChange: (t) => {
        editDoc(file, t);
        clearTimeout(textTimer.current);
        textTimer.current = setTimeout(() => setText(t), 250);
      },
      onState: setUndoState,
    });
    handle.current = h;
    if (focusOnOpen.has(file)) {
      focusOnOpen.delete(file);
      requestAnimationFrame(() => focusBody(h));
    } else {
      requestAnimationFrame(() => scrollToBody(h));
    }
    const off = onDocReplaced((f) => {
      if (f !== file) return;
      const r = getRecord(file);
      if (r) {
        h.setText(r.content);
        setText(r.content);
      }
    });
    return () => {
      off();
      clearTimeout(textTimer.current);
      h.destroy();
      handle.current = null;
    };
  }, [load.s, file]);

  // re-measure when the editor pane becomes visible again
  useEffect(() => {
    if (mode === 'write' || wide) requestAnimationFrame(() => handle.current?.view.requestMeasure());
  }, [mode, wide]);

  // open the conflict sheet once when a conflict appears
  useEffect(() => {
    if (status === 'conflict' && !conflictDismissed.current) {
      conflictDismissed.current = true;
      setSheet('conflict');
    }
    if (status !== 'conflict') conflictDismissed.current = false;
  }, [status]);

  const meta = useMemo(() => readMeta(text), [text]);
  const rec = getRecord(file);
  const ext: 'md' | 'mdx' = file.endsWith('.mdx') ? 'mdx' : 'md';
  const previewUrl = rec?.url || `/blog/${file.replace(/\.(md|mdx)$/, '')}/`;

  const applyMeta = useCallback((patch: MetaPatch) => {
    const h = handle.current;
    if (!h) return;
    const t = h.getText();
    const n = updateFrontmatter(t, patch);
    if (n !== t) {
      h.setText(n);
      setText(n);
    }
  }, []);

  const getView = useCallback((): EditorView | null => handle.current?.view ?? null, []);

  const onPickImage = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const { blob, name } = await prepareImage(f);
      let finalName = name;
      let queued = false;
      if (app.get().online) {
        try {
          finalName = await uploadImageNow(name, blob);
        } catch (err) {
          if (err instanceof NetworkError) {
            await queueImage(name, blob);
            queued = true;
          } else throw err;
        }
      } else {
        await queueImage(name, blob);
        queued = true;
      }
      const v = handle.current?.view;
      if (v) cmd.image(v, finalName);
      toast(queued ? 'Image added. It will upload when you are back online.' : 'Image uploaded', queued ? 'info' : 'success');
    } catch (err) {
      toast(`Could not add the image: ${errMessage(err)}`, 'error');
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === 'preview') (document.activeElement as HTMLElement | null)?.blur?.();
  };

  if (load.s === 'error') {
    return (
      <div class="screen editor">
        <header class="topbar">
          <IconButton label="Back to posts" onClick={goBack}><ChevronLeft size={26} /></IconButton>
          <div class="topbar-title"><div class="t-main">Post unavailable</div></div>
        </header>
        <div class="empty" style={{ margin: 'auto' }}>
          <div class="empty-ico"><CloudOff size={28} /></div>
          <h2>Cannot open this post</h2>
          <p>{load.msg}</p>
          <Button onClick={goBack}>Back to posts</Button>
        </div>
      </div>
    );
  }

  const showWrite = wide || mode === 'write';
  const showPreview = wide || mode === 'preview';

  return (
    <div class={`screen editor ${wide ? 'is-wide' : ''}`}>
      <header class="topbar">
        <IconButton label="Back to posts" onClick={goBack}><ChevronLeft size={26} /></IconButton>
        <div class="topbar-title">
          <div class="t-main">{load.s === 'loading' ? 'Opening…' : meta.title || file}</div>
          <div class="t-sub">
            {load.s === 'ready' ? <SyncIndicator file={file} onConflict={() => setSheet('conflict')} /> : <span class="sync">Loading…</span>}
            {meta.draft && load.s === 'ready' && <span class="draft-chip">Draft</span>}
          </div>
        </div>
        {!wide && (
          <Segmented<Mode>
            class="mode-seg"
            label="Write or preview"
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'write', label: 'Write' },
              { value: 'preview', label: 'Preview' },
            ]}
          />
        )}
        <div class="menu-anchor">
          <IconButton label="More actions" haspopup expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Ellipsis size={22} />
          </IconButton>
          <Menu
            open={menu}
            onClose={() => setMenu(false)}
            items={[
              { label: 'Post details', icon: <SlidersHorizontal size={18} />, onSelect: () => setSheet('details') },
              { label: 'Open pull request…', icon: <Send size={18} />, onSelect: () => setSheet('publish') },
              { label: 'Delete post', icon: <Trash2 size={18} />, danger: true, onSelect: () => setSheet('delete'), hint: online ? undefined : 'Needs a connection' },
            ]}
          />
        </div>
      </header>

      {load.s === 'loading' ? (
        <div class="editor-loading" aria-busy="true">
          <span class="sk sk-line" style={{ width: '60%' }} />
          <span class="sk sk-line" style={{ width: '90%' }} />
          <span class="sk sk-line" style={{ width: '80%' }} />
          <span class="sk sk-line" style={{ width: '70%' }} />
        </div>
      ) : (
        <div class="editor-body">
          <div class="pane pane-write" hidden={!showWrite}>
            <div class="cm-host" ref={host} />
          </div>
          {/* Always mounted so the page is already loaded when Preview is pressed. */}
          <div class={`pane pane-preview ${showPreview ? '' : 'is-off'}`} aria-hidden={!showPreview}>
            <PreviewPane file={file} ext={ext} url={previewUrl} text={text} active={showPreview} />
          </div>
        </div>
      )}

      {load.s === 'ready' && showWrite && (
        <Toolbar getView={getView} canUndo={undoState.canUndo} canRedo={undoState.canRedo} onImage={() => fileInput.current?.click()} />
      )}
      <input ref={fileInput} type="file" accept="image/*" class="visually-hidden" tabIndex={-1} aria-hidden="true" onChange={onPickImage} />

      <DetailsSheet open={sheet === 'details'} onClose={() => setSheet(null)} file={file} meta={meta} applyMeta={applyMeta} />
      <PublishSheet
        open={sheet === 'publish'}
        onClose={() => setSheet(null)}
        file={file}
        meta={meta}
        applyMeta={applyMeta}
        onOpenConflict={() => setSheet('conflict')}
      />
      <DeleteSheet open={sheet === 'delete'} onClose={() => setSheet(null)} file={file} title={meta.title || file} />
      <ConflictSheet open={sheet === 'conflict'} onClose={() => setSheet(null)} file={file} />
    </div>
  );
}
