import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createIngress, serveIngress } from "./ingress.mjs";

test("a durable fenced handoff releases only its attempt and makes room for an unrelated create", async (t) => {
  const tickets = Array.from({ length: 128 }, (_, i) =>
    i.toString(16).padStart(64, "0"),
  );
  const retained = tickets.map((projectTicket) => ({
    category: "projects",
    at: "2026-11-24",
    projectTicket,
  }));
  let records = retained,
    newTicket;
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/__regional/project-create-receipt") {
      const { action, ticket } = JSON.parse(body);
      if (action === "register") newTicket = ticket;
      res.end(
        JSON.stringify(
          action === "handoff"
            ? {
                version: 2,
                ticket: tickets[0],
                operationVersion: 1,
                operation: "a".repeat(64),
                state: "handed-off",
              }
            : {
                version: 1,
                ticket,
                state:
                  action === "register"
                    ? "registered"
                    : ticket === newTicket
                      ? "committed"
                      : "claimed",
              },
        ),
      );
    } else
      res
        .writeHead(201, { "x-icm-project-create-protocol": "1" })
        .end("created");
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    receiptRetryMs: 5,
    supportsProjectHandoff: () => true,
    uncertaintyRecords: retained,
    onUncertaintyChange: (value) => {
      records = value;
    },
  });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  await vi.waitFor(() => assert.equal(records.length, 127));
  assert.equal(
    records.some((r) => r.projectTicket === tickets[0]),
    false,
  );
  assert.equal(
    (
      await request(port, "/api/projects", "synthetic", {
        cookie: "icm_session=test",
        "idempotency-key": "new-project",
      })
    ).status,
    201,
  );
  assert.equal(await ingress.hold(), false);
});

test("a lost Cloud Project response reconciles from its private receipt without repeating the creation", async (t) => {
  let ticket;
  const writes = [];
  const snapshots = [];
  let result = "claimed";
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/__regional/project-create-receipt") {
      const call = JSON.parse(body);
      assert.equal(req.headers.cookie, undefined);
      assert.equal(req.headers["idempotency-key"], undefined);
      assert.equal(req.headers["x-real-ip"], undefined);
      assert.equal(req.headers["x-icm-project-client-address"], undefined);
      assert.equal(
        call.address,
        call.action === "register" ? "192.0.2.42" : undefined,
      );
      if (call.action === "register") ticket = call.ticket;
      res.end(
        JSON.stringify({
          version: 1,
          ticket: call.ticket,
          state: call.action === "register" ? "registered" : result,
        }),
      );
      return;
    }
    writes.push({
      path: req.url,
      ticket: req.headers["x-icm-project-create-ticket"],
      key: req.headers["idempotency-key"],
      publicAddress: req.headers["x-real-ip"],
      privateAddress: req.headers["x-icm-project-client-address"],
      body,
    });
    req.socket.destroy();
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    receiptRetryMs: 20,
    onUncertaintyChange: (records) => snapshots.push(structuredClone(records)),
  });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  assert.equal(
    (
      await request(port, "/api/projects", "private design", {
        "idempotency-key": "private-project-key",
        "x-real-ip": "192.0.2.42",
        "x-icm-project-client-address": "untrusted",
        cookie: "icm_session=private-session",
        "x-icm-project-create-ticket": "untrusted",
      })
    ).status,
    502,
  );
  assert.match(ticket ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(await ingress.hold(), false);
  assert.doesNotMatch(
    JSON.stringify(snapshots),
    /private design|private-project-key|private-session|192\.0\.2\.42/,
  );
  result = "committed";
  await vi.waitFor(() => assert.equal(ingress.status().uncertain, false));
  assert.equal(await ingress.hold(), true);
  assert.deepEqual(writes, [
    {
      path: "/__regional/project-create",
      ticket,
      key: "private-project-key",
      publicAddress: undefined,
      privateAddress: "192.0.2.42",
      body: "private design",
    },
  ]);
});

