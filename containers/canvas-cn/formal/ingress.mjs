// The domestic entrance survives a workerd handover. Requests not yet sent
// upstream may wait; a request already sent is NEVER replayed here.
import http from "node:http";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chmod, lstat, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

const agentCircuitPath =
  /^\/api\/agent\/(?:sessions|region)\/([A-Za-z0-9_-]+)\/circuit(?:\?[^#]*)?$/u;
const maxInspectionBytes = 16 * 1024;
const agentWriteReceipt = "x-icm-agent-write-receipt";
const unclassified = "unclassified";
const maxRecordedWrites = 128;

function stableId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function observeAgentCircuit(req) {
  if (req.method !== "POST") return null;
  const sessionId = agentCircuitPath.exec(req.url)?.[1];
  const encoding = req.headers["content-encoding"];
  if (!sessionId || (encoding !== undefined && encoding !== "identity"))
    return null;

  // Inspect the same complete JSON envelope the relay parses. The inspection
  // budget does not change the size or streaming of the forwarded request.
  let inspected = Buffer.allocUnsafe(maxInspectionBytes);
  let bytes = 0;
  const observed = { discovery: false };
  const workspaceId = req.headers["x-agent-workspace"];
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        sessionId,
        workspaceId,
        workspaceId ? null : req.headers["x-agent-context"],
      ]),
    )
    .update("\0");
  req.on("data", (chunk) => {
    hash.update(chunk);
    if (inspected === null) return;
    if (bytes + chunk.length > inspected.length) {
      inspected = null;
      return;
    }
    chunk.copy(inspected, bytes);
    bytes += chunk.length;
  });
  req.once("end", () => {
    if (!req.complete) return;
    observed.fingerprint = hash.digest("hex");
    if (inspected === null) return;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        inspected.subarray(0, bytes),
      );
      const { apiVersion, operation, requestId, documentId } = JSON.parse(text);
      // Only complete Circuit v3 discovery envelopes qualify here.
      observed.discovery =
        apiVersion === "3.0" &&
        stableId(requestId) &&
        (operation === "capabilities" ||
          (operation === "snapshot" && stableId(documentId)));
      if (stableId(requestId))
        observed.requestIdHash = createHash("sha256")
          .update(requestId)
          .digest("hex");
    } catch {
      // Malformed or unclassified input keeps ordinary write protection.
    } finally {
      inspected = null;
    }
  });
  return observed;
}

function loadUncertainty(path) {
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    if (
      state?.version === 1 &&
      Array.isArray(state.records) &&
      state.records.length > 0 &&
      state.records.length <= maxRecordedWrites + 1 &&
      state.records.every(
        (record) =>
          typeof record?.at === "string" &&
          typeof record.category === "string" &&
          (record.fingerprint === undefined ||
            /^[a-f0-9]{64}$/u.test(record.fingerprint)),
      )
    )
      return state.records;
    // A pre-receipt marker has no evidence that can resolve it automatically.
    return [
      {
        at: typeof state?.at === "string" ? state.at : new Date().toISOString(),
        category:
          typeof state?.category === "string" ? state.category : unclassified,
      },
    ];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    return [{ at: new Date().toISOString(), category: unclassified }];
  }
}

