// Route handlers for /_editor/api/*. See ../README.md for the contract.
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  GitError,
  PublishError,
  commitEditorChanges,
  currentBranch,
  defaultBranch,
  getGitInfo,
  getStatus,
  publish,
  syncMain,
} from "./git.mjs";

const POST_RE = /^[a-z0-9][a-z0-9-]*\.(md|mdx)$/;
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.(png|jpe?g|gif|webp|avif|svg)$/;
const JSON_LIMIT = 5 * 1024 * 1024;
const ASSET_LIMIT = 25 * 1024 * 1024;
const BLOG_REL = "src/content/docs/blog";
const ASSETS_REL = "src/assets";

const ASSET_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

// Serializes file and git mutations so check-then-write sequences cannot interleave.
function createLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const result = tail.then(() => fn());
    tail = result.catch(() => {});
    return result;
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new ApiError(413, "too_large", `Body exceeds ${limit} bytes.`);
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume(); // drain so the client can still read our response
      return reject(tooLarge());
    }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on("data", (c) => {
      if (over) return; // keep draining
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return reject(tooLarge());
      }
      chunks.push(c);
    });
    req.on("end", () => !over && resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, JSON_LIMIT);
  if (buf.length === 0) return {};
  let value;
  try {
    value = JSON.parse(buf.toString("utf8"));
  } catch {
    throw new ApiError(400, "bad_json", "Request body is not valid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "bad_json", "Request body must be a JSON object.");
  }
  return value;
}

// Resolves `name` as a direct child of `dir`; anything else is rejected.
function childPath(dir, name) {
  const base = path.resolve(dir);
  const full = path.resolve(base, name);
  if (path.dirname(full) !== base) throw new ApiError(400, "bad_name", "Invalid name.");
  return full;
}

// Reads a regular file (symlinks are refused). Returns null when missing.
async function readRegular(file) {
  try {
    const st = await fsp.lstat(file);
    if (!st.isFile()) return null;
    return { bytes: await fsp.readFile(file), mtime: Math.floor(st.mtimeMs) };
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return null;
    throw e;
  }
}

// Temp file in the same directory, fsync, rename over the target.
async function atomicWrite(dest, bytes) {
  const dir = path.dirname(dest);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(dest)}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  try {
    const fh = await fsp.open(tmp, "wx", 0o644);
    try {
      await fh.writeFile(bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, dest);
  } catch (e) {
    await fsp.unlink(tmp).catch(() => {});
    throw e;
  }
}

// ---- lenient frontmatter parser (title, description, date, tags, draft) ----

function parseScalar(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    for (let i = 1; i < s.length; i++) {
      if (s[i] === "\\") i++;
      else if (s[i] === '"') {
        const lit = s.slice(0, i + 1);
        try {
          return JSON.parse(lit);
        } catch {
          return lit.slice(1, -1);
        }
      }
    }
    return s.slice(1);
  }
  if (s.startsWith("'")) {
    let out = "";
    for (let i = 1; i < s.length; i++) {
      if (s[i] === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i++;
        } else return out;
      } else out += s[i];
    }
    return out;
  }
  return s.replace(/\s+#.*$/, "").trim();
}

function splitInlineList(s) {
  const inner = s.trim().replace(/^\[/, "").replace(/\][^\]]*$/, "");
  const items = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"') cur += inner[++i] ?? "";
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ",") {
      items.push(cur);
      cur = "";
    } else cur += c;
  }
  items.push(cur);
  return items.map(parseScalar).filter((x) => x !== "");
}

