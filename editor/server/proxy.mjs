// HTTP + websocket reverse proxy to the `astro dev` server.
import http from "node:http";
import net from "node:net";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function unavailablePage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="2">
<title>Preview is starting…</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #6b6b6b; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16161a; --fg: #ececf0; --muted: #9a9aa5; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.5 system-ui, sans-serif; text-align: center; padding: 16px; box-sizing: border-box; }
  p { color: var(--muted); margin: .25rem 0 0; }
  .dot { width: 14px; height: 14px; border-radius: 50%; margin: 0 auto 1rem; background: currentColor; opacity: .5;
         animation: pulse 1s ease-in-out infinite alternate; }
  @keyframes pulse { to { opacity: .1; } }
</style></head>
<body><main><div class="dot"></div><h1 style="font-size:1.2rem;margin:0">Preview is starting…</h1>
<p>The blog's dev server is not ready yet. Retrying every 2 seconds.</p></main>
<script>setTimeout(function () { location.reload(); }, 2000);</script>
</body></html>`;
}

export function createProxy({ astroPort }) {
  const origin = `http://localhost:${astroPort}`;
  const agent = new http.Agent({ keepAlive: false }); // avoids stale sockets after astro restarts

  function sendUnavailable(res) {
    if (res.headersSent) return res.destroy();
    const body = unavailablePage();
    res.writeHead(502, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
      "Retry-After": "2",
    });
    res.end(body);
  }

  function handleRequest(req, res) {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k)) headers[k] = v;
    }
    headers.host = `localhost:${astroPort}`;
    if (headers.origin) headers.origin = origin;

    const upstream = http.request(
      { host: "127.0.0.1", port: astroPort, method: req.method, path: req.url, headers, agent },
      (up) => {
        const out = {};
        for (const [k, v] of Object.entries(up.headers)) {
          if (!HOP_BY_HOP.has(k)) out[k] = v;
        }
        res.writeHead(up.statusCode, up.statusMessage, out);
        up.pipe(res);
        up.on("error", () => res.destroy());
      },
    );
    upstream.on("error", () => sendUnavailable(res));
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  }

  // Websocket: connect raw and replay the handshake with Host/Origin rewritten,
  // then pipe bytes both ways (the 101 response flows straight back).
  function handleUpgrade(req, socket, head) {
    const upstream = net.connect(astroPort, "127.0.0.1");
    const fail = () => {
      if (socket.writable) socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      upstream.destroy();
    };
    upstream.once("error", fail);
    socket.on("error", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => upstream.destroy());

    upstream.once("connect", () => {
      upstream.off("error", fail);
      upstream.on("error", () => socket.destroy());
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      let sawOrigin = false;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i];
        const lower = name.toLowerCase();
        if (lower === "host") continue;
        if (lower === "origin") {
          if (!sawOrigin) lines.push(`Origin: ${origin}`);
          sawOrigin = true;
          continue;
        }
        lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
      }
      lines.push(`Host: localhost:${astroPort}`);
      if (!sawOrigin) lines.push(`Origin: ${origin}`);
      upstream.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
      // http sockets allow half-open connections; a FIN from either side means
      // the websocket is over, so finish the other side and force-close soon after.
      for (const [from, to] of [[socket, upstream], [upstream, socket]]) {
        from.on("end", () => {
          to.end();
          setTimeout(() => (socket.destroy(), upstream.destroy()), 1000);
        });
      }
    });
  }

  return { handleRequest, handleUpgrade };
}
