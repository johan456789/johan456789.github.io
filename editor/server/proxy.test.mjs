import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { request, startServer } from "./helpers.mjs";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function textFrame(text) {
  const p = Buffer.from(text);
  const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([head, p]);
}

describe("proxy and static", () => {
  let upstream;
  let upPort;
  let srv;
  let dist;
  const seenUpgrades = [];

  before(async () => {
    upstream = http.createServer((req, res) => {
      const body = JSON.stringify({ host: req.headers.host, origin: req.headers.origin, url: req.url, method: req.method });
      if (req.url === "/stream") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("first;");
        setTimeout(() => res.end("second"), 150);
        return;
      }
      if (req.url === "/echo-body") {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          res.writeHead(201, { "content-type": "text/plain", "x-up": "1" });
          res.end(Buffer.concat(chunks));
        });
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] });
      res.end(body);
    });
    upstream.on("upgrade", (req, socket) => {
      seenUpgrades.push(req.headers);
      const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + GUID).digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.write(textFrame(JSON.stringify({ host: req.headers.host, origin: req.headers.origin })));
      socket.on("data", (d) => socket.write(Buffer.concat([Buffer.from("echo:"), d])));
      socket.on("end", () => socket.end());
      socket.on("error", () => {});
    });
    await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
    upPort = upstream.address().port;

    dist = fs.mkdtempSync(path.join(os.tmpdir(), "editor-dist-"));
    fs.mkdirSync(path.join(dist, "assets"));
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>app</title>");
    fs.writeFileSync(path.join(dist, "sw.js"), "// sw");
    fs.writeFileSync(path.join(dist, "manifest.webmanifest"), "{}");
    fs.writeFileSync(path.join(dist, "assets", "app-abc123.js"), "console.log(1)");
    fs.writeFileSync(path.join(dist, "secret.txt"), "x");
    srv = await startServer({ astroPort: upPort, distDir: dist });
  });
  after(async () => {
    await srv.close();
    await new Promise((r) => (upstream.closeAllConnections(), upstream.close(r)));
    fs.rmSync(dist, { recursive: true, force: true });
  });

  test("HTTP is forwarded with Host rewritten", async () => {
    const r = await request(srv.port, "GET", "/blog/hello/?x=1", {
      headers: { host: "pc.tailnet.ts.net", origin: "https://pc.tailnet.ts.net" },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, {
      host: `localhost:${upPort}`,
      origin: `http://localhost:${upPort}`,
      url: "/blog/hello/?x=1",
      method: "GET",
    });
    assert.deepEqual(r.headers["set-cookie"], ["a=1", "b=2"]);
  });

  test("request bodies are forwarded", async () => {
    const r = await request(srv.port, "POST", "/echo-body", { body: "hello upstream", mutating: false });
    assert.equal(r.status, 201);
    assert.equal(r.text, "hello upstream");
    assert.equal(r.headers["x-up"], "1");
  });

  test("responses are streamed, not buffered", async () => {
    const t0 = Date.now();
    const firstChunkAt = await new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port: srv.port, path: "/stream", agent: false }, (res) => {
        res.once("data", (d) => {
          assert.equal(d.toString(), "first;");
          resolve(Date.now() - t0);
          res.resume();
        });
      });
      req.on("error", reject);
    });
    assert.ok(firstChunkAt < 120, `first chunk after ${firstChunkAt}ms`);
  });

  test("websocket upgrade is proxied with Host and Origin rewritten", async () => {
    const key = Buffer.from("0123456789abcdef").toString("base64");
    const { res, socket, head } = await new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: srv.port,
        path: "/?token=abc",
        agent: false,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": key,
          "Sec-WebSocket-Protocol": "vite-hmr",
          Host: "pc.tailnet.ts.net",
          Origin: "https://pc.tailnet.ts.net",
        },
      });
      req.on("upgrade", (res, socket, head) => resolve({ res, socket, head }));
      req.on("response", (r) => reject(new Error(`no upgrade, got ${r.statusCode}`)));
      req.on("error", reject);
      req.end();
    });
    assert.equal(res.statusCode, 101);
    assert.equal(res.headers["sec-websocket-accept"], createHash("sha1").update(key + GUID).digest("base64"));

    const read = (n) =>
      new Promise((resolve) => {
        let buf = Buffer.alloc(0);
        const on = (d) => {
          buf = Buffer.concat([buf, d]);
          if (buf.length >= n) (socket.off("data", on), resolve(buf));
        };
        socket.on("data", on);
        on(Buffer.alloc(0));
      });
    socket.unshift(head);
    const frame = await read(2);
    const len = frame[1];
    const full = len + 2 > frame.length ? await read(len + 2) : frame;
    const payload = JSON.parse(full.subarray(2, 2 + len).toString());
    assert.equal(payload.host, `localhost:${upPort}`);
    assert.equal(payload.origin, `http://localhost:${upPort}`);
    const seen = seenUpgrades.at(-1);
    assert.equal(seen["sec-websocket-protocol"], "vite-hmr");
    assert.equal(seen["sec-websocket-key"], key);

    // Bytes flow both ways after the handshake.
    socket.write("ping");
    const echoed = await read("echo:ping".length);
    assert.equal(echoed.toString(), "echo:ping");
    socket.destroy();
  });

  test("unreachable astro gives a friendly auto-retrying 502", async () => {
    const free = await new Promise((r) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => r(p));
      });
    });
    const dead = await startServer({ astroPort: free, distDir: dist });
    try {
      const r = await request(dead.port, "GET", "/blog/");
      assert.equal(r.status, 502);
      assert.match(r.headers["content-type"], /text\/html/);
      assert.match(r.text, /Preview is starting/);
      assert.match(r.text, /http-equiv="refresh" content="2"/);
      assert.match(r.text, /prefers-color-scheme: dark/);
      const status = await request(dead.port, "GET", "/_editor/api/status");
      assert.equal(status.json.astro, "down");
    } finally {
      await dead.close();
    }
  });

  test("status reports astro ready when upstream answers", async () => {
    const r = await request(srv.port, "GET", "/_editor/api/status");
    assert.equal(r.json.astro, "ready");
  });

  test("/_editor paths are never proxied; websocket upgrades there are refused", async () => {
    const before = seenUpgrades.length;
    const err = await new Promise((resolve) => {
      const req = http.request({
        host: "127.0.0.1",
        port: srv.port,
        path: "/_editor/ws",
        agent: false,
        headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "x" },
      });
      req.on("upgrade", () => resolve(null));
      req.on("error", resolve);
      req.on("response", () => resolve("response"));
      req.end();
    });
    assert.ok(err);
    assert.equal(seenUpgrades.length, before);
  });

  test("static: index, SPA fallback, caching, 404 for missing files", async () => {
    const redirect = await request(srv.port, "GET", "/_editor?x=1");
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.location, "/_editor/?x=1");

    const index = await request(srv.port, "GET", "/_editor/");
    assert.equal(index.status, 200);
    assert.match(index.headers["content-type"], /text\/html/);
    assert.equal(index.headers["cache-control"], "no-cache");
    assert.match(index.text, /<title>app<\/title>/);

    const spa = await request(srv.port, "GET", "/_editor/post/some-slug");
    assert.equal(spa.status, 200);
    assert.equal(spa.text, index.text);

    for (const f of ["sw.js", "manifest.webmanifest"]) {
      const r = await request(srv.port, "GET", `/_editor/${f}`);
      assert.equal(r.status, 200, f);
      assert.equal(r.headers["cache-control"], "no-cache", f);
    }
    assert.match((await request(srv.port, "GET", "/_editor/manifest.webmanifest")).headers["content-type"], /manifest\+json/);
    assert.match((await request(srv.port, "GET", "/_editor/sw.js")).headers["content-type"], /javascript/);

    const asset = await request(srv.port, "GET", "/_editor/assets/app-abc123.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers["cache-control"], /immutable/);
    assert.match(asset.headers["cache-control"], /max-age=31536000/);

    assert.equal((await request(srv.port, "GET", "/_editor/assets/missing.js")).status, 404);
  });

  test("static: traversal is refused", async () => {
    for (const p of ["/_editor/..%2f..%2fREADME.md", "/_editor/%2e%2e/secret", "/_editor/../server/index.mjs", "/_editor/.git/config"]) {
      const r = await request(srv.port, "GET", p);
      assert.ok(r.status === 404 || r.status === 400 || r.status === 200, p);
      assert.ok(!r.text.includes("createServer"), p);
    }
    const r = await request(srv.port, "GET", "/_editor/..%2f..%2fREADME.md");
    assert.equal(r.status, 404);
  });

  test("static: missing dist gives a plain-text hint", async () => {
    const s = await startServer({ astroPort: upPort, distDir: path.join(dist, "nope") });
    try {
      const r = await request(s.port, "GET", "/_editor/");
      assert.equal(r.status, 503);
      assert.match(r.headers["content-type"], /text\/plain/);
      assert.match(r.text, /pnpm build/);
    } finally {
      await s.close();
    }
  });
});
