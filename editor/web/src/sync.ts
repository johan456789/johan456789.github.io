import { api, ApiError, NetworkError } from './api';
import { store as idb } from './db';
import { readMeta } from './frontmatter';
import { createStore } from './state';
import type { DocRecord, DocStatus, OutboxItem, PostMeta } from './types';
import { errMessage, uid } from './util';

export interface LocalInfo {
  dirty: boolean;
  isNew: boolean;
  conflict: boolean;
  /** metadata parsed from the local text, so lists reflect unsynced edits */
  meta: { title: string; description: string; tags: string[]; date: string | null; draft: boolean };
  ext: 'md' | 'mdx';
}

export const app = createStore({
  online: false,
  checked: false,
  astro: 'unknown' as 'ready' | 'starting' | 'down' | 'unknown',
  branch: '',
  defaultBranch: 'main',
  posts: [] as PostMeta[],
  postsState: 'loading' as 'loading' | 'ready' | 'error',
  postsError: '',
  postsFromCache: false,
  local: {} as Record<string, LocalInfo>,
  outboxCount: 0,
  inflight: {} as Record<string, true>,
  toasts: [] as { id: string; text: string; kind: 'info' | 'error' | 'success' }[],
});

/* ------------------------------------------------------------------ toasts */

export function toast(text: string, kind: 'info' | 'error' | 'success' = 'info', ms = 3200) {
  const id = uid();
  app.set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind }] }));
  setTimeout(() => dismissToast(id), kind === 'error' ? Math.max(ms, 5000) : ms);
}
export function dismissToast(id: string) {
  app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

/* ------------------------------------------------------------ connectivity */

let probeTimer: ReturnType<typeof setTimeout> | undefined;
let backoff = 2000;
let probing: Promise<boolean> | null = null;

export function probe(): Promise<boolean> {
  if (probing) return probing;
  probing = (async () => {
    try {
      const s = await api.status();
      setOnline(s);
      return true;
    } catch {
      app.set({ online: false, checked: true, astro: 'unknown' });
      scheduleProbe(backoff);
      backoff = Math.min(backoff * 2, 30000);
      return false;
    } finally {
      probing = null;
    }
  })();
  return probing;
}

function setOnline(s?: { astro: 'ready' | 'starting' | 'down'; branch: string; defaultBranch: string }) {
  const was = app.get().online;
  app.set({ online: true, checked: true, ...(s ? { astro: s.astro, branch: s.branch, defaultBranch: s.defaultBranch } : {}) });
  backoff = 2000;
  // Poll quickly while the preview server is waking up, slowly otherwise.
  scheduleProbe(s?.astro === 'starting' ? 2000 : 30000);
  if (!was) void onReconnect();
}

function scheduleProbe(ms: number) {
  clearTimeout(probeTimer);
  probeTimer = setTimeout(() => {
    // A hidden app does not poll, so the PC can put the preview server to
    // sleep; becoming visible probes again (see startConnectivity).
    if (document.visibilityState === 'visible') void probe();
  }, ms);
}

/** Called whenever a request failed because the server could not be reached. */
export function markOffline() {
  if (app.get().online) {
    app.set({ online: false });
    backoff = 2000;
    scheduleProbe(1500);
  }
}

export function startConnectivity() {
  const reprobe = () => {
    backoff = 2000;
    void probe();
  };
  window.addEventListener('online', reprobe);
  window.addEventListener('offline', () => markOffline());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reprobe();
    else void persistAll();
  });
  window.addEventListener('pagehide', () => void persistAll());
  void probe();
}

async function onReconnect() {
  await uploadOutbox();
  const files = Object.keys(runtimes);
  for (const f of files) if (runtimes[f]?.rec.dirty && !runtimes[f].rec.conflict) await syncFile(f);
  void refreshPosts();
}

/* ------------------------------------------------------------------- docs */

interface Runtime {
  rec: DocRecord;
  /** bumped on every edit */
  version: number;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
  again: boolean;
  needsPersist: boolean;
}

const runtimes: Record<string, Runtime> = {};
const replaceListeners = new Set<(file: string) => void>();

export function onDocReplaced(cb: (file: string) => void) {
  replaceListeners.add(cb);
  return () => replaceListeners.delete(cb);
}
const emitReplaced = (file: string) => replaceListeners.forEach((f) => f(file));

function extOf(file: string): 'md' | 'mdx' {
  return file.endsWith('.mdx') ? 'mdx' : 'md';
}

function refreshLocal(rt: Runtime) {
  const r = rt.rec;
  const m = readMeta(r.content);
  const info: LocalInfo = {
    dirty: r.dirty,
    isNew: r.isNew,
    conflict: !!r.conflict,
    meta: { title: m.title, description: m.description, tags: m.tags, date: m.date, draft: m.draft },
    ext: extOf(r.file),
  };
  app.set((s) => ({ local: { ...s.local, [r.file]: info } }));
}