test("a rolled-back runtime cannot report a successful save or clear an unrelated or mismatched receipt", async (t) => {
  const legacy = { at: "2026-11-21", category: "projects" };
  const records = [];
  let terminal = false;
  let writes = 0;
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/__regional/project-create-receipt") {
      const { action, ticket } = JSON.parse(body);
      const mismatch = action === "settle" && !terminal;
      res.end(
        JSON.stringify({
          version: 1,
          ticket: mismatch ? "0".repeat(64) : ticket,
          state: action === "register" ? "registered" : "denied",
        }),
      );
    } else {
      writes++;
      res.end("<html>old runtime</html>");
    }
  });
  const upstreamPort = await listen(backend);
  let ingress = createIngress({
    upstreamPort,
    uncertaintyRecords: [legacy],
    receiptRetryMs: 10,
    onUncertaintyChange: (state) => records.push(structuredClone(state)),
  });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  assert.equal(
    (await request(port, "/__regional/project-create", "{}")).status,
    404,
  );
  assert.equal(
    (await request(port, "/__regional/project-create-receipt", "{}")).status,
    404,
  );
  assert.equal(
    (
      await request(port, "/api/projects", "private", {
        "idempotency-key": "retry",
        cookie: "icm_regional_session=example",
      })
    ).status,
    503,
  );
  assert.equal(writes, 1);
  await ingress.close();
  const saved = records.at(-1);
  assert.equal(saved.length, 2);
  ingress = createIngress({
    upstreamPort,
    uncertaintyRecords: saved,
    receiptRetryMs: 10,
    onUncertaintyChange: (state) => records.push(structuredClone(state)),
  });
  await listen(ingress.server);
  terminal = true;
  await vi.waitFor(() => assert.deepEqual(records.at(-1), [legacy]));
  assert.equal(await ingress.hold(), false);
  assert.equal(writes, 1);
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

test("an older domestic Worker still accepts keyed creates with the legacy lost-write fence", async (t) => {
  let writes = 0;
  let registrations = 0;
  let malformed = false;
  const backend = http.createServer((req, res) => {
    req.resume();
    if (req.url === "/__regional/project-create-receipt") {
      registrations++;
      if (malformed)
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
      else
        res
          .writeHead(200, { "content-type": "text/html; charset=utf-8" })
          .end("<html>old runtime</html>");
      return;
    }
    assert.equal(req.url, "/api/projects");
    if (!req.headers.cookie?.includes("icm_session="))
      return res.writeHead(401).end();
    if (++writes === 1) res.writeHead(201).end("accepted by older Worker");
    else req.socket.destroy();
  });
  const ingress = createIngress({ upstreamPort: await listen(backend) });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const create = (key) =>
    request(port, "/api/projects", "project", {
      "idempotency-key": key,
      cookie: "icm_session=example",
    });
  assert.equal(
    (
      await request(port, "/api/projects", "project", {
        "idempotency-key": "anonymous",
        cookie: "preference=on",
      })
    ).status,
    401,
  );
  assert.equal(registrations, 0);
  assert.equal((await create("one")).status, 201);
  assert.equal((await create("two")).status, 502);
  assert.equal(await ingress.hold(), false);
  malformed = true;
  assert.equal((await create("three")).status, 503);
  assert.equal(writes, 2);
});

test("a receipt lookup for one creation leaves a second active creation alone", async (t) => {
  let active;
  let activeTicket;
  const proofs = [];
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/__regional/project-create-receipt") {
      const { action, ticket } = JSON.parse(body);
      if (action === "settle") proofs.push(ticket);
      res.end(
        JSON.stringify({
          version: 1,
          ticket,
          state: action === "register" ? "registered" : "committed",
        }),
      );
    } else if (body === "working") {
      activeTicket = req.headers["x-icm-project-create-ticket"];
      active = res;
    } else req.socket.destroy();
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    receiptRetryMs: 5,
  });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const original = request(port, "/api/projects", "working", {
    "idempotency-key": "working",
    cookie: "icm_session=example",
  });
  await vi.waitFor(() => assert.ok(active));
  assert.equal(
    (
      await request(port, "/api/projects", "lost reply", {
        "idempotency-key": "lost",
        cookie: "icm_regional_session=example",
      })
    ).status,
    502,
  );
  await vi.waitFor(() => assert.equal(ingress.status().uncertain, false));
  assert.equal(proofs.length, 1);
  assert.notEqual(proofs[0], activeTicket);
  active
    .writeHead(201, { "x-icm-project-create-protocol": "1" })
    .end("created");
  assert.deepEqual(await original, { status: 201, body: "created" });
  await vi.waitFor(() => assert.ok(proofs.includes(activeTicket)));
  assert.equal(await ingress.hold(), true);
});

