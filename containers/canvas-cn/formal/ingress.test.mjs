import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { test, vi } from "vitest";
import { createHash } from "node:crypto";
import { createIngress } from "./ingress.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

test("a snapshot-length hold queues a save once and still bounds abandoned maintenance", async (t) => {
  let writes = 0;
  const backend = http.createServer((req, res) => {
    req.resume();
    writes++;
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
  assert.equal(writes, 0);
  ingress.resume();
  assert.deepEqual(await saving, { status: 200, body: "saved" });
  assert.equal(writes, 1);
  assert.equal(await ingress.hold(), true);
  const expired = request(port, "/api/projects", "not-sent");
  while (!ingress.status().pending) await new Promise(setImmediate);
  await vi.advanceTimersByTimeAsync(60_001);
  assert.equal((await expired).status, 503);
  assert.equal(writes, 1);
});

function request(port, path = "/", body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: body === undefined ? "GET" : "POST",
        agent: false,
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

test("a save arriving during handover reaches the domestic backend once after resume", async (t) => {
  const saved = [];
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    saved.push(body);
    res.end("saved domestically");
  });
  const port = await listen(backend);
  const ingress = createIngress({ upstreamPort: port });
  t.onTestFinished(async () => {
    await ingress.close();
    backend.closeAllConnections();
    backend.close();
  });
  const publicPort = await listen(ingress.server);
  assert.equal(await ingress.hold(), true);
  const response = request(publicPort, "/api/projects", "draft-1");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(saved, []);
  ingress.resume();
  assert.deepEqual(await response, { status: 200, body: "saved domestically" });
  assert.deepEqual(saved, ["draft-1"]);
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