async function persist(rt: Runtime) {
  rt.needsPersist = false;
  await idb.putDoc({ ...rt.rec });
}

async function persistAll() {
  for (const rt of Object.values(runtimes)) if (rt.needsPersist) await persist(rt);
}

export function getRecord(file: string): DocRecord | undefined {
  return runtimes[file]?.rec;
}

export function docStatus(file: string, s = app.get()): DocStatus {
  const l = s.local[file];
  if (!l) return 'saved';
  if (l.conflict) return 'conflict';
  if (l.dirty || s.inflight[file]) return s.online ? 'saving' : 'pending';
  return 'saved';
}

export function pendingCount(s = app.get()): number {
  return Object.values(s.local).filter((l) => l.dirty && !l.conflict).length + s.outboxCount;
}
export function hasUnsynced(s = app.get()): boolean {
  return Object.values(s.local).some((l) => l.dirty || l.conflict) || s.outboxCount > 0;
}

function adopt(rec: DocRecord): Runtime {
  const rt: Runtime = { rec, version: 0, again: false, needsPersist: false };
  runtimes[rec.file] = rt;
  refreshLocal(rt);
  return rt;
}

export type LoadResult = { rec: DocRecord; refreshed: boolean };

export async function loadDoc(file: string): Promise<LoadResult> {
  let rt = runtimes[file];
  if (!rt) {
    const stored = await idb.getDoc(file);
    if (stored) rt = adopt(stored);
  }
  if (rt && (rt.rec.dirty || rt.rec.conflict || rt.rec.isNew)) {
    if (app.get().online && !rt.rec.conflict) scheduleSync(file, 0);
    return { rec: rt.rec, refreshed: false };
  }
  const refresh = async (): Promise<boolean> => {
    try {
      const remote = await api.getPost(file);
      const cur = runtimes[file];
      if (cur) {
        // never clobber edits that arrived while we were fetching
        if (cur.rec.dirty || cur.version !== startVersion) return false;
        if (cur.rec.baseHash === remote.hash && cur.rec.content === remote.content) return false;
        cur.rec = { ...cur.rec, content: remote.content, baseHash: remote.hash, url: remote.url, dirty: false, isNew: false };
        await persist(cur);
        refreshLocal(cur);
        emitReplaced(file);
        return true;
      }
      const created = adopt({
        file, content: remote.content, baseHash: remote.hash, dirty: false, localUpdatedAt: Date.now(), isNew: false, url: remote.url,
      });
      await persist(created);
      return true;
    } catch (e) {
      if (e instanceof NetworkError) markOffline();
      else if (e instanceof ApiError && e.status === 404 && !cachedOnly) throw e;
      return false;
    }
  };
  const startVersion = rt?.version ?? 0;
  const cachedOnly = !!rt;
  if (rt) {
    // show the cached copy immediately; refresh quietly
    void refresh();
    return { rec: rt.rec, refreshed: false };
  }
  try {
    await refresh();
  } catch (e) {
    throw e;
  }
  const got = runtimes[file];
  if (!got) {
    if (!app.get().online) throw new Error('This post is not available offline yet. Open it once while connected.');
    throw new Error('Could not load this post.');
  }
  return { rec: got.rec, refreshed: true };
}

export async function createDoc(file: string, content: string) {
  const rt = adopt({ file, content, baseHash: null, dirty: true, localUpdatedAt: Date.now(), isNew: true });
  rt.version++;
  await persist(rt);
  refreshLocal(rt);
  scheduleSync(file, 0);
}

export function editDoc(file: string, content: string) {
  const rt = runtimes[file];
  if (!rt || rt.rec.content === content) return;
  rt.rec = { ...rt.rec, content, dirty: true, localUpdatedAt: Date.now() };
  rt.version++;
  rt.needsPersist = true;
  const prev = app.get().local[file];
  if (!prev || !prev.dirty) refreshLocal(rt); // flip to dirty immediately
  scheduleSync(file, 600);
}

function scheduleSync(file: string, delay: number) {
  const rt = runtimes[file];
  if (!rt) return;
  clearTimeout(rt.timer);
  rt.timer = setTimeout(() => void syncFile(file), delay);
}

/** Persist + push now. Resolves once this file has nothing left to send (or cannot be sent). */
export async function flushDoc(file: string): Promise<'saved' | 'offline' | 'conflict'> {
  const rt = runtimes[file];
  if (!rt) return 'saved';
  clearTimeout(rt.timer);
  await syncFile(file);
  const r = runtimes[file]?.rec;
  if (!r) return 'saved';
  if (r.conflict) return 'conflict';
  if (r.dirty) return 'offline';
  return 'saved';
}

