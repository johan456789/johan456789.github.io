import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CircleAlert, CloudOff, FileText, GitBranch, GitCommitHorizontal, Plus, RefreshCw, Search, X } from 'lucide-preact';
import { app, refreshPosts, toast, probe } from '../sync';
import { useStore } from '../state';
import { api, ApiError } from '../api';
import { formatDate } from '../util';
import { go } from '../route';
import { Button, IconButton, Segmented } from '../components/ui';
import { ConnectionPill } from '../components/Sync';
import { NewPostSheet } from './NewPostSheet';
import type { PostMeta } from '../types';

type Filter = 'all' | 'drafts' | 'published';

interface Row extends PostMeta {
  unsynced: boolean;
  localOnly: boolean;
  conflict: boolean;
}

function useRows(): Row[] {
  const posts = useStore(app, (s) => s.posts);
  const local = useStore(app, (s) => s.local);
  return useMemo(() => {
    const byFile = new Map<string, Row>();
    for (const p of posts) {
      const l = local[p.file];
      const base: Row = { ...p, unsynced: false, localOnly: false, conflict: false };
      if (l) {
        Object.assign(base, l.meta.title || l.meta.date ? l.meta : {}, {
          unsynced: l.dirty,
          conflict: l.conflict,
        });
      }
      byFile.set(p.file, base);
    }
    for (const [file, l] of Object.entries(local)) {
      if (byFile.has(file)) continue;
      if (!l.isNew && !l.dirty) continue;
      byFile.set(file, {
        file, slug: file.replace(/\.(md|mdx)$/, ''), ext: l.ext, ...l.meta, hash: '', mtime: Date.now(), git: 'new',
        url: `/blog/${file.replace(/\.(md|mdx)$/, '')}/`, unsynced: true, localOnly: true, conflict: l.conflict,
      });
    }
    return [...byFile.values()].sort((a, b) => (b.date || '9999').localeCompare(a.date || '9999'));
  }, [posts, local]);
}

