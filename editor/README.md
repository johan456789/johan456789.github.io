# Blog editor

A phone-first web app for writing and editing this blog's posts, with a real
Astro-rendered preview. It runs on the always-on PC and is reached over the
tailnet. Everything lives in this `editor/` folder; the blog itself is not
modified.

## Running it

```bash
cd editor
pnpm install
pnpm build      # builds the web client into editor/dist
pnpm start      # starts the editor server on port 2531
```

Then expose port 2531 on the tailnet over HTTPS (needed for home-screen
install and offline support), for example with a Tailscale service or
`tailscale serve` pointing at `localhost:2531`. Open that HTTPS address on the
phone (the bare `/` redirects to `/_editor/`) and use "Add to Home Screen".

Environment variables: `EDITOR_PORT` (default 2531), `EDITOR_HOST` (default
127.0.0.1), `ASTRO_PORT` (default 4321), `REPO_ROOT` (default: parent of
`editor/`), `ASTRO_IDLE_MINUTES` (default 30), `EDITOR_NO_ASTRO=1` (never
spawn `astro dev`; used by tests).

`astro dev` is not kept running. The editor server starts it on the first
request it receives (opening the app is enough) and stops it after
`ASTRO_IDLE_MINUTES` without any request. While the app is open and visible it
checks in every 30 seconds, which keeps the preview awake; a closed or
backgrounded app does not. It uses Astro's own background
mode for this (`astro dev --background` and `astro dev stop`). If a foreground
dev server is already serving on `ASTRO_PORT` (for example `pnpm dev` at the
desk), the editor uses it and never stops it. Astro allows one dev server per
project, so while the editor's is up, `pnpm dev` at the desk reports that one
is already running; open that one or run `pnpm astro dev stop` first.

## Architecture

```
phone (PWA) ──HTTPS/tailnet──> editor server :2531 (node, zero deps)
                                 ├─ /                redirects to /_editor/ (top-level page only)
                                 ├─ /_editor/        built web client (dist/)
                                 ├─ /_editor/api/*   files, assets, git
                                 └─ everything else  reverse proxy (HTTP + WS)
                                                     to `astro dev` :4321
```

- **One origin.** The editor app is under `/_editor/`; every other path is the
  blog's dev server, proxied (including the Vite HMR websocket, with the `Host`
  header rewritten to `localhost:<ASTRO_PORT>`). The preview is a same-origin
  iframe of `/blog/<slug>/`, so saving a file hot-reloads the true rendering.
- **The server owns the working tree.** It reads and writes
  `src/content/docs/blog/*.{md,mdx}` and `src/assets/*`, and runs git. It
  spawns `astro dev` in the repo root on demand (see above) unless something
  already answers on `ASTRO_PORT`.
- **Offline first client.** Every edit is written to IndexedDB first, then
  synced. Each file carries the server hash it was based on; the server rejects
  a write whose base hash is stale (409) and the client shows a conflict
  dialog. Offline, the app shell is served by a service worker, edits and image
  uploads queue in an outbox, and the preview falls back to an approximate
  in-browser rendering.
- **No login.** The server binds to 127.0.0.1; `tailscale serve` is the only
  way in, so the tailnet is the auth boundary.

## Layout

```
editor/
  package.json
  server/        node:http server, plain .mjs, no dependencies
    index.mjs    entry: static files, router, proxy, spawns astro
    api.mjs      route handlers
    git.mjs      git/gh helpers (execFile, never a shell)
    proxy.mjs    HTTP + websocket reverse proxy
    *.test.mjs   node --test, runs against a temp fixture repo
  web/           Vite + Preact + TypeScript client
    index.html
    public/      manifest.webmanifest, sw.js, icons
    src/
  dist/          build output (gitignored)
```

## API contract

Base path `/_editor/api`. JSON in, JSON out. Errors are
`{ "error": "<code>", "message": "<human text>" }` with a 4xx/5xx status.

Every mutating request (PUT/POST/DELETE) must carry the header
`X-Editor: 1`; the server rejects it with 403 otherwise, and also rejects any
request whose `Sec-Fetch-Site` header is present and not `same-origin`. No
CORS headers are ever sent.

`hash` is the lowercase hex SHA-256 of the file's bytes.

`file` is a bare filename matching `^[a-z0-9][a-z0-9-]*\.(md|mdx)$`.
Asset names match `^[A-Za-z0-9][A-Za-z0-9._ -]*\.(png|jpe?g|gif|webp|avif|svg)$`.
Anything else is 400 `bad_name`. Paths never contain `/`.

