import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CloudOff, TriangleAlert } from 'lucide-preact';
import { app, docStatus, flushDoc } from '../sync';
import { useStore } from '../state';
import { renderApprox } from '../approxPreview';

export function PreviewPane(props: { file: string; ext: 'md' | 'mdx'; url: string; text: string; active: boolean }) {
  const online = useStore(app, (s) => s.online);
  const astro = useStore(app, (s) => s.astro);
  const status = useStore(app, (s) => docStatus(props.file, s));
  const approx = !online || astro === 'down' || astro === 'unknown';
  const [updating, setUpdating] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const savedY = useRef(0);
  const approxScroll = useRef<HTMLDivElement>(null);
  const [everActive, setEverActive] = useState(props.active);

  const [loaded, setLoaded] = useState(false);

  // Load the page in the background shortly after the post opens, so the
  // first switch to Preview shows it at once instead of an empty frame.
  useEffect(() => {
    if (props.active) return setEverActive(true);
    const t = setTimeout(() => setEverActive(true), 800);
    return () => clearTimeout(t);
  }, [props.active]);

  useEffect(() => setLoaded(false), [props.url]);

  // make sure pending edits reach the PC before the iframe shows them
  useEffect(() => {
    if (!props.active) return;
    let alive = true;
    setUpdating(true);
    void flushDoc(props.file).then(() => {
      if (alive) setTimeout(() => alive && setUpdating(false), online ? 900 : 0);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.active, props.file]);

  const busy = props.active && !approx && (updating || status === 'saving' || status === 'pending');

  const rendered = useMemo(() => (approx && props.active ? renderApprox(props.text, props.ext) : null), [approx, props.active, props.text, props.ext]);
  useEffect(() => () => rendered?.urls.forEach((u) => URL.revokeObjectURL(u)), [rendered]);

  const onLoad = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    setLoaded(true);
    try {
      // The Astro dev toolbar is noise inside the preview; hide it.
      const style = w.document.createElement('style');
      style.textContent = 'astro-dev-toolbar{display:none!important}';
      w.document.head.appendChild(style);
      w.addEventListener('scroll', () => (savedY.current = w.scrollY), { passive: true });
      w.scrollTo(0, savedY.current);
      setTimeout(() => w.scrollTo(0, savedY.current), 120);
      setTimeout(() => w.scrollTo(0, savedY.current), 500);
    } catch {
      /* cross-origin: nothing to restore */
    }
  };

  return (
    <div class="preview-pane">
      {approx ? (
        <div class="approx-banner" role="status">
          {!online ? <CloudOff size={15} /> : <TriangleAlert size={15} />}
          <span>{!online ? 'Offline preview — approximate' : 'Preview server is not running — approximate preview'}</span>
        </div>
      ) : astro === 'starting' ? (
        <div class="approx-banner soft" role="status">
          <span>The blog preview is still starting up.</span>
        </div>
      ) : null}
      {approx ? (
        <div class="approx-scroll" ref={approxScroll}>
          <article class="approx prose" dangerouslySetInnerHTML={{ __html: rendered?.html || '' }} />
        </div>
      ) : everActive ? (
        <iframe ref={frame} class={`preview-frame ${loaded ? 'is-loaded' : ''}`} tabIndex={props.active ? 0 : -1} title="Post preview" src={props.url} onLoad={onLoad} />
      ) : null}
      <div class={`updating ${busy ? 'on' : ''}`} role="status" aria-live="polite">
        {busy && (
          <>
            <span class="pulse-dot" aria-hidden="true" /> Updating…
          </>
        )}
      </div>
    </div>
  );
}