function storeUncertainty(path, records) {
  const temporary = path + ".next";
  if (!records.length) {
    rmSync(temporary, { force: true });
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(temporary, JSON.stringify({ version: 1, records }) + "\n", {
    mode: 0o600,
    flush: true,
  });
  renameSync(temporary, path);
}

export function createIngress({
  upstreamPort = 8792,
  waitMs = 60_000,
  maxPending = 512,
  maxActive = 512,
  reserved = Math.min(32, maxActive - 1, maxPending - 1),
  maxHeavy = 32,
  queueMs = 5_000,
  drainMs = 3_000,
  uncertaintyRecords = [],
  onUncertaintyChange = () => {},
} = {}) {
  let holding = false;
  let uncertainWrites = new Map(
    uncertaintyRecords.map((record) => [
      record.fingerprint ?? unclassified,
      record,
    ]),
  );
  function persistUncertainty(writes) {
    try {
      onUncertaintyChange([...writes.values()]);
      return true;
    } catch {
      // Keep maintenance fenced in memory if the state directory cannot be written.
      console.error("Regional ingress could not persist write reconciliation.");
      return false;
    }
  }

  function rememberUnknown(category, request) {
    if (uncertainWrites.has(request?.fingerprint)) return;
    const fingerprint =
      uncertainWrites.size < maxRecordedWrites
        ? request?.fingerprint
        : undefined;
    const key = fingerprint ?? unclassified;
    if (uncertainWrites.has(key)) return;
    uncertainWrites.set(key, {
      at: new Date().toISOString(),
      category,
      ...(fingerprint
        ? { fingerprint, requestIdHash: request.requestIdHash }
        : {}),
    });
    persistUncertainty(uncertainWrites);
  }

  function reconcileWrite(fingerprint) {
    const record = uncertainWrites.get(fingerprint);
    if (!record) return;
    const remaining = new Map(uncertainWrites);
    remaining.delete(fingerprint);
    if (persistUncertainty(remaining)) {
      uncertainWrites = remaining;
      console.info(
        JSON.stringify({
          event: "agent-write-reconciled",
          fingerprint,
          requestIdHash: record.requestIdHash,
        }),
      );
    }
  }
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
      const agentCircuit = observeAgentCircuit(req);
      let completedWrite = false;
      const markUnknown = () => {
        if (!readOnly && !agentCircuit?.discovery && !completedWrite) {
          const category = req.url.startsWith("/api/agent/")
            ? "agent"
            : req.url.startsWith("/api/auth/")
              ? "auth"
              : req.url.startsWith("/api/project")
                ? "projects"
                : "other";
          rememberUnknown(category, agentCircuit);
        }
      };
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: upstreamPort,
          method: req.method,
          path: req.url,
          headers: agentCircuit
            ? { ...req.headers, [agentWriteReceipt]: "request" }
            : req.headers,
          agent: false,
        },
        (reply) => {
          response = reply;
          const fingerprint = agentCircuit?.fingerprint;
          if (
            fingerprint &&
            [200, 403, 409].includes(reply.statusCode) &&
            reply.headers[agentWriteReceipt] === "complete"
          ) {
            completedWrite = true;
            reconcileWrite(fingerprint);
          }
          delete reply.headers[agentWriteReceipt];
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
      uncertain: uncertainWrites.size > 0,
    }),
    async hold() {
      if (holding || uncertainWrites.size) return false;
      holding = true;
      const deadline = performance.now() + drainMs;
      while (active.size && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (active.size || uncertainWrites.size) {
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
      const drained = active.size === 0;
      for (const item of pending) item.reject();
      for (const req of active.keys()) req.destroy();
      for (const close of streams.values()) close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      return drained;
    },
  };
}

// This control socket is never exposed through nginx or a TCP listener.
export async function serveIngress({
  port = 8794,
  controlPath = "/run/canvas-cn-ingress/control.sock",
  uncertaintyPath = "/var/lib/canvas-cn-ingress/uncertain-write",
  ...options
} = {}) {
  const running = uncertaintyPath + ".running";
  const interrupted =
    existsSync(running) || existsSync(uncertaintyPath + ".next");
  const uncertaintyRecords = loadUncertainty(uncertaintyPath);
  if (interrupted && uncertaintyRecords.every((record) => record.fingerprint))
    uncertaintyRecords.push({
      at: new Date().toISOString(),
      category: unclassified,
    });
  // Keep durable evidence before accepting traffic, even if a later marker
  // update fails before any bytes can be written.
  writeFileSync(running, "", { mode: 0o600, flag: "a", flush: true });
  let stateStored = !interrupted;
  const ingress = createIngress({
    ...options,
    uncertaintyRecords,
    onUncertaintyChange(records) {
      stateStored = false;
      storeUncertainty(uncertaintyPath, records);
      stateStored = true;
    },
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
  await once(ingress.server, "listening");
  let stopped;
  const stop = () =>
    (stopped ??= (async () => {
      const results = await Promise.all([
        ingress.close(),
        new Promise((resolve) => {
          control.close(resolve);
          control.closeAllConnections();
        }),
      ]);
      if (results[0] && stateStored) rmSync(running);
    })());
  return { ingress, control, stop };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { stop } = await serveIngress();
  const shutdown = () =>
    void stop().catch(() => {
      console.error("Regional ingress shutdown could not record a clean stop.");
      process.exitCode = 1;
    });
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
