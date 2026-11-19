// On-demand lifecycle of the preview server, using a tiny fake `astro dev`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { startServer, request } from "./helpers.mjs";

const fake = path.join(import.meta.dirname, "fake-astro.mjs");
const FAKE = (port) => {
  const pidfile = path.join(os.tmpdir(), `fake-astro-${process.pid}-${port}.pid`);
  const cmd = (mode) => [process.execPath, [fake, mode, String(port), pidfile]];
  return { startCommand: cmd("start"), stopCommand: cmd("stop"), statusCommand: cmd("status") };
};

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
}

async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe("astro on demand", () => {
  test("starts on first request, stops when idle, starts again on the next", async () => {
    const astroPort = await freePort();
    const srv = await startServer({ spawnAstro: true, astroPort, astroIdleMs: 700, astroCommands: FAKE(astroPort) });
    try {
      // Nothing runs until the editor is used.
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(await listening(astroPort), false);

      const first = await request(srv.port, "GET", "/_editor/api/status");
      assert.notEqual(first.json.astro, "down");
      assert.ok(await until(() => listening(astroPort)), "astro started after the first request");
      assert.ok(await until(async () => (await request(srv.port, "GET", "/_editor/api/status")).json.astro === "ready"));

      // Requests keep it awake past the idle limit.
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 250));
        await request(srv.port, "GET", "/_editor/api/status");
      }
      assert.equal(await listening(astroPort), true);
      assert.equal((await request(srv.port, "GET", "/blog/")).text, "fake astro");

      // Left alone, it is stopped and not restarted.
      assert.ok(await until(async () => !(await listening(astroPort))), "astro stopped after idling");
      await new Promise((r) => setTimeout(r, 1500));
      assert.equal(await listening(astroPort), false);

      // Using the editor again wakes it.
      await request(srv.port, "GET", "/_editor/api/posts");
      assert.ok(await until(() => listening(astroPort)), "astro restarted on use");
    } finally {
      await srv.close();
    }
    assert.ok(await until(async () => !(await listening(astroPort))), "astro stopped with the editor server");
  });

  test("a server that was already running is used and never stopped", async () => {
    const external = http.createServer((q, s) => s.end("external")).listen(0, "127.0.0.1");
    await new Promise((r) => external.once("listening", r));
    const astroPort = external.address().port;
    const srv = await startServer({ spawnAstro: true, astroPort, astroIdleMs: 300, astroCommands: FAKE(astroPort) });
    try {
      assert.equal((await request(srv.port, "GET", "/blog/")).text, "external");
      assert.equal(srv.server.astro.isManaged(), false);
      await new Promise((r) => setTimeout(r, 1200));
      assert.equal(await listening(astroPort), true);
    } finally {
      await srv.close();
      external.closeAllConnections();
      external.close();
    }
  });
});
