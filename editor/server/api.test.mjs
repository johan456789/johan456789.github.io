import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { parseFrontmatter } from "./api.mjs";
import { compareUrlFor } from "./git.mjs";
import { NO_GH, makeFixture, request, sh, startServer } from "./helpers.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const BLOG = "src/content/docs/blog";

describe("api", () => {
  let fx;
  let srv;
  const api = (method, p, o) => request(srv.port, method, `/_editor/api${p}`, o);
  const blogFile = (n) => path.join(fx.repo, BLOG, n);

  before(async () => {
    fx = makeFixture();
    srv = await startServer({ repoRoot: fx.repo });
  });
  after(async () => {
    await srv.close();
    fx.cleanup();
  });

  test("status", async () => {
    const r = await api("GET", "/status");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, astro: "down", branch: "main", defaultBranch: "main" });
  });

  test("list posts: parsed frontmatter, sorted by date desc", async () => {
    const r = await api("GET", "/posts");
    assert.equal(r.status, 200);
    const [second, hello] = r.json.posts;
    assert.equal(second.file, "second.mdx");
    assert.equal(second.title, "It's second");
    assert.deepEqual(second.tags, ["a", "b"]);
    assert.equal(second.ext, "mdx");
    assert.equal(second.draft, false);
    assert.equal(hello.file, "hello.md");
    assert.equal(hello.title, "Hello: World");
    assert.equal(hello.description, "A first post");
    assert.deepEqual(hello.tags, ["til", "web dev"]);
    assert.equal(hello.date, "2026-01-22T22:58:11+08:00");
    assert.equal(hello.draft, true);
    assert.equal(hello.slug, "hello");
    assert.equal(hello.url, "/blog/hello/");
    assert.equal(hello.git, "clean");
    assert.equal(hello.hash, sha(fs.readFileSync(blogFile("hello.md"))));
    assert.equal(typeof hello.mtime, "number");
  });

  test("read post, 404, and no CORS headers", async () => {
    const r = await api("GET", "/posts/hello.md");
    assert.equal(r.status, 200);
    assert.equal(r.json.file, "hello.md");
    assert.match(r.json.content, /^---\ntitle:/);
    assert.equal(r.json.hash, sha(r.json.content));
    assert.equal(r.json.url, "/blog/hello/");
    assert.equal(r.headers["access-control-allow-origin"], undefined);
    const missing = await api("GET", "/posts/nope.md");
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, "not_found");
  });

  test("create, update with base hash, conflict, force, exists, delete", async () => {
    const c1 = "---\ntitle: New\n---\n\none\n";
    const created = await api("PUT", "/posts/new-post.md", { json: { content: c1, baseHash: null } });
    assert.equal(created.status, 200);
    assert.equal(created.json.hash, sha(c1));
    assert.equal(fs.readFileSync(blogFile("new-post.md"), "utf8"), c1);
    // No leftover temp files.
    assert.deepEqual(fs.readdirSync(path.join(fx.repo, BLOG)).filter((f) => f.endsWith(".tmp")), []);

    const listed = (await api("GET", "/posts")).json.posts.find((p) => p.file === "new-post.md");
    assert.equal(listed.git, "new");

    // create when it exists -> 409 exists, with current content
    const dup = await api("PUT", "/posts/new-post.md", { json: { content: "other", baseHash: null } });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error, "exists");
    assert.equal(dup.json.content, c1);
    assert.equal(dup.json.hash, sha(c1));

    // update with correct base hash
    const c2 = "---\ntitle: New\n---\n\ntwo\n";
    const upd = await api("PUT", "/posts/new-post.md", { json: { content: c2, baseHash: sha(c1) } });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.hash, sha(c2));

    // identical content succeeds without a base-hash match
    const same = await api("PUT", "/posts/new-post.md", { json: { content: c2, baseHash: "stale" } });
    assert.equal(same.status, 200);
    assert.equal(same.json.hash, sha(c2));

    // stale hash -> 409 conflict
    const stale = await api("PUT", "/posts/new-post.md", { json: { content: "x\n", baseHash: sha(c1) } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error, "conflict");
    assert.equal(stale.json.content, c2);
    assert.equal(stale.json.hash, sha(c2));
    assert.equal(fs.readFileSync(blogFile("new-post.md"), "utf8"), c2);

    // force overrides
    const forced = await api("PUT", "/posts/new-post.md", { json: { content: "x\n", baseHash: sha(c1), force: true } });
    assert.equal(forced.status, 200);
    assert.equal(fs.readFileSync(blogFile("new-post.md"), "utf8"), "x\n");

    // missing file + non-null baseHash -> conflict with null content
    const gone = await api("PUT", "/posts/ghost.md", { json: { content: "x", baseHash: "abc" } });
    assert.equal(gone.status, 409);
    assert.equal(gone.json.error, "conflict");
    assert.equal(gone.json.content, null);
    assert.equal(gone.json.hash, null);

    // delete: stale hash conflicts, right hash deletes
    const delStale = await api("DELETE", "/posts/new-post.md", { json: { baseHash: sha(c1) } });
    assert.equal(delStale.status, 409);
    assert.equal(fs.existsSync(blogFile("new-post.md")), true);
    const del = await api("DELETE", "/posts/new-post.md", { json: { baseHash: sha("x\n") } });
    assert.equal(del.status, 200);
    assert.deepEqual(del.json, { ok: true });
    assert.equal(fs.existsSync(blogFile("new-post.md")), false);
  });

  test("bad names and traversal attempts", async () => {
    const bad = [
      "Upper.md",
      "-lead.md",
      "a.txt",
      "a%20b.md",
      "..%2f..%2fREADME.md",
      "..%2fREADME.md",
      "%2e%2e%2fREADME.md",
      "..%5cREADME.md",
      "a%2fb.md",
      "..",
      "%00.md",
      "%zz.md",
    ];
    for (const name of bad) {
      for (const [method, opts] of [
        ["GET"],
        ["PUT", { json: { content: "pwn", baseHash: null } }],
        ["DELETE", { json: { baseHash: "x" } }],
      ]) {
        const r = await api(method, `/posts/${name}`, opts);
        assert.equal(r.status, 400, `${method} ${name}`);
        assert.equal(r.json.error, "bad_name", `${method} ${name}`);
      }
    }
    // Raw dot segments never reach the filesystem either.
    const r = await api("PUT", "/posts/../../README.md", { json: { content: "pwn", baseHash: null } });
    assert.ok([400, 404].includes(r.status));
    assert.equal(fs.readFileSync(path.join(fx.repo, "README.md"), "utf8"), "readme\n");
    assert.equal(fs.existsSync(path.join(fx.repo, "src/README.md")), false);
    for (const name of ["a%2f..%2fb.png", "..%2fx.png", "x.exe", ".hidden.png", "a/b.png"]) {
      const g = await api("GET", `/assets/${name}`);
      assert.ok([400, 404].includes(g.status), name);
      const p = await api("PUT", `/assets/${name}`, { body: "x" });
      assert.ok([400, 404].includes(p.status), name);
    }
  });

  test("a symlinked post is not followed", async () => {
    fs.symlinkSync(path.join(fx.repo, "README.md"), blogFile("link.md"));
    const r = await api("GET", "/posts/link.md");
    assert.equal(r.status, 404);
    fs.unlinkSync(blogFile("link.md"));
  });

  test("mutating requests need X-Editor: 1", async () => {
    const body = { content: "x", baseHash: null };
    const r = await api("PUT", "/posts/csrf.md", { json: body, mutating: false });
    assert.equal(r.status, 403);
    assert.equal(r.json.error, "forbidden");
    const wrong = await api("PUT", "/posts/csrf.md", { json: body, headers: { "x-editor": "yes" } });
    assert.equal(wrong.status, 403);
    assert.equal((await api("POST", "/git/sync-main", { mutating: false })).status, 403);
    assert.equal((await api("DELETE", "/posts/hello.md", { json: { baseHash: "x" }, mutating: false })).status, 403);
    assert.equal(fs.existsSync(blogFile("csrf.md")), false);
  });

  test("Sec-Fetch-Site: cross-site and same-site are rejected, same-origin allowed", async () => {
    const body = { content: "x", baseHash: null };
    for (const site of ["cross-site", "same-site", "none"]) {
      const r = await api("PUT", "/posts/csrf.md", { json: body, headers: { "sec-fetch-site": site } });
      assert.equal(r.status, 403, site);
    }
    assert.equal(fs.existsSync(blogFile("csrf.md")), false);
    const ok = await api("PUT", "/posts/csrf.md", { json: body, headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(ok.status, 200);
    fs.unlinkSync(blogFile("csrf.md"));
  });

  test("bad bodies", async () => {
    const r1 = await api("PUT", "/posts/x.md", { body: "{nope", headers: { "content-type": "application/json" } });
    assert.equal(r1.status, 400);
    assert.equal(r1.json.error, "bad_json");
    const r2 = await api("PUT", "/posts/x.md", { json: { content: 5, baseHash: null } });
    assert.equal(r2.status, 400);
    const big = JSON.stringify({ content: "a".repeat(5 * 1024 * 1024 + 10), baseHash: null });
    const r3 = await api("PUT", "/posts/x.md", { body: big });
    assert.equal(r3.status, 413);
    assert.equal(r3.json.error, "too_large");
  });

  test("assets: upload, collision rename, identical reuse, serve", async () => {
    const a = Buffer.from("PNG-A-bytes");
    const b = Buffer.from("PNG-B-bytes");
    const up = (name, body) => api("PUT", `/assets/${name}`, { body, headers: { "content-type": "application/octet-stream" } });
    const first = await up("pic.png", a);
    assert.equal(first.status, 200);
    assert.deepEqual(first.json, { name: "pic.png", path: "src/assets/pic.png" });
    assert.deepEqual(fs.readFileSync(path.join(fx.repo, "src/assets/pic.png")), a);

    const same = await up("pic.png", a);
    assert.deepEqual(same.json, { name: "pic.png", path: "src/assets/pic.png" });

    const second = await up("pic.png", b);
    assert.deepEqual(second.json, { name: "pic-2.png", path: "src/assets/pic-2.png" });
    const third = await up("pic.png", Buffer.from("PNG-C"));
    assert.equal(third.json.name, "pic-3.png");
    // Identical bytes to a renamed copy reuse that copy.
    const reuse = await up("pic.png", b);
    assert.equal(reuse.json.name, "pic-2.png");
    assert.deepEqual(fs.readdirSync(path.join(fx.repo, "src/assets")).filter((f) => f.endsWith(".tmp")), []);

    const got = await api("GET", "/assets/pic-2.png");
    assert.equal(got.status, 200);
    assert.equal(got.headers["content-type"], "image/png");
    assert.deepEqual(got.body, b);
    assert.equal((await api("GET", "/assets/missing.png")).status, 404);

    const svg = await up("logo.svg", Buffer.from("<svg/>"));
    assert.equal(svg.status, 200);
    const gotSvg = await api("GET", "/assets/logo.svg");
    assert.equal(gotSvg.headers["content-type"], "image/svg+xml");
    assert.match(gotSvg.headers["content-security-policy"], /sandbox/);
  });

  test("assets: too large -> 413", async () => {
    const r = await api("PUT", "/assets/huge.png", { body: Buffer.alloc(25 * 1024 * 1024 + 1) });
    assert.equal(r.status, 413);
    assert.equal(r.json.error, "too_large");
    assert.equal(fs.existsSync(path.join(fx.repo, "src/assets/huge.png")), false);
    const ok = await api("PUT", "/assets/edge.png", { body: Buffer.alloc(25 * 1024 * 1024, 1) });
    assert.equal(ok.status, 200);
  });

  test("git status, commit, bad paths", async () => {
    fs.writeFileSync(path.join(fx.repo, "stray.txt"), "x");
    fs.appendFileSync(blogFile("hello.md"), "more\n");
    const info = (await api("GET", "/git")).json;
    assert.equal(info.branch, "main");
    assert.equal(info.defaultBranch, "main");
    assert.equal(info.hasRemote, true);
    assert.equal(info.ahead, 0);
    assert.equal(info.behind, 0);
    assert.equal(info.otherChanges, 1);
    const byPath = Object.fromEntries(info.changes.map((c) => [c.path, c.status]));
    assert.equal(byPath[`${BLOG}/hello.md`], "modified");
    assert.equal(byPath["src/assets/pic.png"], "new");
    assert.equal(byPath["src/assets/pic-2.png"], "new");
    assert.equal(byPath["stray.txt"], undefined);
    const posts = (await api("GET", "/posts")).json.posts;
    assert.equal(posts.find((p) => p.file === "hello.md").git, "modified");
    assert.equal(posts.find((p) => p.file === "second.mdx").git, "clean");

    for (const p of ["stray.txt", "../x", "src/assets/../../README.md", "/etc/passwd", "src/assets", "src\\assets\\x"]) {
      const r = await api("POST", "/git/commit", { json: { message: "m", paths: [p] } });
      assert.equal(r.status, 400, p);
      assert.equal(r.json.error, "bad_path", p);
    }
    assert.equal((await api("POST", "/git/commit", { json: { message: "" } })).status, 400);

    const one = await api("POST", "/git/commit", { json: { message: "edit hello", paths: [`${BLOG}/hello.md`] } });
    assert.equal(one.status, 200);
    assert.match(one.json.commit, /^[0-9a-f]{7,}$/);
    assert.equal(fx.g("log", "-1", "--format=%s"), "edit hello");
    assert.deepEqual(fx.g("show", "--name-only", "--format=", "HEAD").split("\n"), [`${BLOG}/hello.md`]);

    const all = await api("POST", "/git/commit", { json: { message: "add pics" } });
    assert.equal(all.status, 200);
    assert.ok(fx.g("show", "--name-only", "--format=", "HEAD").includes("src/assets/pic.png"));
    assert.equal(fx.g("status", "--porcelain"), "?? stray.txt");

    const none = await api("POST", "/git/commit", { json: { message: "again" } });
    assert.equal(none.status, 409);
    assert.equal(none.json.error, "nothing_to_commit");
    const info2 = (await api("GET", "/git")).json;
    assert.equal(info2.ahead, 2);
    assert.deepEqual(info2.changes, []);
  });

  test("publish needs a slug on the default branch", async () => {
    fs.appendFileSync(blogFile("second.mdx"), "edit\n");
    const r = await api("POST", "/git/publish", { json: { message: "Publish" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "slug_required");
    assert.equal((await api("GET", "/git")).json.branch, "main");
    const bad = await api("POST", "/git/publish", { json: { message: "Publish", slug: "../x" } });
    assert.equal(bad.status, 400);
    assert.equal((await api("GET", "/git")).json.branch, "main");
  });

  test("publish creates post/<slug> and pushes to origin", async () => {
    const r = await api("POST", "/git/publish", { json: { message: "Publish second", slug: "second" } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.branch, "post/second");
    assert.match(r.json.commit, /^[0-9a-f]{7,}$/);
    assert.equal(r.json.prUrl, null);
    assert.equal(r.json.compareUrl, null); // local origin is not GitHub
    assert.equal(fx.g("rev-parse", "--abbrev-ref", "HEAD"), "post/second");
    assert.equal(sh(fx.origin, "git", ["rev-parse", "post/second"]), fx.g("rev-parse", "HEAD"));
    assert.equal((await api("GET", "/git")).json.ahead, 0);

    // Already on a post branch: no new branch, nothing to commit, still pushes.
    const again = await api("POST", "/git/publish", { json: { message: "Publish second" } });
    assert.equal(again.status, 200);
    assert.equal(again.json.branch, "post/second");
    assert.equal(again.json.commit, null);
  });

  test("sync-main refuses when dirty, then switches and pulls", async () => {
    fs.appendFileSync(blogFile("hello.md"), "dirty\n");
    const dirty = await api("POST", "/git/sync-main");
    assert.equal(dirty.status, 409);
    assert.equal(dirty.json.error, "dirty");
    assert.equal(fx.g("rev-parse", "--abbrev-ref", "HEAD"), "post/second");
    fx.g("checkout", "--", `${BLOG}/hello.md`);

    // An unrelated untracked file does not block.
    const ok = await api("POST", "/git/sync-main");
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json, { branch: "main" });
    assert.equal(fx.g("rev-parse", "--abbrev-ref", "HEAD"), "main");
  });

  test("publish reports the failing step (push)", async () => {
    const other = makeFixture();
    const s2 = await startServer({ repoRoot: other.repo });
    try {
      fs.renameSync(other.origin, `${other.origin}.gone`);
      fs.writeFileSync(path.join(other.repo, BLOG, "p.md"), "---\ntitle: p\n---\n");
      const r = await request(s2.port, "POST", "/_editor/api/git/publish", { json: { message: "m", slug: "p" } });
      assert.equal(r.status, 500);
      assert.equal(r.json.error, "publish_failed");
      assert.equal(r.json.step, "push");
      assert.ok(r.json.message);
      // The commit step succeeded before the push failed.
      assert.equal(other.g("log", "-1", "--format=%s"), "m");
    } finally {
      await s2.close();
      other.cleanup();
    }
  });

  test("publish with a stub gh returns the PR url; gh failure names the pr step", async () => {
    const other = makeFixture();
    const stub = path.join(other.root, "gh");
    fs.writeFileSync(
      stub,
      '#!/bin/sh\ncase "$*" in\n  *"pr list"*) echo "[]" ;;\n  *"pr create"*) echo "https://github.com/o/r/pull/7" ;;\n  *) exit 1 ;;\nesac\n',
      { mode: 0o755 },
    );
    const s2 = await startServer({ repoRoot: other.repo, ghBin: stub });
    try {
      fs.writeFileSync(path.join(other.repo, BLOG, "p.md"), "---\ntitle: p\n---\n");
      const r = await request(s2.port, "POST", "/_editor/api/git/publish", { json: { message: "m", slug: "p", title: "T" } });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.json.prUrl, "https://github.com/o/r/pull/7");
    } finally {
      await s2.close();
    }
    const failing = path.join(other.root, "gh-fail");
    fs.writeFileSync(failing, "#!/bin/sh\necho 'not logged in' >&2\nexit 4\n", { mode: 0o755 });
    const s3 = await startServer({ repoRoot: other.repo, ghBin: failing });
    try {
      const r = await request(s3.port, "POST", "/_editor/api/git/publish", { json: { message: "m" } });
      assert.equal(r.status, 500);
      assert.equal(r.json.step, "pr");
      assert.match(r.json.message, /not logged in/);
      assert.equal(r.json.branch, "post/p");
    } finally {
      await s3.close();
      other.cleanup();
    }
  });

  test("unknown routes and methods", async () => {
    assert.equal((await api("GET", "/nope")).status, 404);
    assert.equal((await api("PATCH", "/posts/hello.md", { mutating: false })).status, 403);
    assert.equal((await api("PATCH", "/posts/hello.md", { body: "{}" })).status, 405);
    assert.equal((await api("POST", "/posts")).status, 405);
  });
});

describe("helpers", () => {
  test("frontmatter parser variants", () => {
    const fm = parseFrontmatter(
      '﻿---\r\ntitle: "A \\"quoted\\" title"\r\ndescription: >\r\n  folded\r\n  text\r\ntags: [x, \'y z\', "w, v"]\r\ndate: 2026-01-01\r\ndraft: TRUE # comment\r\n---\r\nbody',
    );
    assert.equal(fm.title, 'A "quoted" title');
    assert.equal(fm.description, "folded text");
    assert.deepEqual(fm.tags, ["x", "y z", "w, v"]);
    assert.equal(fm.date, "2026-01-01");
    assert.equal(fm.draft, "TRUE");
    assert.deepEqual(parseFrontmatter("no frontmatter"), {});
    assert.deepEqual(parseFrontmatter("---\ntitle: x\n"), {});
    assert.deepEqual(parseFrontmatter("---\ntags: []\n---\n").tags, []);
  });

  test("compareUrlFor", () => {
    const want = "https://github.com/o/r/compare/main...post/x?expand=1";
    for (const u of [
      "git@github.com:o/r.git",
      "https://github.com/o/r.git",
      "https://github.com/o/r",
      "https://user:tok@github.com/o/r.git",
      "ssh://git@github.com/o/r.git",
    ]) {
      assert.equal(compareUrlFor(u, "main", "post/x"), want, u);
    }
    assert.equal(compareUrlFor("/tmp/origin.git", "main", "post/x"), null);
    assert.equal(compareUrlFor("https://gitlab.com/o/r.git", "main", "post/x"), null);
    assert.equal(compareUrlFor(null, "main", "x"), null);
  });
});

test("NO_GH really does not exist", () => {
  assert.equal(fs.existsSync(NO_GH), false);
});
