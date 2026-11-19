// Dev-only in-memory implementation of the editor API (see editor/README.md), for `MOCK=1 pnpm dev`.
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { marked } from 'marked';
import { samples } from './samples.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const FILE_RE = /^[a-z0-9][a-z0-9-]*\.(md|mdx)$/;
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.(png|jpe?g|gif|webp|avif|svg)$/;

export default function mockApi() {
  const files = new Map(); // file -> { content, mtime }
  const committed = new Map(); // file -> hash at last commit
  const assets = new Map(); // name -> { buf, type, committed }
  let branch = 'main';
  const defaultBranch = 'main';
  let astro = 'ready';
  let offline = false; // simulate unreachable server
  let latency = 0;
  let failPublishStep = null;
  const base = Date.now();

  let i = 0;
  for (const [f, c] of Object.entries(samples)) {
    files.set(f, { content: c, mtime: base - 86400000 * (30 - i++ * 3) });
    committed.set(f, sha(c));
  }
  // one post is already modified on the "PC" but uncommitted
  files.get('on-writing-slowly.md').content += '\nA late note typed on the PC.\n';
  files.get('on-writing-slowly.md').mtime = Date.now() - 3600000;

  const meta = (file) => {
    const { content, mtime } = files.get(file);
    let fm = {};
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (m) { try { fm = YAML.parse(m[1]) || {}; } catch {} }
    const slug = file.replace(/\.(md|mdx)$/, '');
    const h = sha(content);
    const c = committed.get(file);
    return {
      file, slug, ext: file.endsWith('.mdx') ? 'mdx' : 'md',
      title: String(fm.title ?? ''), description: String(fm.description ?? ''),
      date: fm.date ? (fm.date instanceof Date ? fm.date.toISOString() : String(fm.date)) : null,
      tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [], draft: fm.draft === true,
      hash: h, mtime, git: c === undefined ? 'new' : c === h ? 'clean' : 'modified',
      url: `/blog/${slug}/`,
    };
  };
  const changes = () => {
    const out = [];
    for (const [f, v] of files) {
      const c = committed.get(f);
      if (c === undefined) out.push({ path: `src/content/docs/blog/${f}`, status: 'new' });
      else if (c !== sha(v.content)) out.push({ path: `src/content/docs/blog/${f}`, status: 'modified' });
    }
    for (const [f] of committed) if (!files.has(f)) out.push({ path: `src/content/docs/blog/${f}`, status: 'deleted' });
    for (const [n, a] of assets) if (!a.committed) out.push({ path: `src/assets/${n}`, status: 'new' });
    return out;
  };
  const commit = () => {
    for (const [f, v] of files) committed.set(f, sha(v.content));
    for (const f of [...committed.keys()]) if (!files.has(f)) committed.delete(f);
    for (const a of assets.values()) a.committed = true;
    return Math.random().toString(16).slice(2, 9);
  };

  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const send = (res, status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  const err = (res, status, error, message, extra = {}) => send(res, status, { error, message, ...extra });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const page = (slug) => {
    const e = files.get(`${slug}.md`) || files.get(`${slug}.mdx`);
    if (!e) return null;
    let body = e.content.replace(/^---[\s\S]*?\n---\r?\n/, '');
    body = body.replace(/^(import|export) .*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const html = marked.parse(body);
    const h = sha(e.content);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${slug}</title><style>body{font:17px/1.7 Georgia,serif;max-width:40rem;margin:0 auto;padding:24px 20px 400px;color:#222;background:#fff}
h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25}code{background:#f1f1f1;padding:1px 5px;border-radius:4px}pre{background:#f6f6f6;padding:12px;overflow:auto}
blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:16px;color:#555}.site{font:600 13px system-ui;color:#888;margin-bottom:24px}</style></head>
<body><div class="site">Mock blog · /blog/${slug}/</div>${html}
<script>const h=${JSON.stringify(h)};setInterval(async()=>{try{const r=await fetch('/_editor/api/__mock/hash/${slug}');const j=await r.json();if(j.hash!==h)location.reload()}catch{}},800)</script></body></html>`;
  };

  return {
    name: 'blog-editor-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://x');
        const p = url.pathname;

        const bm = /^\/blog\/([^/]+)\/?$/.exec(p);
        if (bm) {
          const html = page(bm[1]);
          if (!html) { res.statusCode = 404; return res.end('Not found'); }
          res.setHeader('content-type', 'text/html; charset=utf-8');
          return res.end(html);
        }
        if (!p.startsWith('/_editor/api/')) return next();
        const route = p.slice('/_editor/api'.length);
        const method = req.method;

        // --- mock controls
        if (route.startsWith('/__mock/')) {
          const q = url.searchParams;
          if (route === '/__mock/offline') { offline = q.get('on') === '1'; return send(res, 200, { offline }); }
          if (route === '/__mock/latency') { latency = Number(q.get('ms') || 0); return send(res, 200, { latency }); }
          if (route === '/__mock/astro') { astro = q.get('state') || 'ready'; return send(res, 200, { astro }); }
          if (route === '/__mock/fail-publish') { failPublishStep = q.get('step') || null; return send(res, 200, { failPublishStep }); }
          if (route === '/__mock/touch') {
            const f = q.get('file'); const e = files.get(f);
            if (!e) return err(res, 404, 'not_found', 'no such file');
            e.content += `\n\nEdited on the PC at ${new Date().toLocaleTimeString()}.\n`;
            e.mtime = Date.now();
            return send(res, 200, { hash: sha(e.content) });
          }
          const hm = /^\/__mock\/hash\/(.+)$/.exec(route);
          if (hm) {
            const e = files.get(`${hm[1]}.md`) || files.get(`${hm[1]}.mdx`);
            return send(res, 200, { hash: e ? sha(e.content) : null });
          }
          return err(res, 404, 'not_found', 'unknown mock route');
        }

        if (offline) { req.socket.destroy(); return; }
        if (latency) await sleep(latency);

        const mutating = method !== 'GET' && method !== 'HEAD';
        if (mutating && req.headers['x-editor'] !== '1') return err(res, 403, 'forbidden', 'Missing X-Editor header');
        const sfs = req.headers['sec-fetch-site'];
        if (sfs && sfs !== 'same-origin') return err(res, 403, 'forbidden', 'Cross-site request');

        try {
          if (route === '/status' && method === 'GET') return send(res, 200, { ok: true, astro, branch, defaultBranch });
          if (route === '/posts' && method === 'GET') {
            const posts = [...files.keys()].map(meta).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            return send(res, 200, { posts });
          }
          const pm = /^\/posts\/([^/]+)$/.exec(route);
          if (pm) {
            const file = decodeURIComponent(pm[1]);
            if (!FILE_RE.test(file)) return err(res, 400, 'bad_name', 'Invalid file name');
            const cur = files.get(file);
            if (method === 'GET') {
              if (!cur) return err(res, 404, 'not_found', 'No such post');
              return send(res, 200, { file, content: cur.content, hash: sha(cur.content), mtime: cur.mtime, url: `/blog/${file.replace(/\.(md|mdx)$/, '')}/` });
            }
            const body = JSON.parse((await readBody(req)).toString() || '{}');
            if (method === 'PUT') {
              if (typeof body.content !== 'string') return err(res, 400, 'bad_body', 'content required');
              if (body.baseHash === null) {
                if (cur && !body.force) return err(res, 409, 'exists', 'File already exists', { content: cur.content, hash: sha(cur.content) });
              } else if (!body.force) {
                if (!cur) return err(res, 409, 'conflict', 'File is gone', { content: null, hash: null });
                if (sha(cur.content) !== body.baseHash) return err(res, 409, 'conflict', 'File changed', { content: cur.content, hash: sha(cur.content) });
              }
              const next = { content: body.content, mtime: Date.now() };
              if (cur && cur.content === body.content) next.mtime = cur.mtime;
              files.set(file, next);
              return send(res, 200, { hash: sha(body.content), mtime: next.mtime });
            }
            if (method === 'DELETE') {
              if (!cur || sha(cur.content) !== body.baseHash) return err(res, 409, 'conflict', 'File changed', { content: cur?.content ?? null, hash: cur ? sha(cur.content) : null });
              files.delete(file);
              return send(res, 200, { ok: true });
            }
          }
          const am = /^\/assets\/([^/]+)$/.exec(route);
          if (am) {
            const name = decodeURIComponent(am[1]);
            if (!ASSET_RE.test(name)) return err(res, 400, 'bad_name', 'Invalid asset name');
            if (method === 'GET') {
              const a = assets.get(name);
              if (!a) return err(res, 404, 'not_found', 'No such asset');
              res.setHeader('content-type', a.type); return res.end(a.buf);
            }
            if (method === 'PUT') {
              const buf = await readBody(req);
              if (buf.length > 25 * 1024 * 1024) return err(res, 413, 'too_large', 'Too large');
              let final = name; let n = 2;
              const dot = name.lastIndexOf('.');
              while (assets.has(final) && !assets.get(final).buf.equals(buf)) final = `${name.slice(0, dot)}-${n++}${name.slice(dot)}`;
              if (!assets.has(final)) assets.set(final, { buf, type: req.headers['content-type'] || 'application/octet-stream', committed: false });
              return send(res, 200, { name: final, path: `src/assets/${final}` });
            }
          }
          if (route === '/git' && method === 'GET') {
            return send(res, 200, { branch, defaultBranch, hasRemote: true, ahead: branch === defaultBranch ? 0 : 1, behind: 0, changes: changes(), otherChanges: 1 });
          }
          if (route === '/git/commit' && method === 'POST') {
            if (!changes().length) return err(res, 409, 'nothing_to_commit', 'Nothing to commit');
            return send(res, 200, { commit: commit() });
          }
          if (route === '/git/publish' && method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString() || '{}');
            const fail = (step) => err(res, 500, 'publish_failed', `Mock failure at ${step}: remote rejected the update`, { step });
            await sleep(500);
            if (branch === defaultBranch) {
              if (!body.slug) return err(res, 400, 'slug_required', 'slug required');
              if (failPublishStep === 'branch') return fail('branch');
              branch = `post/${body.slug}`;
            }
            let sha1 = null;
            if (changes().length) { if (failPublishStep === 'commit') return fail('commit'); sha1 = commit(); }
            await sleep(500);
            if (failPublishStep === 'push') return fail('push');
            await sleep(500);
            if (failPublishStep === 'pr') return fail('pr');
            return send(res, 200, { branch, commit: sha1, prUrl: 'https://github.com/example/blog/pull/12', compareUrl: `https://github.com/example/blog/compare/${branch}?expand=1` });
          }
          if (route === '/git/sync-main' && method === 'POST') {
            if (changes().length) return err(res, 409, 'dirty', 'There are uncommitted changes');
            branch = defaultBranch;
            return send(res, 200, { branch });
          }
          return err(res, 404, 'not_found', 'Unknown route');
        } catch (e) {
          return err(res, 500, 'internal', String(e && e.message));
        }
      });
    },
  };
}