export function parseFrontmatter(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return {};
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l));
  if (end < 0) return {};
  const fm = lines.slice(1, end);
  const out = {};
  for (let i = 0; i < fm.length; i++) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(fm[i]);
    if (!m) continue;
    const [, key, rest] = m;
    // Continuation lines: indented, blank, or "- item" at column 0.
    const block = [];
    let j = i + 1;
    while (j < fm.length && (/^\s+\S/.test(fm[j]) || /^-\s/.test(fm[j]) || fm[j].trim() === "")) block.push(fm[j++]);
    i = j - 1;
    const body = block.map((l) => l.trim()).filter(Boolean);

    const r = rest.trim();
    let value;
    if (r === "") {
      value = body.some((l) => l.startsWith("-"))
        ? body.filter((l) => l.startsWith("-")).map((l) => parseScalar(l.replace(/^-\s*/, "")))
        : "";
    } else if (/^[>|][+-]?$/.test(r)) {
      value = body.join(r[0] === ">" ? " " : "\n");
    } else if (r.startsWith("[")) {
      value = splitInlineList(r.includes("]") ? r : [r, ...body].join(" "));
    } else if (/^["']/.test(r) && !new RegExp(`${r[0]}\\s*(#.*)?$`).test(r.slice(1)) && body.length) {
      value = parseScalar([r, ...body].join(" ")); // quoted scalar continued on later lines
    } else {
      value = parseScalar(r);
    }
    out[key] = value;
  }
  return out;
}

function postMeta(file, bytes, mtime, gitStatus) {
  const fm = parseFrontmatter(bytes.toString("utf8"));
  const slug = file.replace(/\.(md|mdx)$/, "");
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : fm.tags ? [String(fm.tags)] : [];
  return {
    file,
    slug,
    ext: file.endsWith(".mdx") ? "mdx" : "md",
    title: typeof fm.title === "string" ? fm.title : "",
    description: typeof fm.description === "string" ? fm.description : "",
    date: typeof fm.date === "string" && fm.date ? fm.date : null,
    tags,
    draft: typeof fm.draft === "string" && fm.draft.toLowerCase() === "true",
    hash: sha256(bytes),
    mtime,
    git: gitStatus,
    url: `/blog/${slug}/`,
  };
}

// ---- the API ----

