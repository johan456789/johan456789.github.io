// Editor server entry: API, built web client, and a proxy to `astro dev`.
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createApi } from "./api.mjs";
import { createAstro } from "./astro.mjs";
import { createProxy } from "./proxy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.resolve(here, "..");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function plain(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

async function isFile(p) {
  try {
    return (await fsp.stat(p)).isFile();
  } catch {
    return false;
  }
}

// `rawPath` is what follows "/_editor" (starts with "/", percent-encoded, no query).
async function serveStatic(req, res, distDir, rawPath) {
  if (req.method !== "GET" && req.method !== "HEAD") return plain(res, 405, "Method not allowed");
  const root = path.resolve(distDir);
  const indexFile = path.join(root, "index.html");
  if (!(await isFile(indexFile))) {
    return plain(res, 503, "The editor client is not built yet. Run `pnpm build` in editor/ and reload.\n");
  }

  let segs;
  try {
    segs = rawPath.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return plain(res, 400, "Bad request");
  }
  // Refuse traversal, separators, NULs and dotfiles outright.
  if (segs.some((s) => s.startsWith(".") || /[/\\\0]/.test(s))) return plain(res, 404, "Not found");

  let file = segs.length ? path.join(root, ...segs) : indexFile;
  if (file !== indexFile && !file.startsWith(root + path.sep)) return plain(res, 404, "Not found");
  if (!(await isFile(file))) {
    // Missing file-looking paths are real 404s; anything else is a client-side route.
    if (segs.length > 0 && path.extname(segs.at(-1))) return plain(res, 404, "Not found");
    file = indexFile;
  }

  const rel = path.relative(root, file).split(path.sep).join("/");
  const st = await fsp.stat(file);
  const headers = {
    "Content-Type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": st.size,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": rel.startsWith("assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache", // index.html, sw.js, manifest.webmanifest and everything else revalidate
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

export function createServer({
  repoRoot = process.env.REPO_ROOT ? path.resolve(process.env.REPO_ROOT) : path.resolve(editorRoot, ".."),
  astroPort = Number(process.env.ASTRO_PORT) || 4321,
  distDir = path.join(editorRoot, "dist"),
  spawnAstro = process.env.EDITOR_NO_ASTRO !== "1",
  astroIdleMs = (Number(process.env.ASTRO_IDLE_MINUTES) || 30) * 60_000,
  astroCommands,
  ghBin,
} = {}) {
  const astro = createAstro({
    repoRoot,
    port: astroPort,
    spawnEnabled: spawnAstro,
    idleMs: astroIdleMs,
    ...(astroCommands || {}),
  });
  const proxy = createProxy({ astroPort });
  const api = createApi({ repoRoot, getAstroState: () => astro.state(), ghBin });

  const server = http.createServer((req, res) => {
    // Any request means the editor is in use: wake astro and reset its idle clock.
    astro.touch();
    const p = req.url.split("?")[0];
    if (p === "/_editor/api" || p.startsWith("/_editor/api/")) {
      return api(req, res, p.slice("/_editor/api".length));
    }
    if (p === "/_editor") {
      res.writeHead(308, { Location: "/_editor/" + req.url.slice("/_editor".length) });
      return res.end();
    }
    if (p.startsWith("/_editor/")) {
      return serveStatic(req, res, distDir, p.slice("/_editor".length)).catch((e) => {
        console.error("[editor] static error:", e);
        if (!res.headersSent) plain(res, 500, "Internal server error");
        else res.destroy();
      });
    }
    // Opening the bare address should land on the editor, not the blog. Only
    // the top-level page is redirected: the preview iframe (Sec-Fetch-Dest:
    // iframe) may still reach the blog's own "/" through site links.
    if (p === "/" && req.method === "GET" && req.headers["sec-fetch-dest"] !== "iframe") {
      res.writeHead(302, { Location: "/_editor/" });
      return res.end();
    }
    proxy.handleRequest(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url.startsWith("/_editor")) {
      socket.destroy(); // the editor itself has no websockets
      return;
    }
    astro.touch();
    proxy.handleUpgrade(req, socket, head);
  });

  server.on("close", () => {
    astro.stop();
  });
  server.astro = astro;
  return server;
}

// Run directly: listen and handle shutdown.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.EDITOR_HOST || "127.0.0.1";
  const port = process.env.EDITOR_PORT === undefined ? 2531 : Number(process.env.EDITOR_PORT);
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`[editor] listening on http://${host}:${server.address().port}/_editor/`);
    console.log("[editor] astro dev starts when the editor is first opened and stops after it sits idle");
  });
  server.on("error", (e) => {
    console.error(`[editor] ${e.message}`);
    process.exit(1);
  });
  process.on("exit", () => server.astro.killNow());
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    setTimeout(() => process.exit(0), 6000).unref();
    server.close();
    server.closeAllConnections();
    await server.astro.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
