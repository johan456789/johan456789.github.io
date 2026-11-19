// Shared test helpers: throwaway git repo + bare origin, tiny HTTP client.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createServer } from "./index.mjs";

// Isolate git from the developer's global/system config (signing, hooks, ...).
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
// Tests must never call the real gh.
export const NO_GH = path.join(os.tmpdir(), "definitely-not-a-real-gh-binary");

export function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editor-test-"));
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  fs.mkdirSync(origin);
  sh(origin, "git", ["init", "--bare", "-b", "main"]);
  fs.mkdirSync(path.join(repo, "src/content/docs/blog"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src/assets"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "src/content/docs/blog/hello.md"),
    '---\ntitle: "Hello: World"\ndescription: A first post\ntags: [til, "web dev"]\ndate: 2026-01-22T22:58:11+08:00\ndraft: true\n---\n\nHi.\n',
  );
  fs.writeFileSync(
    path.join(repo, "src/content/docs/blog/second.mdx"),
    "---\ntitle: 'It''s second'\ndate: 2026-03-01T10:00:00+08:00\ntags:\n  - a\n  - b\n---\n\nBody\n",
  );
  fs.writeFileSync(path.join(repo, "README.md"), "readme\n");
  const g = (...a) => sh(repo, "git", a);
  g("init", "-b", "main");
  g("config", "user.name", "Test");
  g("config", "user.email", "test@example.com");
  g("config", "commit.gpgsign", "false");
  g("add", "-A");
  g("commit", "-m", "init");
  g("remote", "add", "origin", origin);
  g("push", "-u", "origin", "main");
  return { root, origin, repo, g, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export async function startServer(opts) {
  const server = createServer({ spawnAstro: false, ghBin: NO_GH, astroPort: 1, ...opts });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    server,
    port,
    close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))),
  };
}

// Minimal client; returns { status, headers, body (Buffer), text, json }.
export function request(port, method, urlPath, { headers = {}, body, json, mutating } = {}) {
  const h = { ...headers };
  if (json !== undefined) {
    body = JSON.stringify(json);
    h["content-type"] = "application/json";
  }
  if (mutating !== false && method !== "GET" && !("x-editor" in h)) h["x-editor"] = "1";
  if (body !== undefined) h["content-length"] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text, json: parsed });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}
