import { createServer, request } from "node:http";
import { expect, it } from "vitest";
import { localSimulation } from "./local-simulation.js";

it("serves the existing unconfigured protocol and protects the loopback development endpoint", async () => {
  let middleware: any;
  const plugin = localSimulation();
  (plugin.configureServer as Function)({
    middlewares: {
      use(fn: any) {
        middleware = fn;
      },
    },
  });
  const server = createServer((req, res) =>
    middleware(req, res, () => res.writeHead(404).end()),
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const post = (body: string, headers = {}) =>
    fetch(base + "/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  try {
    const caps = await post('{"operation":"capabilities"}');
    expect(caps.status).toBe(200);
    expect(await caps.json()).toMatchObject({
      configured: false,
      profiles: [],
    });
    expect((await post("{}")).status).toBe(503);
    expect((await post("{")).status).toBe(400);
    expect(
      (await post("{}", { origin: "https://attacker.invalid" })).status,
    ).toBe(403);
    const badHost = await new Promise<number | undefined>((done, reject) => {
      const req = request(
        base + "/api/simulate",
        {
          method: "POST",
          headers: {
            host: "attacker.invalid",
            "content-type": "application/json",
          },
        },
        (res) => {
          res.resume();
          done(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    expect(badHost).toBe(403);
    expect((await post("{}", { "content-type": "text/plain" })).status).toBe(
      415,
    );
    expect((await fetch(base + "/api/simulate")).status).toBe(405);
    expect((await fetch(base + "/unrelated")).status).toBe(404);
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});

it("uses only explicit loopback executors, never an implicit hosted fallback", () => {
  expect(() => localSimulation("https://example.com")).toThrow(/loopback/);
  expect(() => localSimulation("http://127.0.0.1:9000")).not.toThrow();
});

it("forwards configured native requests through the existing adapter without rewriting or retrying", async () => {
  const seen: string[] = [];
  const executor = createServer(async (req, res) => {
    expect(req.url).toBe("/api/simulate");
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push(body);
    res.writeHead(429, {
      "content-type": "application/json",
      "retry-after": "2",
    });
    res.end('{"error":"busy"}');
  });
  await new Promise<void>((done) => executor.listen(0, "127.0.0.1", done));
  const address = executor.address() as { port: number };
  let middleware: any;
  const plugin = localSimulation(`http://127.0.0.1:${address.port}`);
  (plugin.configureServer as Function)({
    middlewares: {
      use(fn: any) {
        middleware = fn;
      },
    },
  });
  const server = createServer((req, res) =>
    middleware(req, res, () => res.writeHead(404).end()),
  );
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;
    const body = '{ "language": "vacask", "preparedDeck": "Native test" }';
    const response = await fetch(`http://127.0.0.1:${port}/api/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toEqual({ error: "busy" });
    expect(seen).toEqual([body]);
  } finally {
    await Promise.all(
      [server, executor].map(
        (s) =>
          new Promise<void>((done, reject) =>
            s.close((error) => (error ? reject(error) : done())),
          ),
      ),
    );
  }
});