test("slow outstanding lookups leave a later completed receipt a turn", async (t) => {
  const tickets = Array.from({ length: 5 }, (_, i) => String(i).repeat(64));
  const waiting = new Map();
  let latest = tickets.map((projectTicket) => ({
    at: "2026-11-23",
    category: "projects",
    projectTicket,
  }));
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { ticket } = JSON.parse(body);
    if (ticket === tickets[4])
      res.end(JSON.stringify({ version: 1, ticket, state: "committed" }));
    else
      waiting.set(ticket, () =>
        res.end(JSON.stringify({ version: 1, ticket, state: "claimed" })),
      );
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    receiptRetryMs: 5,
    uncertaintyRecords: latest,
    onUncertaintyChange: (records) => {
      latest = records;
    },
  });
  await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  await vi.waitFor(() => assert.equal(waiting.size, 4));
  waiting.get(tickets[0])();
  await vi.waitFor(() =>
    assert.deepEqual(
      new Set(latest.map((record) => record.projectTicket)),
      new Set(tickets.slice(0, 4)),
    ),
  );
  assert.equal(await ingress.hold(), false);
});

test("a snapshot-length hold queues a save once and still bounds abandoned maintenance", async (t) => {
  const saved = [];
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    saved.push(body);
    res.end("saved");
  });
  const ingress = createIngress({ upstreamPort: await listen(backend) });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    vi.useRealTimers();
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  assert.equal(await ingress.hold(), true);
  const saving = request(port, "/api/projects", "once");
  while (!ingress.status().pending) await new Promise(setImmediate);
  await vi.advanceTimersByTimeAsync(45_000);
  assert.equal(ingress.status().pending, 1);
  assert.deepEqual(saved, []);
  ingress.resume();
  assert.deepEqual(await saving, { status: 200, body: "saved" });
  assert.deepEqual(saved, ["once"]);
  assert.equal(await ingress.hold(), true);
  const expired = request(port, "/api/projects", "not-sent");
  while (!ingress.status().pending) await new Promise(setImmediate);
  await vi.advanceTimersByTimeAsync(60_001);
  assert.equal((await expired).status, 503);
  assert.deepEqual(saved, ["once"]);
});

