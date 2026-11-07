import { afterEach, expect, it, vi } from "vitest";
import egress from "./egress.mjs";

afterEach(() => vi.unstubAllGlobals());
const base = {
  PEER_ORIGIN: "https://peer.test",
  IDENTITY_URL: "https://auth.test/api/auth/regional/identities",
};

it.each([
  ["ngspice", "NGSPICE_OPERATOR"],
  ["vacask", "VACASK_OPERATOR"],
])(
  "sends %s execution only through its private operator binding",
  async (name, binding) => {
    const internet = vi.fn(() => {
      throw Error("Unexpected public network use");
    });
    vi.stubGlobal("fetch", internet);
    const privateHop = vi.fn(async (request) => {
      expect(request.url).toBe(`https://${name}.canvas-operator.invalid/run`);
      expect(request.redirect).toBe("manual");
      expect(request.headers.get("authorization")).toBe(
        "Bearer dedicated-test-token",
      );
      expect(await request.text()).toBe('{"runToken":"isolated"}');
      return new Response("bounded-result", {
        headers: { "X-Execution-Receipt": "test-receipt" },
      });
    });
    const result = await egress.fetch(
      new Request(`https://${name}.canvas-operator.invalid/run`, {
        method: "POST",
        headers: { Authorization: "Bearer dedicated-test-token" },
        body: '{"runToken":"isolated"}',
      }),
      { ...base, [binding]: { fetch: privateHop } },
    );
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("bounded-result");
    expect(result.headers.get("X-Execution-Receipt")).toBe("test-receipt");
    expect(privateHop).toHaveBeenCalledTimes(1);
    expect(internet).not.toHaveBeenCalled();
  },
);

it.each([
  ["GET", "/run"],
  ["POST", "/health"],
  ["GET", "/health?target=elsewhere"],
  ["POST", "/run/"],
  ["POST", "/admin"],
])(
  "rejects operator requests outside the fixed method/path policy: %s %s",
  async (method, path) => {
    const hop = vi.fn();
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    expect(
      (
        await egress.fetch(
          new Request("https://ngspice.canvas-operator.invalid" + path, {
            method,
          }),
          { ...base, NGSPICE_OPERATOR: { fetch: hop } },
        )
      ).status,
    ).toBe(403);
    expect(hop).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  },
);

it("fails closed on a missing operator or redirect without retrying elsewhere", async () => {
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  const request = new Request("https://vacask.canvas-operator.invalid/health");
  expect((await egress.fetch(request, base)).status).toBe(503);
  const hop = vi.fn(
    async () =>
      new Response(null, {
        status: 307,
        headers: { Location: "https://other.test/run" },
      }),
  );
  const response = await egress.fetch(request, {
    ...base,
    VACASK_OPERATOR: { fetch: hop },
  });
  expect(response.status).toBe(502);
  expect(response.headers.has("location")).toBe(false);
  expect(hop).toHaveBeenCalledTimes(1);
  expect(network).not.toHaveBeenCalled();
});

it.each([
  ["GET", "/health", 10000],
  ["POST", "/run", 150000],
  ["POST", "/cancel", 10000],
])("bounds %s %s while allowing the executor lifecycle", async (method, path, timeout) => {
  const timer = vi.spyOn(AbortSignal, "timeout");
  try {
    const response = await egress.fetch(
      new Request("https://ngspice.canvas-operator.invalid" + path, { method }),
      { ...base, NGSPICE_OPERATOR: { fetch: async () => new Response("ok") } },
    );
    expect(response.status).toBe(200);
    expect(timer).toHaveBeenCalledWith(timeout);
  } finally {
    timer.mockRestore();
  }
});
