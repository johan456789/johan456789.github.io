import { marked } from 'marked';
import { pendingImage } from './sync';
import { readMeta, splitFrontmatter } from './frontmatter';

const JSX_TAG = /<(\/?)([A-Z][\w.]*)(\s[^<>]*?)?(\/?)>/g;

function prepare(body: string, mdx: boolean): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      out.push(line);
      continue;
    }
    if (fence) {
      out.push(line);
      continue;
    }
    if (mdx && /^(import|export)\s/.test(line)) continue;
    let l = line.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<!--[\s\S]*?-->/g, '');
    if (mdx) {
      l = l.replace(JSX_TAG, (_m, close: string, name: string) =>
        close ? '' : `<span class="jsx-chip">&lt;${name} /&gt;</span>`,
      );
    }
    out.push(l);
  }
  return out.join('\n');
}

function sanitize(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const root = doc.getElementById('r')!;
  root.querySelectorAll('script,iframe,object,embed,style,link,meta,form').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name)) el.removeAttribute(a.name);
      if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noreferrer noopener');
    }
  });
  return root;
}

/** Returns sanitised HTML for the offline approximate preview and the object URLs it created (to revoke). */
export function renderApprox(content: string, ext: 'md' | 'mdx'): { html: string; urls: string[] } {
  const s = splitFrontmatter(content);
  const meta = readMeta(content);
  const body = prepare(s.body, ext === 'mdx');
  const parsed = marked.parse(body, { async: false, gfm: true, breaks: false }) as string;
  const root = sanitize(parsed);
  const urls: string[] = [];
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    const m = /(?:^|\/)assets\/([^/?#]+)$/.exec(src);
    if (!m) return;
    const name = decodeURIComponent(m[1]);
    const blob = pendingImage(name);
    if (blob) {
      const u = URL.createObjectURL(blob);
      urls.push(u);
      img.setAttribute('src', u);
    } else img.setAttribute('src', `/_editor/api/assets/${encodeURIComponent(name)}`);
    img.setAttribute('loading', 'lazy');
  });
  const head = meta.title ? `<h1 class="approx-title">${escapeHtml(meta.title)}</h1>` : '';
  return { html: head + root.innerHTML, urls };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