function request(port, path = "/", body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: body === undefined ? "GET" : "POST",
        agent: false,
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("a browser abandoning a read releases the upstream and permits maintenance", async (t) => {
  let received;
  const arrived = new Promise((resolve) => (received = resolve));
  const backend = http.createServer((req, res) => {
    req.resume();
    received(res);
  });
  const ingress = createIngress({ upstreamPort: await listen(backend) });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const client = http.get({ host: "127.0.0.1", port, agent: false });
  client.on("error", () => {});
  const response = await arrived;
  const closed = once(response, "close").then(() => true);
  client.destroy();
  assert.equal(
    await Promise.race([
      closed,
      new Promise((resolve) => setTimeout(() => resolve(false), 250)),
    ]),
    true,
  );
  assert.equal(await ingress.hold(), true);
  assert.equal(ingress.status().uncertain, false);
});

test("overload refuses a new write before forwarding it", async (t) => {
  const received = [];
  const backend = http.createServer((req, res) => {
    req.resume();
    received.push(res);
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    maxActive: 1,
    queueMs: 50,
  });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const saving = request(port, "/api/projects", "accepted-once");
  while (!received.length) await new Promise(setImmediate);
  const refused = request(port, "/api/projects", "not-forwarded");
  const result = await Promise.race([
    refused,
    new Promise((resolve) => setTimeout(() => resolve(null), 250)),
  ]);
  // Always finish pending replies, including the unfixed implementation's
  // second forwarded write, so a failed assertion leaves no hanging request.
  for (const reply of received) reply.end("saved");
  await saving;
  await refused;
  assert.equal(result?.status, 503);
  assert.equal(received.length, 1);
});

test("Gallery reads wait outside the runtime while login and saving can finish", async (t) => {
  const reads = [];
  const backend = http.createServer((req, res) => {
    req.resume();
    if (req.url.startsWith("/api/gallery")) reads.push(res);
    else res.end("completed");
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    maxActive: 4,
    reserved: 1,
    maxHeavy: 1,
  });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const first = request(port, "/api/gallery?source=community");
  while (!reads.length) await new Promise(setImmediate);
  const next = request(port, "/api/gallery-alias//?source=community&page=2");
  // Crossing the same HTTP entrance proves the second read was admitted.
  assert.equal((await request(port, "/api/auth/session")).status, 200);
  assert.equal(
    (await request(port, "/api/projects", "saved-once")).status,
    200,
  );
  assert.equal(reads.length, 1);
  reads[0].end("first");
  assert.equal((await first).body, "first");
  while (reads.length < 2) await new Promise(setImmediate);
  reads[1].end("second");
  assert.equal((await next).body, "second");
});

test("ordinary traffic cannot consume reserved save slots and canceled queued work is never forwarded", async (t) => {
  const ordinary = [];
  const backend = http.createServer((req, res) => {
    req.resume();
    if (req.url.startsWith("/api/agent/")) ordinary.push(res);
    else res.end("saved");
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    maxActive: 3,
    reserved: 1,
  });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const accepted = [
    request(port, "/api/agent/a"),
    request(port, "/api/agent/b"),
  ];
  while (ordinary.length < 2) await new Promise(setImmediate);
  const canceled = http.get({
    host: "127.0.0.1",
    port,
    path: "/api/agent/c",
    agent: false,
  });
  canceled.on("error", () => {});
  while (!ingress.status().pending) await new Promise(setImmediate);
  canceled.destroy();
  while (ingress.status().pending) await new Promise(setImmediate);
  assert.equal((await request(port, "/api/projects", "one-save")).status, 200);
  assert.equal(ordinary.length, 2);
  for (const reply of ordinary) reply.end("done");
  await Promise.all(accepted);
  assert.equal(await ingress.hold(), true);
  ingress.resume();
  assert.equal((await request(port, "/api/auth/me")).status, 200);
  assert.equal(ordinary.length, 2);
});

test("maintenance releases within capacity and ordinary work gets a turn among saves", async (t) => {
  const received = [];
  const backend = http.createServer((req, res) => {
    req.resume();
    received.push({ path: req.url, res });
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    maxActive: 1,
    reserved: 0,
  });
  const port = await listen(ingress.server);
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  assert.equal(await ingress.hold(), true);
  const paths = [
    "/api/gallery",
    "/api/projects/a",
    "/api/projects/b",
    "/api/projects/c",
    "/api/projects/d",
  ];
  const responses = [];
  for (const path of paths) {
    responses.push(
      request(port, path, path === "/api/gallery" ? undefined : "save"),
    );
    while (ingress.status().pending < responses.length)
      await new Promise(setImmediate);
  }
  ingress.resume();
  for (let index = 0; index < paths.length; index++) {
    while (received.length <= index) await new Promise(setImmediate);
    assert.equal(received.length, index + 1);
    received[index].res.end("done");
  }
  assert.deepEqual(
    received.map((item) => item.path),
    [
      "/api/projects/a",
      "/api/projects/b",
      "/api/projects/c",
      "/api/gallery",
      "/api/projects/d",
    ],
  );
  assert.equal(
    (await Promise.all(responses)).every((reply) => reply.status === 200),
    true,
  );
});

test("a busy save cancels handover and keeps the old backend serving", async (t) => {
  let finish;
  let started;
  const accepted = new Promise((resolve) => {
    started = resolve;
  });
  const backend = http.createServer((req, res) => {
    if (req.url === "/saving") {
      finish = () => res.end("saved");
      started();
    } else res.end("old version");
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    drainMs: 40,
  });
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const port = await listen(ingress.server);
  const saving = request(port, "/saving");
  await accepted;
  assert.equal(await ingress.hold(), false);
  assert.deepEqual(await request(port), { status: 200, body: "old version" });
  finish();
  assert.deepEqual(await saving, { status: 200, body: "saved" });
});

test("handover ends an idle event stream without waiting for its lifetime", async (t) => {
  const backend = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": connected\n\n");
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    drainMs: 40,
  });
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const port = await listen(ingress.server);
  const stream = await new Promise((resolve) =>
    http.get({ host: "127.0.0.1", port }, resolve),
  );
  stream.resume();
  const ended = once(stream, "end");
  assert.equal(await ingress.hold(), true);
  await ended;
  ingress.resume();
});

test("a lost Snapshot reply leaves maintenance available", async (t) => {
  const backend = http.createServer(async (req) => {
    for await (const chunk of req) void chunk;
    req.socket.destroy();
  });
  const ingress = createIngress({ upstreamPort: await listen(backend) });
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const reply = await request(
    await listen(ingress.server),
    "/api/agent/sessions/demo/circuit",
    JSON.stringify({
      apiVersion: "3.0",
      operation: "snapshot",
      requestId: "read-1",
      documentId: "doc",
    }),
  );
  assert.equal(reply.status, 502);
  assert.equal(ingress.status().uncertain, false);
  assert.equal(await ingress.hold(), true);
});