export function createApi({ repoRoot, getAstroState, ghBin }) {
  const blogDir = path.join(repoRoot, BLOG_REL);
  const assetsDir = path.join(repoRoot, ASSETS_REL);
  const locked = createLock();

  const fileStatusMap = async () => {
    // One `git status` call for all posts; failure (not a repo) means "clean".
    const map = new Map();
    try {
      for (const e of await getStatus(repoRoot)) {
        if (e.path.startsWith(`${BLOG_REL}/`)) map.set(e.path, e.status === "new" ? "new" : "modified");
      }
    } catch {
      /* ignore */
    }
    return map;
  };

  const postName = (name) => {
    if (!POST_RE.test(name)) throw new ApiError(400, "bad_name", "Invalid post file name.");
    return name;
  };
  const assetName = (name) => {
    if (!ASSET_RE.test(name)) throw new ApiError(400, "bad_name", "Invalid asset name.");
    return name;
  };

  const conflict = (code, message, current) =>
    new ApiError(409, code, message, {
      content: current ? current.bytes.toString("utf8") : null,
      hash: current ? sha256(current.bytes) : null,
    });

  async function listPosts(res) {
    const statuses = await fileStatusMap();
    let names = [];
    try {
      names = await fsp.readdir(blogDir);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const posts = [];
    for (const name of names.filter((n) => POST_RE.test(n))) {
      const f = await readRegular(path.join(blogDir, name));
      if (!f) continue;
      posts.push(postMeta(name, f.bytes, f.mtime, statuses.get(`${BLOG_REL}/${name}`) ?? "clean"));
    }
    const ts = (p) => (p.date ? Date.parse(p.date) : NaN);
    posts.sort((a, b) => {
      const x = ts(a);
      const y = ts(b);
      if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1; // undated last
      return (y - x || 0) || a.file.localeCompare(b.file);
    });
    sendJson(res, 200, { posts });
  }

  async function getPost(res, name) {
    const f = await readRegular(childPath(blogDir, postName(name)));
    if (!f) throw new ApiError(404, "not_found", "Post not found.");
    sendJson(res, 200, {
      file: name,
      content: f.bytes.toString("utf8"),
      hash: sha256(f.bytes),
      mtime: f.mtime,
      url: `/blog/${name.replace(/\.(md|mdx)$/, "")}/`,
    });
  }

  async function putPost(req, res, name) {
    const file = childPath(blogDir, postName(name));
    const body = await readJson(req);
    const { content, baseHash, force } = body;
    if (typeof content !== "string") throw new ApiError(400, "bad_request", "`content` must be a string.");
    if (baseHash !== null && typeof baseHash !== "string") {
      throw new ApiError(400, "bad_request", "`baseHash` must be a string or null.");
    }
    const bytes = Buffer.from(content, "utf8");
    const newHash = sha256(bytes);

    const result = await locked(async () => {
      const current = await readRegular(file);
      if (current && sha256(current.bytes) === newHash) {
        return { hash: newHash, mtime: current.mtime }; // already identical
      }
      if (baseHash === null) {
        if (current) throw conflict("exists", "A post with this name already exists.", current);
      } else if (force !== true) {
        if (!current) throw conflict("conflict", "The post no longer exists.", null);
        if (sha256(current.bytes) !== baseHash) {
          throw conflict("conflict", "The post changed on the server.", current);
        }
      }
      await atomicWrite(file, bytes);
      const st = await fsp.stat(file);
      return { hash: newHash, mtime: Math.floor(st.mtimeMs) };
    });
    sendJson(res, 200, result);
  }

  async function deletePost(req, res, name) {
    const file = childPath(blogDir, postName(name));
    const { baseHash } = await readJson(req);
    if (typeof baseHash !== "string") throw new ApiError(400, "bad_request", "`baseHash` must be a string.");
    await locked(async () => {
      const current = await readRegular(file);
      if (!current) throw conflict("conflict", "The post no longer exists.", null);
      if (sha256(current.bytes) !== baseHash) {
        throw conflict("conflict", "The post changed on the server.", current);
      }
      await fsp.unlink(file);
    });
    sendJson(res, 200, { ok: true });
  }

  async function putAsset(req, res, name) {
    assetName(name);
    const bytes = await readBody(req, ASSET_LIMIT);
    if (bytes.length === 0) throw new ApiError(400, "bad_request", "Empty upload.");
    const ext = path.extname(name);
    const stem = name.slice(0, -ext.length);
    const finalName = await locked(async () => {
      await fsp.mkdir(assetsDir, { recursive: true });
      for (let n = 1; ; n++) {
        const candidate = n === 1 ? name : `${stem}-${n}${ext}`;
        const dest = childPath(assetsDir, candidate);
        const existing = await readRegular(dest);
        if (existing) {
          if (existing.bytes.equals(bytes)) return candidate; // identical: reuse
          continue;
        }
        // link() fails with EEXIST instead of clobbering if we lose a race.
        const tmp = path.join(assetsDir, `.${candidate}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`);
        try {
          await atomicWrite(tmp, bytes);
          await fsp.link(tmp, dest);
          return candidate;
        } catch (e) {
          if (e.code !== "EEXIST") throw e;
        } finally {
          await fsp.unlink(tmp).catch(() => {});
        }
      }
    });
    sendJson(res, 200, { name: finalName, path: `${ASSETS_REL}/${finalName}` });
  }

  async function getAsset(res, name) {
    const f = await readRegular(childPath(assetsDir, assetName(name)));
    if (!f) throw new ApiError(404, "not_found", "Asset not found.");
    res.writeHead(200, {
      "Content-Type": ASSET_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": f.bytes.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      // SVGs can carry script; never let one run in the editor's origin.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(f.bytes);
  }

  const reqString = (v, field, required = true) => {
    if (v === undefined || v === null) {
      if (required) throw new ApiError(400, "bad_request", `\`${field}\` is required.`);
      return undefined;
    }
    if (typeof v !== "string" || (required && !v.trim())) {
      throw new ApiError(400, "bad_request", `\`${field}\` must be a non-empty string.`);
    }
    return v;
  };

  async function gitCommit(req, res) {
    const body = await readJson(req);
    const message = reqString(body.message, "message");
    let paths = body.paths;
    if (paths !== undefined && paths !== null) {
      if (!Array.isArray(paths)) throw new ApiError(400, "bad_request", "`paths` must be an array.");
    } else paths = null;
    const commit = await locked(() => commitEditorChanges(repoRoot, { message, paths }));
    sendJson(res, 200, { commit });
  }

  async function gitPublish(req, res) {
    const body = await readJson(req);
    const message = reqString(body.message, "message");
    const title = reqString(body.title, "title", false);
    const slug = body.slug === undefined || body.slug === null ? undefined : body.slug;
    const result = await locked(() => publish(repoRoot, { message, title, slug, ghBin }));
    sendJson(res, 200, result);
  }

  async function gitSyncMain(res) {
    const branch = await locked(() => syncMain(repoRoot));
    sendJson(res, 200, { branch });
  }

  async function route(req, res, segs) {
    const [a, b] = segs;
    const method = req.method;
    const allow = (...ms) => {
      if (!ms.includes(method)) throw new ApiError(405, "method_not_allowed", "Method not allowed.");
    };
    if (a === "status" && segs.length === 1) {
      allow("GET");
      const [astro, branch, def] = await Promise.all([getAstroState(), currentBranch(repoRoot), defaultBranch(repoRoot)]);
      return sendJson(res, 200, { ok: true, astro, branch: branch || "HEAD", defaultBranch: def });
    }
    if (a === "posts" && segs.length === 1) {
      allow("GET");
      return listPosts(res);
    }
    if (a === "posts" && segs.length === 2) {
      allow("GET", "PUT", "DELETE");
      if (method === "GET") return getPost(res, b);
      if (method === "PUT") return putPost(req, res, b);
      return deletePost(req, res, b);
    }
    if (a === "assets" && segs.length === 2) {
      allow("GET", "PUT");
      return method === "GET" ? getAsset(res, b) : putAsset(req, res, b);
    }
    if (a === "git" && segs.length === 1) {
      allow("GET");
      return sendJson(res, 200, await getGitInfo(repoRoot));
    }
    if (a === "git" && segs.length === 2) {
      if (b === "commit") return allow("POST"), gitCommit(req, res);
      if (b === "publish") return allow("POST"), gitPublish(req, res);
      if (b === "sync-main") return allow("POST"), gitSyncMain(res);
    }
    throw new ApiError(404, "not_found", "Unknown endpoint.");
  }

  // `rawPath` is the part after /_editor/api (still percent-encoded, no query).
  return async function handle(req, res, rawPath) {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        // CSRF guard: custom header (forces a CORS preflight, which we never grant)
        // plus a Fetch Metadata check for browsers that send it.
        if (req.headers["x-editor"] !== "1") {
          throw new ApiError(403, "forbidden", "Missing X-Editor header.");
        }
        const site = req.headers["sec-fetch-site"];
        if (site !== undefined && site !== "same-origin") {
          throw new ApiError(403, "forbidden", "Cross-site requests are not allowed.");
        }
      }
      const segs = rawPath
        .split("/")
        .filter(Boolean)
        .map((s) => {
          let d;
          try {
            d = decodeURIComponent(s);
          } catch {
            throw new ApiError(400, "bad_name", "Invalid percent-encoding.");
          }
          // Names never contain separators, NULs or dot segments (covers ..%2f).
          if (d === "." || d === ".." || /[/\\\0]/.test(d)) throw new ApiError(400, "bad_name", "Invalid name.");
          return d;
        });
      await route(req, res, segs);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof ApiError) return sendJson(res, e.status, { error: e.code, message: e.message, ...e.extra });
      if (e instanceof GitError) return sendJson(res, e.status, { error: e.code, message: e.message });
      if (e instanceof PublishError) {
        return sendJson(res, 500, { error: "publish_failed", step: e.step, message: e.message, ...e.extra });
      }
      console.error("[editor] unexpected error:", e);
      sendJson(res, 500, { error: "internal", message: "Internal server error." });
    }
  };
}