function setInflight(file: string, on: boolean) {
  app.set((s) => {
    const inflight = { ...s.inflight };
    if (on) inflight[file] = true;
    else delete inflight[file];
    return { inflight };
  });
}

export function syncFile(file: string): Promise<void> {
  const rt = runtimes[file];
  if (!rt) return Promise.resolve();
  clearTimeout(rt.timer);
  if (rt.running) {
    rt.again = true;
    return rt.running;
  }
  rt.running = (async () => {
    // yield first: `running` must be assigned before the finally block below can clear it
    await Promise.resolve();
    try {
      do {
        rt.again = false;
        if (rt.needsPersist) await persist(rt);
        refreshLocal(rt);
              if (!rt.rec.dirty || rt.rec.conflict) return;
        if (!app.get().online) return;
        const sentVersion = rt.version;
        const sentContent = rt.rec.content;
        const base = rt.rec.baseHash;
        setInflight(file, true);
        try {
          const res = await api.putPost(file, sentContent, base);
          rt.rec = {
            ...rt.rec,
            baseHash: res.hash,
            isNew: false,
            dirty: rt.version !== sentVersion || rt.rec.content !== sentContent,
          };
          await persist(rt);
          refreshLocal(rt);
          if (rt.rec.dirty) rt.again = true;
          patchPostCache(file, sentContent, res.hash);
        } catch (e) {
          if (e instanceof NetworkError) {
            markOffline();
            return;
          }
          if (e instanceof ApiError && e.status === 409 && (e.code === 'conflict' || e.code === 'exists')) {
            const remote = e.data || {};
            if (typeof remote.content === 'string' && remote.content === sentContent) {
              // identical on both sides: not a real conflict
              rt.rec = { ...rt.rec, baseHash: remote.hash, isNew: false, dirty: rt.version !== sentVersion };
              await persist(rt);
              refreshLocal(rt);
              if (rt.rec.dirty) rt.again = true;
              continue;
            }
            rt.rec = {
              ...rt.rec,
              conflict: { content: remote.content ?? null, hash: remote.hash ?? null, kind: e.code as 'conflict' | 'exists' },
            };
            await persist(rt);
            refreshLocal(rt);
            return;
          }
          toast(`Could not save: ${errMessage(e)}`, 'error');
          return;
        } finally {
          setInflight(file, false);
        }
      } while (rt.again);
    } finally {
      rt.running = undefined;
    }
  })();
  return rt.running;
}

export async function resolveConflict(file: string, choice: 'mine' | 'theirs'): Promise<'ok' | 'gone' | 'failed'> {
  const rt = runtimes[file];
  if (!rt || !rt.rec.conflict) return 'ok';
  const c = rt.rec.conflict;
  if (choice === 'theirs') {
    if (c.content === null || c.hash === null) {
      await discardDoc(file);
      return 'gone';
    }
    rt.rec = { ...rt.rec, content: c.content, baseHash: c.hash, dirty: false, isNew: false, conflict: null };
    rt.version++;
    await persist(rt);
    refreshLocal(rt);
    emitReplaced(file);
    return 'ok';
  }
  // keep mine: force write
  const sentVersion = rt.version;
  const sentContent = rt.rec.content;
  try {
    setInflight(file, true);
    const res = await api.putPost(file, sentContent, c.hash ? c.hash : null, true);
    rt.rec = { ...rt.rec, baseHash: res.hash, isNew: false, conflict: null, dirty: rt.version !== sentVersion };
    await persist(rt);
    refreshLocal(rt);
    if (rt.rec.dirty) scheduleSync(file, 0);
    return 'ok';
  } catch (e) {
    if (e instanceof NetworkError) markOffline();
    toast(`Could not save: ${errMessage(e)}`, 'error');
    return 'failed';
  } finally {
    setInflight(file, false);
  }
}

async function discardDoc(file: string) {
  const rt = runtimes[file];
  if (rt) clearTimeout(rt.timer);
  delete runtimes[file];
  await idb.deleteDoc(file);
  app.set((s) => {
    const local = { ...s.local };
    delete local[file];
    return { local, posts: s.posts.filter((p) => p.file !== file || !p.hash) };
  });
}

export async function deletePost(file: string): Promise<void> {
  const rt = runtimes[file];
  const meta = app.get().posts.find((p) => p.file === file);
  if (rt && rt.rec.isNew && rt.rec.baseHash === null) {
    await discardDoc(file);
    return;
  }
  const baseHash = rt?.rec.baseHash ?? meta?.hash;
  if (!baseHash) throw new Error('Cannot delete a post that is not on the PC.');
  if (rt) await flushDoc(file);
  const base2 = runtimes[file]?.rec.baseHash ?? baseHash;
  try {
    await api.deletePost(file, base2);
  } catch (e) {
    if (e instanceof NetworkError) markOffline();
    throw e;
  }
  await discardDoc(file);
  app.set((s) => ({ posts: s.posts.filter((p) => p.file !== file) }));
  await idb.setPosts(app.get().posts);
}

