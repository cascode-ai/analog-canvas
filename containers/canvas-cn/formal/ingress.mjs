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
  maxActive = 512,
  reserved = Math.min(32, maxActive - 1, maxPending - 1),
  maxHeavy = 32,
  queueMs = 5_000,
  drainMs = 3_000,
  initialUncertainty = false,
  onUncertain = () => {},
} = {}) {
  let holding = false;
  let uncertain = initialUncertainty;
  const pending = new Set();
  const active = new Map();
  const counts = { critical: 0, heavy: 0, ordinary: 0 };
  const streams = new Map();
  let dispatchScheduled = false;
  let criticalStreak = 0;
  function laneOf(req) {
    let path;
    try {
      path = new URL(req.url, "http://localhost").pathname;
    } catch {
      return "ordinary";
    }
    if (
      path.startsWith("/api/auth/") ||
      (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
        /^\/api\/projects(?:\/[^/]+(?:\/versions\/[^/]+\/restore)?)?$/.test(
          path,
        ))
    )
      return "critical";
    // Match the Gallery router's prefix and empty-segment handling, including
    // accepted aliases; an equivalent wall URL cannot bypass its budget.
    if (
      ["GET", "HEAD"].includes(req.method) &&
      path.startsWith("/api/gallery")
    ) {
      const segments = path.split("/").filter(Boolean).slice(2);
      if (
        segments.length === 0 ||
        (segments.length === 1 &&
          [
            "tags",
            "authors",
            "owner-data",
            "recycled",
            "rejected",
            "sources",
          ].includes(segments[0]))
      )
        return "heavy";
    }
    return "ordinary";
  }
  function available(lane) {
    return (
      active.size < maxActive &&
      (lane === "critical" ||
        active.size - counts.critical < maxActive - reserved) &&
      (lane !== "heavy" || counts.heavy < maxHeavy)
    );
  }
  function track(upstream, req) {
    const lane = laneOf(req);
    active.set(upstream, lane);
    counts[lane]++;
  }
  function release(upstream) {
    const lane = active.get(upstream);
    if (lane === undefined) return;
    active.delete(upstream);
    counts[lane]--;
    pump();
  }
  function pump() {
    if (holding || dispatchScheduled || !pending.size) return;
    dispatchScheduled = true;
    setImmediate(() => {
      dispatchScheduled = false;
      // Bounded batches avoid dumping a whole maintenance backlog into workerd.
      for (let sent = 0; !holding && sent < 32; sent++) {
        const eligible = [...pending].filter((item) => available(item.lane));
        const critical = eligible.find((item) => item.lane === "critical");
        const ordinary = eligible.find((item) => item.lane !== "critical");
        const next =
          criticalStreak < 3 ? critical || ordinary : ordinary || critical;
        if (!next) return;
        criticalStreak = next.lane === "critical" ? criticalStreak + 1 : 0;
        next.send();
      }
      pump();
    });
  }
  function admit(req, client, forward, reject) {
    const lane = laneOf(req);
    if (!holding && !pending.size && available(lane)) return forward();
    if (pending.size >= maxPending) return reject();
    if (
      lane !== "critical" &&
      [...pending].filter((item) => item.lane !== "critical").length >=
        maxPending - reserved
    )
      return reject();
    req.pause();
    const remove = () => {
      clearTimeout(timer);
      pending.delete(item);
      client.off("close", remove);
    };
    const item = {
      lane,
      send() {
        remove();
        if (!client.destroyed) forward();
      },
      reject() {
        remove();
        reject();
      },
    };
    const timer = setTimeout(
      () => {
        item.reject();
        pump();
      },
      holding ? waitMs : queueMs,
    );
    pending.add(item);
    client.once("close", remove);
    pump();
  }
  const server = http.createServer((req, res) => {
    req.on("error", () => res.destroy());
    const forward = () => {
      let response;
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(req.method);
      const markUnknown = () => {
        if (!readOnly && !uncertain) {
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
          reply.on("end", () => release(upstream));
          reply.on("error", () => {
            markUnknown();
            release(upstream);
            res.destroy();
          });
          if (
            reply.headers["content-type"]?.split(";")[0] === "text/event-stream"
          ) {
            release(upstream);
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
      track(upstream, req);
      req.on("error", () => {
        if (!req.complete) upstream.destroy(new Error("incomplete upload"));
      });
      res.on("close", () => {
        if (streams.has(upstream)) {
          streams.delete(upstream);
          upstream.destroy();
        } else if (readOnly && !res.writableFinished) {
          // An abandoned read has no completion to preserve for its client.
          // Writes remain tracked until their outcome is known.
          release(upstream);
          response?.destroy();
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
        release(upstream);
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
        track(upstream, req);
        const close = () => {
          client.destroy();
          upstream.destroy();
        };
        client.once("close", () => {
          release(upstream);
          streams.delete(upstream);
          upstream.destroy();
        });
        upstream.on("error", close);
        upstream.on("response", (reply) => {
          release(upstream);
          // Preserve an authorization rejection rather than converting it to an upgrade.
          client.end(
            `HTTP/1.1 ${reply.statusCode} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
          );
          reply.resume();
        });
        upstream.on("upgrade", (reply, socket, upstreamHead) => {
          release(upstream);
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
    pump();
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
      holding = true;
      for (const item of pending) item.reject();
      for (const req of active.keys()) req.destroy();
      for (const close of streams.values()) close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// This control socket is never exposed through nginx or a TCP listener.
export async function serveIngress({
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