test("an interrupted malformed Snapshot stays fenced", async (t) => {
  const backend = http.createServer(async (req) => {
    for await (const chunk of req) void chunk;
    req.socket.destroy();
  });
  const ingress = createIngress({ upstreamPort: await listen(backend) });
  t.onTestFinished(async () => {
    await ingress.close();
    backend.close();
  });
  const reply = await request(
    await listen(ingress.server),
    "/api/agent/sessions/demo/circuit",
    JSON.stringify({
      apiVersion: "3.0",
      operation: "snapshot",
      requestId: "bad",
    }),
  );
  assert.equal(reply.status, 502);
  assert.equal(await ingress.hold(), false);
});

test("a lost reply never replays a write against another backend", async (t) => {
  let writes = 0;
  const backend = http.createServer(async (req) => {
    for await (const chunk of req) void chunk;
    writes++;
    req.socket.destroy();
  });
  const ingress = createIngress({ upstreamPort: await listen(backend) });
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const reply = await request(await listen(ingress.server), "/save", "once");
  assert.equal(reply.status, 502);
  assert.equal(writes, 1);
  assert.equal(await ingress.hold(), false);
});

test("only confirmed receipts for each exact interrupted Agent write release maintenance", async (t) => {
  let outcome = 502;
  let saved = [];
  const backend = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    if (outcome === 502) req.socket.destroy();
    else if (
      [403, 409].includes(outcome) &&
      req.headers["x-icm-agent-write-receipt"] === "request"
    )
      res.writeHead(outcome, { "x-icm-agent-write-receipt": "complete" }).end();
    else res.writeHead(outcome).end();
  });
  const upstreamPort = await listen(backend);
  let ingress = createIngress({
    upstreamPort,
    onUncertaintyChange: (records) => (saved = records),
  });
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  let port = await listen(ingress.server);
  const sessionId = "caca0001-1111-8111-8111-111111111111";
  const path = "/api/agent/sessions/" + sessionId + "/circuit";
  const edit = (requestId) =>
    JSON.stringify({
      apiVersion: "3.0",
      operation: "transact",
      requestId,
      documentId: "doc",
      transactionId: requestId,
      expectedRevision: 0,
      edits: [{ kind: "noop" }],
    });
  const first = edit("first");
  const second = edit("second");
  const auth = { authorization: "Bearer original-fixture" };
  const workspace = {
    ...auth,
    "x-agent-workspace": "target",
    "x-agent-context": "old",
  };
  assert.equal(
    (
      await request(
        port,
        "/api/agent/region/" + sessionId + "/circuit",
        first,
        auth,
      )
    ).status,
    502,
  );
  assert.equal((await request(port, path, second, workspace)).status, 502);
  assert.equal(await ingress.hold(), false);

  await ingress.close();
  ingress = createIngress({ upstreamPort, uncertaintyRecords: saved });
  port = await listen(ingress.server);
  assert.equal(await ingress.hold(), false);
  outcome = 200;
  await request(port, path, first, {
    ...auth,
    "x-icm-agent-write-receipt": "complete",
  });
  assert.equal(await ingress.hold(), false);
  outcome = 409;
  await request(port, path, first, { ...auth, "x-agent-workspace": "other" });
  await request(port, path, first, { ...auth, "x-agent-context": "other" });
  assert.equal(await ingress.hold(), false);
  await request(port, path, first, { authorization: "Bearer resumed-fixture" });
  assert.equal(await ingress.hold(), false);
  outcome = 403;
  await request(port, path, second, { ...workspace, "x-agent-context": "new" });
  assert.equal(await ingress.hold(), true);
});