export function fileExistsKnown(file: string): boolean {
  const s = app.get();
  return !!runtimes[file] || s.posts.some((p) => p.file === file) || !!s.local[file];
}

/* ------------------------------------------------------------------ posts */

function patchPostCache(file: string, content: string, hash: string) {
  const m = readMeta(content);
  app.set((s) => {
    const i = s.posts.findIndex((p) => p.file === file);
    const base: PostMeta =
      i >= 0
        ? s.posts[i]
        : {
            file, slug: file.replace(/\.(md|mdx)$/, ''), ext: extOf(file), title: '', description: '', date: null, tags: [],
            draft: false, hash, mtime: Date.now(), git: 'new', url: `/blog/${file.replace(/\.(md|mdx)$/, '')}/`,
          };
    const next = { ...base, title: m.title, description: m.description, tags: m.tags, date: m.date, draft: m.draft, hash, mtime: Date.now(), git: base.git === 'new' ? 'new' : 'modified' } as PostMeta;
    const posts = i >= 0 ? s.posts.map((p, j) => (j === i ? next : p)) : [next, ...s.posts];
    return { posts };
  });
  void idb.setPosts(app.get().posts);
}

let postsLoaded = false;
export async function refreshPosts(): Promise<void> {
  if (!postsLoaded) {
    postsLoaded = true;
    const cached = await idb.getPosts();
    if (cached.length) {
      cached.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      app.set({ posts: cached, postsState: 'ready', postsFromCache: true });
    }
  }
  try {
    const { posts } = await api.posts();
    app.set({ posts, postsState: 'ready', postsError: '', postsFromCache: false });
    if (!app.get().online) setOnline();
    void probe();
    await idb.setPosts(posts);
  } catch (e) {
    if (e instanceof NetworkError) {
      markOffline();
      if (app.get().postsState === 'loading') app.set({ postsState: 'ready' });
    } else {
      app.set({ postsState: app.get().posts.length ? 'ready' : 'error', postsError: errMessage(e) });
    }
  }
}

/* ----------------------------------------------------------------- images */

const pendingBlobs = new Map<string, Blob>();
export function pendingImage(name: string): Blob | undefined {
  return pendingBlobs.get(name);
}

async function updateOutboxCount() {
  const items = await idb.getOutbox();
  items.forEach((i) => pendingBlobs.set(i.name, i.blob));
  app.set({ outboxCount: items.length });
}

export async function queueImage(name: string, blob: Blob) {
  const item: OutboxItem = { id: uid(), name, blob, type: blob.type, createdAt: Date.now() };
  pendingBlobs.set(name, blob);
  await idb.putOutbox(item);
  await updateOutboxCount();
}

/** Uploads straight away; throws NetworkError when offline so the caller can queue. */
export async function uploadImageNow(name: string, blob: Blob): Promise<string> {
  try {
    const r = await api.putAsset(name, blob);
    return r.name;
  } catch (e) {
    if (e instanceof NetworkError) markOffline();
    throw e;
  }
}

let uploading = false;
export async function uploadOutbox() {
  if (uploading) return;
  uploading = true;
  try {
    const items = (await idb.getOutbox()).sort((a, b) => a.createdAt - b.createdAt);
    for (const it of items) {
      try {
        const r = await api.putAsset(it.name, it.blob);
        if (r.name !== it.name) await rewriteAssetRefs(it.name, r.name);
        await idb.deleteOutbox(it.id);
        pendingBlobs.delete(it.name);
      } catch (e) {
        if (e instanceof NetworkError) {
          markOffline();
          break;
        }
        toast(`Image ${it.name} could not be uploaded: ${errMessage(e)}`, 'error');
        await idb.deleteOutbox(it.id);
      }
    }
  } finally {
    uploading = false;
    await updateOutboxCount();
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function rewriteAssetRefs(oldName: string, newName: string) {
  const re = new RegExp(`(assets/)${esc(oldName)}(?=[)\\s"'>])`, 'g');
  const all = await idb.getAllDocs();
  for (const d of all) {
    const rt = runtimes[d.file] || adopt(d);
    if (!re.test(rt.rec.content)) continue;
    re.lastIndex = 0;
    const next = rt.rec.content.replace(re, `$1${newName}`);
    editDoc(d.file, next);
    await persist(rt);
    emitReplaced(d.file);
  }
}

/* ------------------------------------------------------------------- boot */

export async function boot() {
  const docs = await idb.getAllDocs();
  for (const d of docs) if (d.dirty || d.conflict || d.isNew) adopt(d);
  await updateOutboxCount();
  startConnectivity();
  void refreshPosts();
}
