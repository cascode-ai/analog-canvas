import { afterEach, describe, expect, it, vi } from "vitest";
import {
  routeVacaskSimulationRequest as routeSimulationRequest,
  type SimulationEnv,
} from "./simulation-vacask";
import {
  nativeCapabilities,
  nativeEnvironment,
  nativeHealth,
  nativeInput,
  nativeReply,
  nativeWorkerEnv,
  nativeStreamingReply,
} from "./simulation.test-fixture";
const post = (body: unknown, path = "/api/simulate") =>
  new Request(`https://canvas.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
afterEach(() => vi.unstubAllGlobals());

describe("native simulation route", () => {
  it("rejects a streaming receipt bound to another run before exposing bytes", async () => {
    const input = {
      ...nativeInput(),
      runToken: "11111111-1111-1111-1111-111111111111",
    };
    const env = nativeWorkerEnv(async (_url, init) =>
      nativeStreamingReply({
        ...JSON.parse(String(init?.body)),
        runToken: "22222222-2222-2222-2222-222222222222",
      }),
    );
    const response = await routeSimulationRequest(post(input), env);
    expect(response!.status).toBe(502);
    expect(await response!.json()).toMatchObject({
      error: "simulator-protocol-invalid",
    });
  });
  it("keeps absence unconfigured, ignores other paths and rejects malformed operations", async () => {
    expect(await routeSimulationRequest(post({}, "/elsewhere"), {})).toBeNull();
    expect(
      (await routeSimulationRequest(
        new Request("https://canvas.test/api/simulate"),
        {},
      ))!.status,
    ).toBe(405);
    expect(
      await (await routeSimulationRequest(
        post({ operation: "capabilities" }),
        {},
      ))!.json(),
    ).toMatchObject({ configured: false, profiles: [] });
    expect(
      (await routeSimulationRequest(post(nativeInput()), {}))!.status,
    ).toBe(503);
    for (const value of [
      null,
      [],
      { operation: "unknown" },
      { executorTarget: "unknown" },
      { runToken: "bad" },
    ])
      expect(
        (await routeSimulationRequest(post(value), nativeWorkerEnv()))!.status,
      ).toBe(400);
    expect(
      (await routeSimulationRequest(
        new Request("https://canvas.test/api/simulate", {
          method: "POST",
          body: "{",
        }),
        {},
      ))!.status,
    ).toBe(400);
  });
  it("advertises only the configured native runtime's measured capability", async () => {
    expect(
      await (await routeSimulationRequest(
        post({ operation: "capabilities" }),
        nativeWorkerEnv(),
      ))!.json(),
    ).toEqual(nativeCapabilities);
    const env = nativeWorkerEnv();
    delete env.SIMULATION_PROFILE_ID;
    expect(
      await (await routeSimulationRequest(
        post({ operation: "capabilities" }),
        env,
      ))!.json(),
    ).toMatchObject({ configured: false });
  });
  it("keys the container generation by the accepted Profile", async () => {
    const env = nativeWorkerEnv();
    const get = vi.fn(env.VACASK!.getByName);
    env.VACASK = { getByName: get };
    await routeSimulationRequest(post({ operation: "capabilities" }), env);
    expect(get).toHaveBeenCalledWith(`profile:${nativeEnvironment.profileId}`);
    env.SIMULATION_PROFILE_ID = "new-profile";
    expect(
      await (await routeSimulationRequest(
        post({ operation: "capabilities" }),
        env,
      ))!.json(),
    ).toMatchObject({ configured: false });
    expect(get).toHaveBeenLastCalledWith("profile:new-profile");
  });
  it.each([
    "legacy-engine",
    "identity-drift",
    "legacy-collection",
    "observed",
    "missing",
  ])("refuses %s health without execution", async (change) => {
    const health = structuredClone(nativeHealth);
    if (change === "legacy-engine")
      Object.assign(health.environment.simulator, { name: "ngspice" });
    if (change === "identity-drift")
      health.environment.fingerprint = "f".repeat(64);
    if (change === "legacy-collection")
      health.capabilities.rawfileCollection = "declared-single-ascii";
    if (change === "observed") health.environment.reproducibility = "observed";
    const fetch = vi.fn(async () =>
      Response.json(change === "missing" ? {} : health),
    );
    const response = await routeSimulationRequest(post(nativeInput()), {
      SIMULATION_PROFILE_ID: nativeEnvironment.profileId!,
      VACASK: { getByName: () => ({ fetch }) },
    });
    expect(response!.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toBeDefined();
  });
  it("forwards exact native files/dependencies and never composes a model directive", async () => {
    const input = nativeInput();
    input.dependencies = [
      { id: "models", sha256: "d".repeat(64), mountPath: "models" },
    ];
    input.files.push({ path: "parts.inc", text: "Native authored bytes\n" });
    const run = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json(await nativeReply(JSON.parse(String(init?.body)))),
    );
    const response = await routeSimulationRequest(
      post({ ...input, runToken: crypto.randomUUID(), timeoutMs: 900000 }),
      nativeWorkerEnv(run),
    );
    expect(response!.status).toBe(200);
    const sent = JSON.parse(String(run.mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({ ...input, timeoutMs: 120000 });
    expect(sent).not.toHaveProperty("deck");
    const result = await response!.json();
    expect(result.executedFiles).toEqual(input.files);
    expect(result.metadata.input.inputRevision).toBe(input.inputRevision);
    expect(result.metadata.environment).toEqual(nativeEnvironment);
    expect(result).not.toHaveProperty("executedDeck");
    expect(result).not.toHaveProperty("rawfile");
  });
  it.each([
    ["language", undefined],
    ["mode", "structured"],
    ["preparedDeck", "changed"],
    ["testbench", "changed"],
    ["netlist", "other"],
    ["inputRevision", undefined],
    ["collection", { rawfile: "out.raw" }],
    ["entryPath", "../outside"],
    ["environment", { profileId: "other" }],
    ["environment", { profileId: "native-test-v1", corner: "bad" }],
    ["files", [{ path: "/outside", text: "x" }]],
    [
      "dependencies",
      [{ id: "models", sha256: "a".repeat(64), mountPath: "models" }],
    ],
  ])("rejects incompatible %s before Run", async (field, value) => {
    const run = vi.fn();
    const response = await routeSimulationRequest(
      post({ ...nativeInput(), [field as string]: value }),
      nativeWorkerEnv(run),
    );
    expect([400, 409]).toContain(response!.status);
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects file collisions and excessive UTF-8 input without starting", async () => {
    const input = nativeInput();
    const run = vi.fn();
    for (const path of ["run.sim", "run.sim/child"])
      expect(
        (await routeSimulationRequest(
          post({ ...input, files: [...input.files, { path, text: "" }] }),
          nativeWorkerEnv(run),
        ))!.status,
      ).toBe(400);
    input.files.push({ path: "large", text: "界".repeat(400000) });
    expect(
      (await routeSimulationRequest(post(input), nativeWorkerEnv(run)))!.status,
    ).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });
  it.each(["completed", "failed", "timed-out", "completed-with-dropped-input"])(
    "preserves the shared harness %s verdict",
    async (status) => {
      const reply = await nativeReply();
      Object.assign(reply.outcome, {
        status,
        ...(status === "timed-out" ? { timeoutMs: 100 } : {}),
      });
      const response = await routeSimulationRequest(
        post(nativeInput()),
        nativeWorkerEnv(async () => Response.json(reply)),
      );
      expect(response!.status).toBe(200);
      expect((await response!.json()).outcome.status).toBe(status);
    },
  );
  it("preserves collector partial status independently of a successful process", async () => {
    const response = await routeSimulationRequest(
      post(nativeInput()),
      nativeWorkerEnv(async () =>
        Response.json({
          ...(await nativeReply()),
          collectionStatus: "partial",
        }),
      ),
    );
    expect(response!.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      outcome: { status: "completed" },
      collectionStatus: "partial",
    });
  });
  it.each(["environment", "input", "files", "legacy-result", "malformed"])(
    "withholds invalid %s result evidence without retry",
    async (fault) => {
      const reply = await nativeReply();
      if (fault === "environment")
        reply.metadata.environment = {
          ...reply.metadata.environment,
          fingerprint: "e".repeat(64),
        };
      if (fault === "input") reply.metadata.input.deckSha256 = "e".repeat(64);
      if (fault === "files")
        reply.executedFiles = [{ path: "run.sim", text: "different" }];
      if (fault === "legacy-result")
        Object.assign(reply, { rawfile: "legacy", rawfiles: undefined });
      const run = vi.fn(async () =>
        fault === "malformed" ? new Response("not JSON") : Response.json(reply),
      );
      const response = await routeSimulationRequest(
        post(nativeInput()),
        nativeWorkerEnv(run),
      );
      expect(response!.status).toBe(502);
      expect(await response!.json()).toMatchObject({
        error: "simulator-protocol-invalid",
      });
      expect(run).toHaveBeenCalledOnce();
    },
  );
  it("forwards prelaunch cancellation without requiring healthy runtime and refuses false acknowledgements", async () => {
    const calls: string[] = [];
    const env = nativeWorkerEnv();
    env.VACASK = {
      getByName: () => ({
        fetch: async (url) => {
          calls.push(url);
          return Response.json({ accepted: true });
        },
      }),
    };
    expect(
      (await routeSimulationRequest(
        post({ operation: "cancel", runToken: "bad" }),
        env,
      ))!.status,
    ).toBe(400);
    expect(calls).toEqual([]);
    expect(
      await (await routeSimulationRequest(
        post({ operation: "cancel", runToken: crypto.randomUUID() }),
        env,
      ))!.json(),
    ).toEqual({ accepted: true });
    expect(calls).toEqual(["http://container/cancel"]);
    env.VACASK = {
      getByName: () => ({
        fetch: async () => Response.json({ accepted: false }),
      }),
    };
    expect(
      (await routeSimulationRequest(
        post({ operation: "cancel", runToken: crypto.randomUUID() }),
        env,
      ))!.status,
    ).toBe(502);
  });
  it.each([
    [
      503,
      '{"error":"simulator-busy","message":"one run at a time"}',
      "simulator-busy",
    ],
    [
      500,
      '{"error":"run-directory-unavailable","message":"EACCES"}',
      "run-directory-unavailable",
    ],
    [502, "upstream connect error", undefined],
    [500, "", undefined],
  ])(
    "retains bounded refusal details for status %s",
    async (status, body, reason) => {
      const response = await routeSimulationRequest(
        post(nativeInput()),
        nativeWorkerEnv(
          async () =>
            new Response(body as string, {
              status: status as number,
              headers: { "retry-after": "2" },
            }),
        ),
      );
      expect(response!.status).toBe(502);
      expect(response!.headers.get("retry-after")).toBe("2");
      const result = await response!.json();
      expect(result.error).toBe("simulator-refused");
      expect(result.reason).toBe(reason);
    },
  );
  it("clips refusal payloads and bounds their stream instead of retaining unbounded text", async () => {
    const response = await routeSimulationRequest(
      post(nativeInput()),
      nativeWorkerEnv(async () =>
        Response.json({ error: "x".repeat(5000) }, { status: 500 }),
      ),
    );
    expect((await response!.json()).reason.length).toBeLessThanOrEqual(401);
    const cancelled = vi.fn();
    const large = await routeSimulationRequest(
      post(nativeInput()),
      nativeWorkerEnv(
        async () =>
          new Response(
            new ReadableStream({
              pull(c) {
                c.enqueue(new Uint8Array(17000));
              },
              cancel: cancelled,
            }),
            { status: 500 },
          ),
      ),
    );
    expect(large!.status).toBe(502);
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it.each(["operator-host", "cloudflare-container"])(
    "honors explicit %s selection without probing or falling back to the other executor",
    async (target) => {
      const env: SimulationEnv = {
        ...nativeWorkerEnv(),
        SIMULATION_UPSTREAM_URL: "https://native.example",
        SIMULATION_UPSTREAM_TOKEN: "operator-token",
        SIMULATION_DEFAULT_EXECUTOR:
          target === "operator-host" ? "cloudflare-container" : "operator-host",
      };
      const remote = vi.fn(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          expect(target).toBe("operator-host");
          expect(new Headers(init?.headers).get("authorization")).toBe(
            "Bearer operator-token",
          );
          expect(init?.redirect).toBe("manual");
          if (new URL(String(url)).pathname === "/run")
            expect(
              new Headers(init?.headers).get("x-analog-execution-transfer"),
            ).toBe("receipt-v1");
          return new URL(String(url)).pathname === "/health"
            ? Response.json(nativeHealth)
            : Response.json(await nativeReply());
        },
      );
      vi.stubGlobal("fetch", remote);
      if (target === "operator-host")
        env.VACASK = {
          getByName: () => {
            throw new Error("must remain asleep");
          },
        };
      const response = await routeSimulationRequest(
        post({ ...nativeInput(), executorTarget: target }),
        env,
      );
      expect(response!.status).toBe(200);
      expect((await response!.json()).execution.target).toBe(target);
      expect(remote).toHaveBeenCalledTimes(target === "operator-host" ? 2 : 0);
    },
  );
  it("distinguishes pre-dispatch unavailability, credentials and uncertain execution", async () => {
    const env = nativeWorkerEnv();
    env.SIMULATION_DEFAULT_EXECUTOR = "invalid";
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(503);
    delete env.SIMULATION_DEFAULT_EXECUTOR;
    expect(
      (await routeSimulationRequest(
        post({ ...nativeInput(), executorTarget: "operator-host" }),
        env,
      ))!.status,
    ).toBe(503);
    const response = await routeSimulationRequest(
      post(nativeInput()),
      nativeWorkerEnv(async () => {
        throw new Error("lost execution reply");
      }),
    );
    expect(await response!.json()).toMatchObject({
      error: "simulator-unreachable",
    });
    env.VACASK = {
      getByName: () => ({
        fetch: async () => {
          throw new Error("health offline");
        },
      }),
    };
    expect(
      await (await routeSimulationRequest(post(nativeInput()), env))!.json(),
    ).toMatchObject({ error: "simulation-executor-unavailable" });
    env.VACASK = {
      getByName: () => ({
        fetch: async () => new Response("denied", { status: 401 }),
      }),
    };
    expect(
      await (await routeSimulationRequest(post(nativeInput()), env))!.json(),
    ).toMatchObject({ error: "simulator-unauthorized" });
  });
});