test.skipIf(process.platform === "win32")(
  "an operation-aware maintenance hold survives an entrance restart and refuses a legacy runner",
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "canvas-operation-hold-"));
    const options = {
      port: 0,
      release: root,
      controlPath: join(root, "control.sock"),
      uncertaintyPath: join(root, "uncertain-write"),
    };
    let runtime = await serveIngress(options);
    t.onTestFinished(async () => {
      await runtime.stop();
      await rm(root, { recursive: true, force: true });
    });
    const control = (path) =>
      new Promise((resolve, reject) => {
        const check = http.request(
          {
            socketPath: options.controlPath,
            path,
            method: path === "/status" ? "GET" : "POST",
          },
          async (reply) => {
            let body = "";
            for await (const chunk of reply) body += chunk;
            resolve({ code: reply.statusCode, body });
          },
        );
        check.on("error", reject);
        check.end();
      });
    await writeFile(join(root, "release.json"), '{"files":[]}');
    assert.equal((await control("/hold")).code, 409);
    await writeFile(
      join(root, "release.json"),
      '{"files":{"project-create-operation-format.json":"declared"}}',
    );
    assert.equal((await control("/hold")).code, 409);
    assert.equal((await control("/hold-project-operations/1")).code, 200);
    const digest = "a".repeat(64);
    assert.equal(
      (await control("/seal-project-operations/" + digest)).code,
      200,
    );
    assert.equal(
      (await control("/seal-project-operations/" + "b".repeat(64))).code,
      409,
    );
    await runtime.stop();
    runtime = await serveIngress(options);
    const status = JSON.parse((await control("/status")).body);
    assert.equal(status.holding, true);
    assert.equal(status.operationReader, 1);
    assert.equal(status.operationInventory, digest);
    assert.equal((await control("/hold-project-operations/0")).code, 409);
    assert.equal((await control("/resume")).code, 409);
    assert.equal((await control("/resume-project-operations")).code, 200);
    assert.equal(JSON.parse((await control("/status")).body).holding, false);
    assert.equal(
      JSON.parse((await control("/status")).body).operationInventory,
      null,
    );
  },
);

test.skipIf(process.platform === "win32")(
  "the control socket preserves a failed journal write across an ingress restart",
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "canvas-ingress-"));
    const uncertaintyPath = join(root, "uncertain-write");
    const controlPath = join(root, "control.sock");
    const backend = http.createServer(async (req) => {
      for await (const chunk of req) void chunk;
      req.socket.destroy();
    });
    await writeFile(join(root, "release.json"), '{"files":{}}');
    const options = {
      release: root,
      upstreamPort: await listen(backend),
      port: 0,
      controlPath,
      uncertaintyPath,
    };
    let runtime;
    t.onTestFinished(async () => {
      await runtime?.stop();
      backend.close();
      await rm(root, { recursive: true, force: true });
    });
    const hold = () =>
      new Promise((resolve, reject) => {
        const check = http.request(
          { socketPath: controlPath, path: "/hold", method: "POST" },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        check.on("error", reject);
        check.end();
      });
    runtime = await serveIngress(options);
    assert.equal(await hold(), 200);
    await runtime.stop();

    runtime = await serveIngress(options);
    const port = runtime.ingress.server.address().port;
    // Fail before an uncertainty record can be written. Remove the failure
    // before restart so only the running guard can preserve the fence.
    await mkdir(uncertaintyPath + ".next");
    assert.equal((await request(port, "/save", "once")).status, 502);
    await rm(uncertaintyPath + ".next", { recursive: true });
    assert.equal(await hold(), 409);
    await runtime.stop();

    runtime = await serveIngress(options);
    assert.equal(await hold(), 409);
  },
);

test("disconnecting a client does not cancel an accepted save or permit a handover", async (t) => {
  let accepted, finish;
  const started = new Promise((resolve) => {
    accepted = resolve;
  });
  const backend = http.createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    finish = () => res.end("saved");
    accepted();
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    drainMs: 40,
  });
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const port = await listen(ingress.server);
  const client = http.request({ host: "127.0.0.1", port, method: "POST" });
  client.on("error", () => {});
  client.end("save");
  await started;
  client.destroy();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await ingress.hold(), false);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await ingress.hold(), true);
});

test("editor WebSockets reconnect to the same entrance after handover", async (t) => {
  const sockets = new Set();
  const backend = http.createServer();
  backend.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const accept = createHash("sha1")
      .update(
        req.headers["sec-websocket-key"] +
          "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      )
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
  });
  const ingress = createIngress({
    upstreamPort: await listen(backend),
    drainMs: 40,
  });
  t.onTestFinished(async () => {
    await ingress.close();
    for (const socket of sockets) socket.destroy();
    backend.close();
  });
  const port = await listen(ingress.server);
  const first = new WebSocket(`ws://127.0.0.1:${port}/editor-socket`);
  await once(first, "open");
  const closed = once(first, "close");
  assert.equal(await ingress.hold(), true);
  await closed;
  const second = new WebSocket(`ws://127.0.0.1:${port}/editor-socket`);
  const opened = once(second, "open");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(second.readyState, WebSocket.CONNECTING);
  ingress.resume();
  await opened;
});