export function Home() {
  const rows = useRows();
  const postsState = useStore(app, (s) => s.postsState);
  const postsError = useStore(app, (s) => s.postsError);
  const online = useStore(app, (s) => s.online);
  const checked = useStore(app, (s) => s.checked);
  const branch = useStore(app, (s) => s.branch);
  const defaultBranch = useStore(app, (s) => s.defaultBranch);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);

  useEffect(() => {
    void refreshPosts();
  }, []);

  const doRefresh = async () => {
    setRefreshing(true);
    await Promise.all([probe(), refreshPosts(), new Promise((r) => setTimeout(r, 450))]);
    setRefreshing(false);
  };

  // pull to refresh
  const touch = useRef<{ y: number; active: boolean } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const el = scroller.current;
    if (el && el.scrollTop <= 0) touch.current = { y: e.touches[0].clientY, active: false };
  };
  const onTouchMove = (e: TouchEvent) => {
    const t = touch.current;
    const el = scroller.current;
    if (!t || !el) return;
    const dy = e.touches[0].clientY - t.y;
    if (dy > 0 && el.scrollTop <= 0) {
      t.active = true;
      setPull(Math.min(80, dy * 0.5));
    } else if (t.active) setPull(0);
  };
  const onTouchEnd = () => {
    const t = touch.current;
    touch.current = null;
    if (t?.active && pull >= 56 && !refreshing) void doRefresh();
    setPull(0);
  };

  const counts = useMemo(
    () => ({ all: rows.length, drafts: rows.filter((r) => r.draft).length, published: rows.filter((r) => !r.draft).length }),
    [rows],
  );
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'drafts' && !r.draft) return false;
      if (filter === 'published' && r.draft) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        r.slug.includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        r.tags.some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [rows, filter, q]);

  const syncMain = async () => {
    setSwitching(true);
    try {
      await api.syncMain();
      toast(`Switched back to ${defaultBranch}`, 'success');
      await Promise.all([probe(), refreshPosts()]);
    } catch (e) {
      const dirty = e instanceof ApiError && e.code === 'dirty';
      toast(dirty ? 'There are uncommitted changes on the PC, so the branch was not switched.' : (e as Error).message, 'error');
    } finally {
      setSwitching(false);
    }
  };

  const loading = postsState === 'loading' && !rows.length && !(checked && !online);
  const offBranch = online && branch && defaultBranch && branch !== defaultBranch;

  return (
    <div class="screen home">
      <header class="home-bar">
        <ConnectionPill />
        <IconButton label="Refresh posts" onClick={() => void doRefresh()} disabled={refreshing}>
          <RefreshCw size={20} class={refreshing ? 'spin' : ''} />
        </IconButton>
      </header>

      <div
        class="home-scroll"
        ref={scroller}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div class="ptr" style={{ height: `${refreshing ? 44 : pull}px` }} aria-hidden="true">
          <RefreshCw size={18} class={refreshing ? 'spin' : ''} style={{ opacity: refreshing ? 1 : Math.min(1, pull / 56), transform: `rotate(${pull * 4}deg)` }} />
        </div>
        <div class="home-inner">
          <h1 class="large-title">Posts</h1>

          {offBranch && (
            <section class="banner" aria-label="Branch">
              <GitBranch size={18} class="banner-ico" />
              <div class="banner-text">
                <strong>On branch {branch}</strong>
                <span>Once its pull request is merged, switch back to {defaultBranch} to keep writing from the latest version.</span>
              </div>
              <Button kind="secondary" onClick={() => void syncMain()} busy={switching}>
                Switch back to {defaultBranch}
              </Button>
            </section>
          )}

          <div class="search">
            <Search size={18} class="search-ico" aria-hidden="true" />
            <input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              placeholder="Search posts"
              aria-label="Search posts"
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            />
            {q && (
              <button type="button" class="search-clear" aria-label="Clear search" onClick={() => setQ('')}>
                <X size={16} />
              </button>
            )}
          </div>

          <Segmented<Filter>
            label="Filter posts"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All` },
              { value: 'drafts', label: `Drafts` },
              { value: 'published', label: `Published` },
            ]}
          />
          <div class="list-meta" aria-live="polite">
            {!loading && visible.length > 0 && (
              <>
                {visible.length} {visible.length === 1 ? 'post' : 'posts'}
                {filter === 'all' && counts.drafts > 0 ? ` · ${counts.drafts} ${counts.drafts === 1 ? 'draft' : 'drafts'}` : ''}
              </>
            )}
          </div>

          {loading ? (
            <ul class="post-list" aria-busy="true" aria-label="Loading posts">
              {[0, 1, 2, 3, 4].map((i) => (
                <li class="post-row skeleton" key={i}>
                  <span class="sk sk-title" style={{ width: `${70 - i * 6}%` }} />
                  <span class="sk sk-meta" />
                </li>
              ))}
            </ul>
          ) : postsState === 'error' && !rows.length ? (
            <EmptyState icon={<CircleAlert size={28} />} title="Could not load posts" body={postsError || 'Something went wrong talking to the PC.'}>
              <Button onClick={() => void doRefresh()}>Try again</Button>
            </EmptyState>
          ) : !rows.length ? (
            !online && checked ? (
              <EmptyState icon={<CloudOff size={28} />} title="You are offline" body="No posts are saved on this phone yet. Reconnect to your PC once to load them, or start a new post that will sync later.">
                <Button kind="primary" onClick={() => setNewOpen(true)}>New post</Button>
              </EmptyState>
            ) : (
              <EmptyState icon={<FileText size={28} />} title="No posts yet" body="Start with a title. Drafts stay private until you publish.">
                <Button kind="primary" onClick={() => setNewOpen(true)}>Write your first post</Button>
              </EmptyState>
            )
          ) : visible.length === 0 ? (
            <EmptyState icon={<Search size={28} />} title="No matches" body={q ? `Nothing found for “${q}”.` : `No ${filter === 'drafts' ? 'drafts' : 'published posts'} yet.`}>
              {q && <Button onClick={() => setQ('')}>Clear search</Button>}
            </EmptyState>
          ) : (
            <ul class="post-list">
              {visible.map((r) => (
                <PostRow key={r.file} row={r} />
              ))}
            </ul>
          )}
          {!online && checked && rows.length > 0 && <p class="offline-note">Showing posts saved on this phone.</p>}
        </div>
      </div>

      <div class="fab-wrap">
        <button type="button" class="fab" onClick={() => setNewOpen(true)}>
          <Plus size={22} strokeWidth={2.4} />
          New post
        </button>
      </div>
      <NewPostSheet open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function EmptyState(props: { icon: any; title: string; body: string; children?: any }) {
  return (
    <div class="empty">
      <div class="empty-ico">{props.icon}</div>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      {props.children}
    </div>
  );
}

function PostRow({ row }: { row: Row }) {
  const shownTags = row.tags.slice(0, 3);
  const extra = row.tags.length - shownTags.length;
  return (
    <li>
      <a class="post-row" href={`#/edit/${encodeURIComponent(row.file)}`} onClick={(e) => { e.preventDefault(); go(`#/edit/${encodeURIComponent(row.file)}`); }}>
        <div class="post-main">
          <div class="post-title">{row.title || row.slug}</div>
          <div class="post-meta">
            <span>{formatDate(row.date)}</span>
            {shownTags.map((t) => (
              <span class="tag" key={t}>
                {t}
              </span>
            ))}
            {extra > 0 && <span class="tag tag-more">+{extra}</span>}
          </div>
          {(row.unsynced || row.conflict || row.git !== 'clean') && (
            <div class="post-flags">
              {row.conflict ? (
                <span class="flag flag-bad">Conflict</span>
              ) : row.unsynced ? (
                <span class="flag flag-warn">
                  <span class="dot" aria-hidden="true" /> {row.localOnly ? 'Not on the PC yet' : 'Not synced'}
                </span>
              ) : null}
              {row.git !== 'clean' && !row.localOnly && (
                <span class="flag">
                  <GitCommitHorizontal size={13} aria-hidden="true" /> Uncommitted on PC
                </span>
              )}
            </div>
          )}
        </div>
        <div class="post-side">
          {row.draft && <span class="badge">Draft</span>}
          <span class="ext">.{row.ext}</span>
        </div>
      </a>
    </li>
  );
}
