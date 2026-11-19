// Manages the blog's `astro dev` server, on demand.
//
// Astro 7 can run its dev server as a background process with its own
// lifecycle commands (`astro dev --background`, `astro dev stop`), and does so
// by itself when it is not started from an interactive terminal. We use those
// commands explicitly instead of holding a child process, so behaviour is the
// same whether the editor runs from a shell, a service, or a script.
//
// touch() is called for every request the editor receives: it starts astro if
// nothing answers on the port and resets an idle clock. After `idleMs` without
// a request the server is stopped again.
import http from "node:http";
import { execFile, spawnSync } from "node:child_process";

function probe(port) {
  return new Promise((resolve) => {
    // HEAD on a cheap Vite URL: any HTTP answer means something is listening.
    const req = http.request(
      { host: "127.0.0.1", port, path: "/@vite/client", method: "HEAD", timeout: 1500, agent: false },
      (res) => {
        res.resume();
        resolve(true);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createAstro({
  repoRoot,
  port,
  spawnEnabled = true,
  idleMs = 30 * 60_000,
  // [command, args] triples; overridable so tests can stand in a fake.
  startCommand = ["pnpm", ["exec", "astro", "dev", "--background", "--port", String(port), "--host", "127.0.0.1"]],
  stopCommand = ["pnpm", ["exec", "astro", "dev", "stop"]],
  statusCommand = ["pnpm", ["exec", "astro", "dev", "status"]],
  log = (l) => console.log(l),
}) {
  let managed = false; // a background server we may stop (started by us, or adopted)
  let shuttingDown = false;
  let lastProbe = { t: 0, ok: false };
  let lastActivity = 0;
  let lastFailure = 0;
  let starting = null; // in-flight start
  let idleStop = null; // in-flight idle stop
  let idleTimer = null;

  const run = ([cmd, args]) =>
    new Promise((resolve) => {
      execFile(cmd, args, { cwd: repoRoot, timeout: 60_000, env: process.env }, (err, stdout, stderr) => {
        resolve({ ok: !err, out: `${stdout}${stderr}`.trim() });
      });
    });

  async function listening(maxAgeMs = 1000) {
    if (Date.now() - lastProbe.t > maxAgeMs) lastProbe = { t: Date.now(), ok: await probe(port) };
    return lastProbe.ok;
  }

  async function waitFor(want, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if ((await listening(0)) === want) return true;
      await sleep(200);
    }
    return false;
  }

  async function ensureStarted() {
    if (!spawnEnabled || shuttingDown) return;
    if (starting) return starting;
    if (!idleStop && (await listening())) {
      if (!managed && !ensureStarted.checkedAdoption) {
        // Something already serves the port. If it is one of Astro's background
        // servers (e.g. left over from an earlier run of the editor), manage
        // it; a foreground `astro dev` at the desk is never touched.
        ensureStarted.checkedAdoption = true;
        const status = await run(statusCommand);
        if (/background/.test(status.out)) {
          managed = true;
          log("[astro] adopted the background dev server that was already running");
        } else {
          log(`[astro] using the dev server already answering on port ${port}; it will not be stopped`);
        }
      }
      return;
    }
    if (Date.now() - lastFailure < 5000) return; // do not hammer a failing start
    starting ??= (async () => {
      try {
        if (idleStop) await idleStop;
        if (shuttingDown || (await listening(0))) return;
        log(`[astro] starting astro dev on port ${port}`);
        const r = await run(startCommand);
        if (!r.ok || !(await waitFor(true, 30_000))) {
          lastFailure = Date.now();
          log(`[astro] failed to start: ${r.out.slice(0, 500) || "no answer on the port"}`);
          return;
        }
        managed = true;
        ensureStarted.checkedAdoption = true;
        log("[astro] ready");
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  /** Record that the editor is in use: start astro if needed, reset the idle clock. */
  function touch() {
    lastActivity = Date.now();
    if (spawnEnabled && !idleTimer && idleMs > 0) {
      idleTimer = setInterval(checkIdle, Math.max(250, Math.min(idleMs / 4, 60_000)));
      idleTimer.unref();
    }
    return ensureStarted().catch((e) => log(`[astro] start failed: ${e.message}`));
  }

  function stopManaged(why) {
    log(`[astro] ${why}; stopping astro dev`);
    managed = false;
    ensureStarted.checkedAdoption = false;
    return run(stopCommand).then(async (r) => {
      if (!r.ok) log(`[astro] stop reported: ${r.out.slice(0, 300)}`);
      await waitFor(false, 5000);
    });
  }

  function checkIdle() {
    if (shuttingDown || idleStop || starting || !managed) return;
    if (Date.now() - lastActivity < idleMs) return;
    const mins = Math.round(idleMs / 6000) / 10;
    idleStop = stopManaged(`editor idle for ${mins} min`).finally(() => (idleStop = null));
  }

  async function state() {
    if (await listening()) return "ready";
    return starting ? "starting" : "down";
  }

  async function stop() {
    shuttingDown = true;
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = null;
    if (starting) await starting;
    if (idleStop) return idleStop;
    if (managed) return stopManaged("editor server shutting down");
  }

  // Best-effort synchronous stop for process 'exit'.
  function killNow() {
    if (!managed) return;
    managed = false;
    try {
      spawnSync(stopCommand[0], stopCommand[1], { cwd: repoRoot, timeout: 10_000, stdio: "ignore" });
    } catch {}
  }

  return { touch, state, stop, killNow, isManaged: () => managed };
}
