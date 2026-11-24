// The domestic entrance survives a workerd handover. Requests not yet sent
// upstream may wait; a request already sent is NEVER replayed here.
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
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
const projectTicketHeader = "x-icm-project-create-ticket";
const projectAddressHeader = "x-icm-project-client-address";
const projectReceiptPath = "/__regional/project-create-receipt";
const projectCreatePath = "/__regional/project-create";
const hexDigest = /^[a-f0-9]{64}$/u;

// A fresh ticket is bound to exactly one dispatch. Its time prefix allows
// the store to expire old receipts without ever accepting their registration again.
function newProjectTicket() {
  return (
    Date.now().toString(16).padStart(12, "0") + randomBytes(26).toString("hex")
  );
}

function isPrivateProjectPath(url) {
  try {
    const path = new URL(url, "http://localhost").pathname;
    return path === projectCreatePath || path === projectReceiptPath;
  } catch {
    return true;
  }
}

async function projectReceipt(port, action, ticket, signal, address) {
  try {
    const reply = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: projectReceiptPath,
          method: "POST",
          agent: false,
          headers: { "content-type": "application/json" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]),
        },
        resolve,
      );
      req.on("error", reject).end(JSON.stringify({ action, ticket, address }));
    });
    const limited = action === "register" && reply.statusCode === 429;
    if (
      action === "register" &&
      ([404, 405].includes(reply.statusCode) ||
        (reply.statusCode === 200 &&
          reply.headers["content-type"]?.split(";")[0] === "text/html"))
    ) {
      reply.destroy();
      return "unsupported";
    }
    if (reply.statusCode !== 200 && !limited) {
      reply.destroy();
      return "unknown";
    }
    let input = "";
    for await (const chunk of reply) {
      if (input.length + chunk.length > 512) return "unknown";
      input += chunk.toString("latin1");
    }
    if (limited) return { rateLimitBody: Buffer.from(input, "latin1") };
    const proof = JSON.parse(input);
    if (action === "handoff") {
      return proof.version === 2 &&
        proof.ticket === ticket &&
        proof.state === "handed-off" &&
        proof.operationVersion === 1 &&
        typeof proof.operation === "string" &&
        hexDigest.test(proof.operation)
        ? "handed-off"
        : "unknown";
    }
    if (
      proof.version === 1 &&
      proof.ticket === ticket &&
      ["registered", "claimed", "denied", "committed"].includes(proof.state)
    )
      return proof.state;
  } catch {
    // Interrupted or unsupported control requests supply no evidence.
  }
  return "unknown";
}

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
            (typeof record.fingerprint === "string" &&
              hexDigest.test(record.fingerprint))) &&
          (record.projectTicket === undefined ||
            (record.category === "projects" &&
              !record.fingerprint &&
              typeof record.projectTicket === "string" &&
              hexDigest.test(record.projectTicket))),
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
  receiptRetryMs = 30_000,
  supportsProjectHandoff = () => false,
  initiallyHeld = false,
  uncertaintyRecords = [],
  onUncertaintyChange = () => {},
} = {}) {
  let holding = initiallyHeld;
  let uncertainWrites = new Map(
    uncertaintyRecords.map((record) => [
      record.projectTicket
        ? "project:" + record.projectTicket
        : (record.fingerprint ?? unclassified),
      record,
    ]),
  );
  const liveProjects = new Set();
  const lookingUp = new Set();
  const stopReceipts = new AbortController();
  let retryTimer;
  function scheduleReceipts() {
    if (retryTimer || stopReceipts.signal.aborted) return;
    if (
      ![...uncertainWrites.values()].some(
        (record) =>
          record.projectTicket && !liveProjects.has(record.projectTicket),
      )
    )
      return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      for (const record of uncertainWrites.values()) {
        if (lookingUp.size >= 4) break;
        if (record.projectTicket && !liveProjects.has(record.projectTicket))
          void settleProject(record.projectTicket);
      }
      scheduleReceipts();
    }, receiptRetryMs);
    retryTimer.unref();
  }
  async function settleProject(ticket) {
    const key = "project:" + ticket;
    if (
      lookingUp.has(ticket) ||
      stopReceipts.signal.aborted ||
      !uncertainWrites.has(key)
    )
      return;
    lookingUp.add(ticket);
    let state = await projectReceipt(
      upstreamPort,
      "settle",
      ticket,
      stopReceipts.signal,
    );
    if (
      state === "claimed" &&
      !stopReceipts.signal.aborted &&
      supportsProjectHandoff()
    ) {
      // Only the store can withdraw the old executor's write authority and
      // accept durable responsibility for this exact ticket.
      state = await projectReceipt(
        upstreamPort,
        "handoff",
        ticket,
        stopReceipts.signal,
      );
    }
    lookingUp.delete(ticket);
    if (stopReceipts.signal.aborted) return;
    if (state === "committed" || state === "denied" || state === "handed-off") {
      const remaining = new Map(uncertainWrites);
      remaining.delete(key);
      if (persistUncertainty(remaining)) uncertainWrites = remaining;
    } else {
      // Rotate unknown receipts so an unavailable one never starves later tickets.
      const record = uncertainWrites.get(key);
      uncertainWrites.delete(key);
      uncertainWrites.set(key, record);
    }
    scheduleReceipts();
  }
  scheduleReceipts();
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
    if (isPrivateProjectPath(req.url)) return res.writeHead(404).end();
    delete req.headers[projectTicketHeader];
    delete req.headers[projectAddressHeader];
    const forward = (ticket) => {
      let response;
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(req.method);
      const agentCircuit = observeAgentCircuit(req);
      let completedWrite = false;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        release(upstream);
        if (ticket) {
          // A fully returned creation is still draining its first local proof.
          // A maintenance tick may wait for it instead of reporting a lost write.
          if (!response?.complete) liveProjects.delete(ticket);
          void settleProject(ticket).finally(() => {
            liveProjects.delete(ticket);
            scheduleReceipts();
          });
        }
      };
      const markUnknown = (error) => {
        if (ticket) {
          const record = uncertainWrites.get("project:" + ticket);
          if (!record) return;
          record.phase = response
            ? "response-interrupted"
            : upstream.writableFinished
              ? "awaiting-response"
              : "request-incomplete";
          if (
            ["ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNREFUSED"].includes(
              error?.code,
            )
          )
            record.socketError = error.code;
          persistUncertainty(uncertainWrites);
          return;
        }
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
      const headers = { ...req.headers };
      if (ticket) {
        // Public nginx always marks its requests with x-real-ip. A private
        // dispatch carries the same address separately; workerd checks the boundary.
        if (headers["x-real-ip"])
          headers[projectAddressHeader] = headers["x-real-ip"];
        delete headers["x-real-ip"];
        headers.host = `127.0.0.1:${upstreamPort}`;
        headers[projectTicketHeader] = ticket;
      } else if (agentCircuit) headers[agentWriteReceipt] = "request";
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: upstreamPort,
          method: req.method,
          path: ticket ? projectCreatePath : req.url,
          headers,
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
          if (
            ticket &&
            reply.headers["x-icm-project-create-protocol"] !== "1"
          ) {
            // An old Worker can serve its app shell for an unknown path.
            if (!res.destroyed)
              res.writeHead(503, { "Retry-After": "1" }).end();
            reply.on("end", finish).on("error", finish).resume();
            return;
          }
          delete reply.headers["x-icm-project-create-protocol"];
          delete reply.headers[projectTicketHeader];
          delete reply.headers[projectAddressHeader];
          if (!res.destroyed) res.writeHead(reply.statusCode, reply.headers);
          reply.on("end", finish);
          reply.on("error", (error) => {
            markUnknown(error);
            finish();
            res.destroy();
          });
          if (
            !ticket &&
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
      upstream.on("error", (error) => {
        if (ticket || upstream.socket?.bytesWritten) markUnknown(error);
        finish();
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    };
    const reject = () => {
      res.writeHead(503, { "Retry-After": "1" });
      res.end();
    };
    const registerAndForward = async () => {
      const registration = new AbortController();
      const slot = { destroy: () => registration.abort() };
      track(slot, req);
      const ticket = newProjectTicket();
      try {
        const proof = await projectReceipt(
          upstreamPort,
          "register",
          ticket,
          registration.signal,
          req.headers["x-real-ip"],
        );
        if (registration.signal.aborted || res.destroyed || req.aborted) return;
        // No business request has been sent. An older Worker can handle the
        // ordinary route once, under the original conservative write fence.
        if (proof === "unsupported") return forward();
        if (proof.rateLimitBody)
          return res
            .writeHead(429, {
              "Retry-After": "60",
              "Cache-Control": "no-store",
              "Content-Type": "application/json",
            })
            .end(proof.rateLimitBody);
        if (proof !== "registered" || uncertainWrites.size >= maxRecordedWrites)
          return reject();
        const key = "project:" + ticket;
        const writes = new Map(uncertainWrites);
        writes.set(key, {
          at: new Date().toISOString(),
          category: "projects",
          projectTicket: ticket,
        });
        if (!persistUncertainty(writes)) return reject();
        uncertainWrites = writes;
        liveProjects.add(ticket);
        forward(ticket);
      } finally {
        release(slot);
      }
    };
    const key = req.headers["idempotency-key"];
    const keyedCreate =
      req.method === "POST" &&
      /^\/api\/projects(?:\?[^#]*)?$/u.test(req.url) &&
      // sessionUserOf accepts either regional browser session cookie.
      /(?:^|;)\s*icm_(?:regional_)?session=[^\s;]/u.test(
        req.headers.cookie ?? "",
      ) &&
      typeof key === "string" &&
      /^[a-zA-Z0-9_-]{1,160}$/u.test(key);
    admit(req, res, keyedCreate ? registerAndForward : forward, reject);
  });
  server.on("upgrade", (req, client, head) => {
    client.on("error", () => client.destroy());
    if (isPrivateProjectPath(req.url))
      return client.end(
        "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    delete req.headers[projectTicketHeader];
    delete req.headers[projectAddressHeader];
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
  function hasUncertainWrite() {
    return [...uncertainWrites.values()].some(
      (record) => !liveProjects.has(record.projectTicket),
    );
  }
  return {
    server,
    status: () => ({
      holding,
      pending: pending.size,
      active: active.size,
      uncertain: hasUncertainWrite(),
    }),
    async hold() {
      if (holding || hasUncertainWrite()) return false;
      holding = true;
      const deadline = performance.now() + drainMs;
      while ((active.size || lookingUp.size) && performance.now() < deadline) {
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
      stopReceipts.abort();
      clearTimeout(retryTimer);
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

// The old release runner knows only /hold. Refuse it even when this release's
// declared capability file is missing or its manifest cannot be read.
function declaresProjectOperations(release) {
  try {
    const files = JSON.parse(
      readFileSync(release + "/release.json", "utf8"),
    ).files;
    return (
      files === null ||
      typeof files !== "object" ||
      Array.isArray(files) ||
      Object.hasOwn(files, "project-create-operation-format.json")
    );
  } catch {
    return true;
  }
}

// This control socket is never exposed through nginx or a TCP listener.
export async function serveIngress({
  port = 8794,
  controlPath = "/run/canvas-cn-ingress/control.sock",
  uncertaintyPath = "/var/lib/canvas-cn-ingress/uncertain-write",
  release = "/opt/analog-canvas/current-formal",
  supportsProjectHandoff = () =>
    existsSync(release + "/project-create-operation-format.json"),
  ...options
} = {}) {
  const running = uncertaintyPath + ".running";
  const managedHold = uncertaintyPath + ".operation-hold";
  let operationReader = null;
  let operationInventory = null;
  try {
    const stored = /^([01])(?:\n([0-9a-f]{64}))?$/u.exec(
      readFileSync(managedHold, "utf8"),
    );
    operationReader = stored ? Number(stored[1]) : -1;
    operationInventory = stored?.[2] ?? null;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const interrupted =
    existsSync(running) || existsSync(uncertaintyPath + ".next");
  const uncertaintyRecords = loadUncertainty(uncertaintyPath);
  if (
    interrupted &&
    uncertaintyRecords.every(
      (record) => record.fingerprint || record.projectTicket,
    )
  )
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
    supportsProjectHandoff,
    initiallyHeld: operationReader !== null,
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
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          ...ingress.status(),
          operationReader,
          operationInventory,
        }),
      );
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const managed = /^\/hold-project-operations\/(0|1)$/u.exec(req.url);
    const seal = /^\/seal-project-operations\/([0-9a-f]{64})$/u.exec(req.url);
    if (seal) {
      if (
        operationReader === null ||
        operationReader < 0 ||
        (operationInventory !== null && operationInventory !== seal[1])
      )
        return res.writeHead(409).end();
      // Atomic replacement preserves the unsealed hold if recording fails.
      try {
        writeFileSync(managedHold + ".next", operationReader + "\n" + seal[1], {
          mode: 0o600,
          flush: true,
        });
        renameSync(managedHold + ".next", managedHold);
        operationInventory = seal[1];
      } catch {
        return res.writeHead(503).end();
      }
      return res.writeHead(200).end();
    }
    if (managed && operationReader !== null) return res.writeHead(409).end();
    if (
      req.url === "/hold" &&
      (supportsProjectHandoff() ||
        operationReader !== null ||
        declaresProjectOperations(release))
    )
      res.writeHead(409).end();
    else if (req.url === "/hold" || managed) {
      if (!(await ingress.hold())) return res.writeHead(409).end();
      if (managed) {
        try {
          writeFileSync(managedHold, managed[1], { mode: 0o600, flush: true });
          operationReader = Number(managed[1]);
        } catch {
          ingress.resume();
          return res.writeHead(503).end();
        }
      }
      res.writeHead(200).end();
    } else if (req.url === "/resume" && operationReader !== null) {
      res.writeHead(409).end();
    } else if (
      req.url === "/resume" ||
      req.url === "/resume-project-operations"
    ) {
      if (operationReader !== null) {
        if (operationReader < 0) return res.writeHead(409).end();
        try {
          rmSync(managedHold);
        } catch {
          return res.writeHead(503).end();
        }
        operationReader = null;
        operationInventory = null;
      }
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