### `GET /status`
```json
{ "ok": true, "astro": "ready" | "starting" | "down",
  "branch": "main", "defaultBranch": "main" }
```

### `GET /posts`
```json
{ "posts": [ {
    "file": "til-happy-eyeballs.mdx", "slug": "til-happy-eyeballs", "ext": "mdx",
    "title": "…", "description": "…", "date": "2026-01-22T22:58:11+08:00",
    "tags": ["til"], "draft": false,
    "hash": "…", "mtime": 1768000000000,
    "git": "clean" | "modified" | "new",
    "url": "/blog/til-happy-eyeballs/"
} ] }
```
Sorted by `date` descending. Frontmatter is parsed leniently (a small
hand-written parser for the scalar/list fields above is enough); missing
fields become `""`, `[]`, `false`, or `null` for date.

### `GET /posts/:file`
`{ "file", "content", "hash", "mtime", "url" }` or 404 `not_found`.

### `PUT /posts/:file`
Body `{ "content": string, "baseHash": string | null, "force"?: boolean }`.
- `baseHash: null` means create; 409 `exists` if the file is already there
  (response includes the current `content` and `hash`).
- Otherwise the write only happens if the file's current hash equals
  `baseHash`, or `force` is true. A mismatch is 409 `conflict` with the
  current `content` and `hash`. A missing file with a non-null `baseHash` is
  409 `conflict` with `content: null, hash: null`.
- Writes are atomic (temp file + rename). Success: `{ "hash", "mtime" }`.
- If `content` already equals what is on disk, succeed without writing.

### `DELETE /posts/:file`
Body `{ "baseHash": string }`. Same conflict rule. Success `{ "ok": true }`.

### `PUT /assets/:name`
Raw binary body (any content type), max 25 MB (413 `too_large`). Writes to
`src/assets/`. If the name is taken by a file with different bytes, the server
appends `-2`, `-3`, … before the extension; identical bytes reuse the existing
file. Success: `{ "name": "final-name.jpg", "path": "src/assets/final-name.jpg" }`.

### `GET /assets/:name`
Serves the file from `src/assets/` (used by the offline-capable approximate
preview and thumbnails). 404 if missing.

### `GET /git`
```json
{ "branch": "post/foo", "defaultBranch": "main", "hasRemote": true,
  "ahead": 1, "behind": 0,
  "changes": [ { "path": "src/content/docs/blog/foo.md", "status": "modified" | "new" | "deleted" } ],
  "otherChanges": 0 }
```
`changes` only lists paths under `src/content/docs/blog/` and `src/assets/`.
`otherChanges` counts dirty paths elsewhere in the repo (never touched by the
editor).

### `POST /git/commit`
Body `{ "message": string, "paths"?: string[] }`. Stages and commits the given
paths (default: everything in `changes`). Paths outside the two editor
directories are 400 `bad_path`. 409 `nothing_to_commit` if there is nothing.
Success `{ "commit": "<short sha>" }`.

### `POST /git/publish`
Body `{ "message": string, "title"?: string, "slug"?: string }`. In order:
1. If on the default branch, create and switch to `post/<slug>` (`slug`
   required in that case; 400 `slug_required`). If already on another branch,
   stay on it.
2. Commit pending editor changes as in `/git/commit` (skip if none).
3. `git push -u origin <branch>`.
4. If `gh` is available: reuse the open PR for the branch, else
   `gh pr create --title <title|message> --body ""`.

Success: `{ "branch", "commit": string | null, "prUrl": string | null,
"compareUrl": string | null }`. Failure names the step:
`{ "error": "publish_failed", "step": "branch"|"commit"|"push"|"pr", "message" }`.

### `POST /git/sync-main`
Switches to the default branch and runs `git pull --ff-only`. 409 `dirty` if
there are any uncommitted changes. Success `{ "branch": "main" }`.

## Post conventions (from `scripts/new-post.mjs`)

New post template (the client generates it so creation works offline):

```
---
title: "<title>"
description: ""
excerpt: ""
tags: []
date: <ISO timestamp>
draft: true
---

<!-- excerpt -->        (md)   or   {/* excerpt */}   (mdx)
```

Slug: NFKD, strip combining marks, lowercase, non-alphanumerics to `-`, trim
and collapse dashes. Images are inserted as
`![alt](../../../assets/<name>)`, which works in both md and mdx.
