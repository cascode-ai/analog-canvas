// The domestic entrance survives a workerd handover. Requests not yet sent
// upstream may wait; a request already sent is NEVER replayed here.
import http from "node:http";
import { chmod, lstat, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { existsSync, writeFileSync } from "node:fs";

export function createIngress({
  upstreamPort = 8792,
  waitMs = 60_000,
  maxPending = 512,
  drainMs = 3_000,
  initialUncertainty = false,
  onUncertain = () => {},
} = {}) {
  let holding = false;
  let uncertain = initialUncertainty;
  const pending = new Set();
  const active = new Set();
  const streams = new Map();
  function admit(req, client, forward, reject) {
    if (!holding) return forward();
    if (pending.size >= maxPending) return reject();
    req.pause();
    const timer = setTimeout(() => {
      pending.delete(send);
      reject();
    }, waitMs);
    const send = () => {
      clearTimeout(timer);
      pending.delete(send);
      if (!client.destroyed) forward();
    };
    pending.add(send);
    client.once("close", () => {
      clearTimeout(timer);
      pending.delete(send);
    });
  }
  const server = http.createServer((req, res) => {
    req.on("error", () => res.destroy());
    const forward = () => {
      let response;
      const markUnknown = () => {
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !uncertain) {
          uncertain = true;
          const category = req.url.startsWith("/api/agent/")
            ? "agent"
            : req.url.startsWith("/api/auth/")
              ? "auth"
              : req.url.startsWith("/api/project")
                ? "projects"
                : "other";
          onUncertain({ at: new Date().toISOString(), category });
        }
      };
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: upstreamPort,
          method: req.method,
          path: req.url,
          headers: req.headers,
          agent: false,
        },
        (reply) => {
          response = reply;
          if (!res.destroyed) res.writeHead(reply.statusCode, reply.headers);
          reply.on("end", () => active.delete(upstream));
          reply.on("error", () => {
            markUnknown();
            active.delete(upstream);
            res.destroy();
          });
          if (
            reply.headers["content-type"]?.split(";")[0] === "text/event-stream"
          ) {
            active.delete(upstream);
            streams.set(upstream, () => {
              reply.unpipe(res);
              res.end();
              upstream.destroy();
            });
          }
          if (res.destroyed) reply.resume();
          else reply.pipe(res);
        },
      );
      active.add(upstream);
      req.on("error", () => {
        if (!req.complete) upstream.destroy(new Error("incomplete upload"));
      });
      res.on("close", () => {
        if (streams.has(upstream)) {
          streams.delete(upstream);
          upstream.destroy();
        } else if (response) {
          // A disconnected browser cannot cancel a write already accepted by
          // the application. Read its completion before allowing shutdown.
          response.unpipe(res);
          response.resume();
        }
      });
      upstream.on("error", () => {
        if (upstream.socket?.bytesWritten) markUnknown();
        active.delete(upstream);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    };
    admit(req, res, forward, () => {
      res.writeHead(503, { "Retry-After": "1" });
      res.end();
    });
  });
  server.on("upgrade", (req, client, head) => {
    client.on("error", () => client.destroy());
    admit(
      req,
      client,
      () => {
        const upstream = http.request({
          host: "127.0.0.1",
          port: upstreamPort,
          method: req.method,
          path: req.url,
          headers: req.headers,
          agent: false,
        });
        active.add(upstream);
        const close = () => {
          client.destroy();
          upstream.destroy();
        };
        client.once("close", () => {
          active.delete(upstream);
          streams.delete(upstream);
          upstream.destroy();
        });
        upstream.on("error", close);
        upstream.on("response", (reply) => {
          active.delete(upstream);
          // Preserve an authorization rejection rather than converting it to an upgrade.
          client.end(
            `HTTP/1.1 ${reply.statusCode} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
          );
          reply.resume();
        });
        upstream.on("upgrade", (reply, socket, upstreamHead) => {
          active.delete(upstream);
          streams.set(upstream, () => {
            socket.destroy();
            close();
          });
          const headers = reply.rawHeaders.reduce(
            (out, value, index, all) =>
              index % 2 ? out : out + `${value}: ${all[index + 1]}\r\n`,
            "",
          );
          client.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`);
          if (upstreamHead.length) client.write(upstreamHead);
          if (head.length) socket.write(head);
          socket.on("error", close);
          socket.on("close", close);
          client.on("close", () => socket.destroy());
          client.pipe(socket).pipe(client);
        });
        upstream.end();
      },
      () =>
        client.end(
          "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        ),
    );
  });
  function resume() {
    holding = false;
    for (const send of [...pending]) send();
  }
  return {
    server,
    status: () => ({
      holding,
      pending: pending.size,
      active: active.size,
      uncertain,
    }),
    async hold() {
      if (holding || uncertain) return false;
      holding = true;
      const deadline = performance.now() + drainMs;
      while (active.size && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (active.size || uncertain) {
        resume();
        return false;
      }
      for (const close of streams.values()) close();
      streams.clear();
      return true;
    },
    resume,
    async close() {
      resume();
      for (const req of active) req.destroy();
      for (const close of streams.values()) close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// This control socket is never exposed through nginx or a TCP listener.
async function serveIngress({
  port = 8794,
  controlPath = "/run/canvas-cn-ingress/control.sock",
  ...options
} = {}) {
  const uncertainPath = "/var/lib/canvas-cn-ingress/uncertain-write";
  const ingress = createIngress({
    ...options,
    initialUncertainty: existsSync(uncertainPath),
    onUncertain: (details) =>
      writeFileSync(
        uncertainPath,
        JSON.stringify({
          ...details,
          reason:
            "A sent write lost its response; reconcile before maintenance.",
        }) + "\n",
        { mode: 0o600 },
      ),
  });
  const control = http.createServer(async (req, res) => {
    req.resume();
    if (req.method === "GET" && req.url === "/status") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(ingress.status()));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    if (req.url === "/hold")
      res.writeHead((await ingress.hold()) ? 200 : 409).end();
    else if (req.url === "/resume") {
      ingress.resume();
      res.writeHead(200).end();
    } else res.writeHead(404).end();
  });
  try {
    if (!(await lstat(controlPath)).isSocket())
      throw new Error("control path is not a socket");
    await unlink(controlPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await new Promise((resolve, reject) => {
    control.once("error", reject);
    control.listen(controlPath, resolve);
  });
  await chmod(controlPath, 0o600);
  ingress.server.listen(port, "127.0.0.1");
  return { ingress, control };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await serveIngress();
}
