// Test stand-in for `astro dev --background` / `astro dev stop` / `status`.
// usage: fake-astro.mjs <start|serve|stop|status> <port> <pidfile>
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";

const [mode, port, pidfile] = process.argv.slice(2);
if (mode === "serve") {
  http.createServer((q, s) => s.end("fake astro")).listen(Number(port), "127.0.0.1");
} else if (mode === "start") {
  const child = spawn(process.execPath, [import.meta.filename, "serve", port, pidfile], { detached: true, stdio: "ignore" });
  fs.writeFileSync(pidfile, String(child.pid));
  child.unref();
} else if (mode === "stop") {
  try {
    process.kill(Number(fs.readFileSync(pidfile, "utf8")));
    fs.rmSync(pidfile);
  } catch {}
} else if (mode === "status") {
  console.log(fs.existsSync(pidfile) ? "Dev server running (background)" : "No dev server running");
}
