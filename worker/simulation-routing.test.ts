import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  routeSimulationRequest,
  refuseSignedOutSimulation,
  type SimulationEnv,
} from "./simulation";
import ngspiceProfile from "../containers/ngspice/hosted-sky130-profile.json";
import { CAPABILITIES_ACCEPT_CELL_LIBRARIES } from "@icm/simulation-service";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";
import {
  nativeCapabilities,
  nativeEnvironment,
  nativeHealth,
  nativeInput,
  nativeReply,
} from "./simulation.test-fixture";

const post = (body: unknown) =>
  new Request("https://canvas.test/api/simulate", {
    method: "POST",
    body: JSON.stringify(body),
  });
const env: SimulationEnv = {
  SIMULATION_UPSTREAM_URL: "https://ngspice.test",
  SIMULATION_UPSTREAM_TOKEN: "ngspice-test-only",
  SIMULATION_DEFAULT_EXECUTOR: "operator-host",
  VACASK_PROFILE_ID: nativeEnvironment.profileId!,
  VACASK_UPSTREAM_URL: "https://vacask.test",
  VACASK_UPSTREAM_TOKEN: "vacask-test-only",
};
// Each mock represents a separate deployment. Do not reuse an earlier mock's
// successful runtime facts when replacing its transport with an outage fixture.
beforeEach(() => {
  env.VACASK_UPSTREAM_TOKEN = `vacask-test-only-${crypto.randomUUID()}`;
});
afterEach(() => vi.unstubAllGlobals());
describe("dual-engine Profile routing", () => {
  it("discovers both Profiles but returns the selected engine's collection and limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(nativeHealth)),
    );
    const all = (await (await routeSimulationRequest(
      post({ operation: "capabilities" }),
      env,
    ))!.json()) as any;
    expect(all.profiles.map((p: { id: string }) => p.id)).toEqual([
      ngspiceProfile.id,
      nativeEnvironment.profileId,
    ]);
    expect(all.profiles.map((p: { engine: string }) => p.engine)).toEqual([
      "ngspice",
      "vacask",
    ]);
    for (const [profileId, collection] of [
      [ngspiceProfile.id, "declared-single-ascii"],
      [nativeEnvironment.profileId, "native-multi-ascii"],
    ]) {
      const caps = (await (await routeSimulationRequest(
        post({ operation: "capabilities", environment: { profileId } }),
        env,
      ))!.json()) as any;
      expect(caps.rawfileCollection).toBe(collection);
      expect(caps.profiles.map((p: { id: string }) => p.id)).toEqual([
        profileId,
      ]);
    }
  });
  it("runs VACASK only at its own origin with its own credential", async () => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.origin).toBe("https://vacask.test");
      expect(init.redirect).toBe("manual");
      expect(new Headers(init.headers).get("authorization")).toBe(
        `Bearer ${env.VACASK_UPSTREAM_TOKEN}`,
      );
      return Response.json(
        url.pathname === "/health" ? nativeHealth : await nativeReply(),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(200);
    expect(fetcher.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/health",
      "/run",
      "/run",
    ]);
  });
  it("routes cancellation by the captured Profile, without checking health or broadcasting", async () => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.pathname).toBe("/cancel");
      expect(new Headers(init.headers).get("authorization")).toBe(
        url.hostname === "vacask.test"
          ? `Bearer ${env.VACASK_UPSTREAM_TOKEN}`
          : "Bearer ngspice-test-only",
      );
      return Response.json({ cancelled: true });
    });
    vi.stubGlobal("fetch", fetcher);
    for (const profileId of [ngspiceProfile.id, nativeEnvironment.profileId])
      await routeSimulationRequest(
        post({
          operation: "cancel",
          runToken: "11111111-1111-4111-8111-111111111111",
          environment: { profileId },
        }),
        env,
      );
    expect(fetcher.mock.calls.map(([url]) => url.hostname)).toEqual([
      "ngspice.test",
      "vacask.test",
    ]);
    expect(
      (await routeSimulationRequest(post({ operation: "cancel" }), env))!
        .status,
    ).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not route unknown Profiles or VACASK input to ngspice", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const profileId of ["unknown", ngspiceProfile.id])
      expect(
        (await routeSimulationRequest(
          post({ ...nativeInput(), environment: { profileId } }),
          env,
        ))!.status,
      ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("native outage does not rerun the input on ngspice", async () => {
    const fetcher = vi.fn(async (url: URL) => {
      expect(url.hostname).toBe("vacask.test");
      return new Response("offline", { status: 503 });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not follow a native gateway redirect or forward its credential elsewhere", async () => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "https://unrelated.test/health" },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await routeSimulationRequest(post(nativeInput()), env))!.status,
    ).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("environment names (#1679)", () => {
  const id = "vacask-sky130-candidate";
  // The accepted VACASK Profile's host, measured running `version`.
  const host = async (version: string, label?: string) => ({
    ...nativeHealth,
    environment: await createSimulationEnvironmentMetadata({
      executor: "hosted-container",
      reproducibility: "pinned",
      profileId: id,
      platform: "linux/x64",
      simulator: { name: "vacask", version, binarySha256: "a".repeat(64) },
      models: { id: "test-modules", contentSha256: "b".repeat(64) },
      startupSha256: "c".repeat(64),
    }),
    capabilities: {
      ...nativeCapabilities,
      profiles: [
        {
          ...nativeCapabilities.profiles[0]!,
          id,
          ...(label ? { label } : {}),
        },
      ],
    },
  });
  const production: SimulationEnv = { ...env, VACASK_PROFILE_ID: id };
  const labels = async (
    body: unknown,
    health: unknown,
    routed = production,
  ) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(health)),
    );
    const caps = (await (await routeSimulationRequest(
      post(body),
      routed,
    ))!.json()) as { profiles: { id: string; label?: string }[] };
    return caps.profiles.map(({ id, label }) => ({ id, label }));
  };
  const named = async (health: unknown) =>
    (
      await labels(
        { operation: "capabilities", environment: { profileId: id } },
        health,
      )
    )[0]?.label;

  it("names the accepted VACASK Profile by the release its host runs, and keeps its id", async () => {
    expect(
      await labels(
        { operation: "capabilities" },
        await host("0.3.4-icm-hard-switch2"),
      ),
    ).toEqual([
      { id: ngspiceProfile.id, label: "SKY130 qualified devices · ngspice 46" },
      { id, label: "SKY130 · VACASK 0.3.4 (preview)" },
    ]);
    expect(await named(await host("0.3.4-icm-hard-switch2"))).toBe(
      "SKY130 · VACASK 0.3.4 (preview)",
    );
    // A host that moved to another build under the same id says so.
    expect(await named(await host("0.4.0"))).toBe(
      "SKY130 · VACASK 0.4.0 (preview)",
    );
  });

  it("leaves the id when the host's release cannot be read", async () => {
    expect(await named(await host("nightly"))).toBeUndefined();
    expect(await named(await host("0.3"))).toBeUndefined();
  });

  it("keeps a name the host declares", async () => {
    expect(await named(await host("0.3.4", "Host-declared name"))).toBe(
      "Host-declared name",
    );
  });

  it("gives no other VACASK Profile that name", async () => {
    expect(
      (await labels({ operation: "capabilities" }, nativeHealth, env))[1],
    ).toEqual({ id: nativeEnvironment.profileId, label: undefined });
  });
});

describe("the hosted SKY130 standard cells (#1596)", () => {
  const raw = (dependencies: unknown) => ({
    mode: "raw",
    netlist: "",
    testbench: '* cells\n.include "cells.spice"\n.end\n',
    inputRevision: "cells",
    environment: { profileId: ngspiceProfile.id },
    entryPath: "run.cir",
    files: [],
    dependencies,
  });

  const hd = {
    id: "sky130_fd_sc_hd",
    sha256: "6dec6626decd1ee15afacafab9925b1a336ab344b7b5e1bec9d7483f2a6badc3",
  };
  const models = {
    id: "sky130A-continuous",
    sha256: ngspiceProfile.models.contentSha256,
  };
  /** A simulator host whose /health lists these measured libraries. */
  const host = (dependencies?: unknown[]) => {
    const fetcher = vi.fn(async (url: URL, _init: RequestInit) =>
      url.pathname === "/health"
        ? Response.json({
            status: "ready",
            limits: { outputBytes: 1024 },
            ...(dependencies ? { dependencies } : {}),
          })
        : Response.json({ error: "simulator-busy" }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  };
  const ngspiceCaps = async (accepts?: string[]) =>
    (
      (await (await routeSimulationRequest(
        post({
          operation: "capabilities",
          ...(accepts ? { accepts } : {}),
          environment: { profileId: ngspiceProfile.id },
        }),
        env,
      ))!.json()) as any
    ).profiles[0];

  it("keeps the shape an earlier client parses: one model library and no cells", async () => {
    host([models, hd]);
    const profile = await ngspiceCaps();
    // An editor tab loaded before #1596 parses capabilities strictly, and
    // its Prepare needs exactly one Profile library for every SKY130 run.
    expect(profile).not.toHaveProperty("cellLibraries");
    expect(profile.dependencies).toEqual([models]);
    expect(profile.devices).toContain("sky130_fd_pr__pfet_01v8_hvt");
  });

  it("offers the cell library only once the running simulator measured it", async () => {
    host([models, hd]);
    expect(
      (await ngspiceCaps([CAPABILITIES_ACCEPT_CELL_LIBRARIES])).cellLibraries,
    ).toEqual([{ ...hd, cells: "sky130_fd_sc_hd", directive: "include" }]);
    // A host that predates the cells, or one that does not answer.
    host([models]);
    expect(
      (await ngspiceCaps([CAPABILITIES_ACCEPT_CELL_LIBRARIES])).cellLibraries,
    ).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(
      (await ngspiceCaps([CAPABILITIES_ACCEPT_CELL_LIBRARIES])).cellLibraries,
    ).toEqual([]);
  });

  it("mounts a cell library by identity", async () => {
    const fetcher = host([models, hd]);
    const cells = { ...hd, mountPath: "cells.spice" };
    await routeSimulationRequest(post(raw([cells])), env);
    const run = fetcher.mock.calls.find(([url]) => url.pathname === "/run");
    expect(JSON.parse(String(run?.[1].body)).dependencies).toEqual([cells]);
  });

  it("refuses a cell library of other bytes before Run", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await routeSimulationRequest(
      post(
        raw([
          {
            id: "sky130_fd_sc_hd",
            sha256: "e".repeat(64),
            mountPath: "cells.spice",
          },
        ]),
      ),
      env,
    );
    expect(response!.status).toBe(400);
    expect(await response!.json()).toEqual({ error: "invalid-input-files" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("signing in to simulate", () => {
  const signedIn = {
    AUTH: {
      getByName: () => ({
        fetch: async () => Response.json({ user: { id: "member" } }),
      }),
    },
  };
  const request = (
    body: unknown,
    headers: Record<string, string> = {},
    path = "/api/simulate",
  ) =>
    new Request(`https://canvas.test${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

  it("lets anyone discover the Profiles but asks a signed-out visitor to sign in before running", async () => {
    expect(
      await refuseSignedOutSimulation(
        request({ operation: "capabilities" }),
        {},
      ),
    ).toBeNull();
    const refused = await refuseSignedOutSimulation(request(nativeInput()), {});
    expect(refused?.status).toBe(401);
    expect(await refused!.json()).toEqual({
      error: "simulation-authentication-required",
      message:
        "Hosted simulation is for the Analog Canvas team: sign in with a team account, or export a SPICE or Spectre netlist with File › Export and run it with your own simulator and PDK.",
    });
    expect(
      await refuseSignedOutSimulation(
        request(nativeInput(), {}, "/api/elsewhere"),
        {},
      ),
    ).toBeNull();
  });

  it("runs for a team account or the deploy check's one-off credential, and nothing else", async () => {
    const account = (user: Record<string, unknown>) => ({
      AUTH: {
        getByName: () => ({
          fetch: async () => Response.json({ user: { id: "a", ...user } }),
        }),
      },
    });
    for (const team of [
      { isOwner: true },
      { seat: "ai-designer-1" },
      { isAdmin: true },
    ])
      expect(
        await refuseSignedOutSimulation(
          request(nativeInput(), { cookie: "icm_session=abc" }),
          account(team),
        ),
      ).toBeNull();
    const member = await refuseSignedOutSimulation(
      request(nativeInput(), { cookie: "icm_session=abc" }),
      signedIn,
    );
    expect(member?.status).toBe(403);
    expect(await member!.json()).toMatchObject({
      error: "hosted-simulation-team-only",
      message: expect.stringContaining("File › Export"),
    });
    expect(
      await refuseSignedOutSimulation(
        request({ operation: "capabilities" }, { cookie: "icm_session=abc" }),
        signedIn,
      ),
    ).toBeNull();
    const smoke = { SIMULATION_SMOKE_TOKEN: "this-deploy-only" };
    expect(
      await refuseSignedOutSimulation(
        request(nativeInput(), { authorization: "Bearer this-deploy-only" }),
        smoke,
      ),
    ).toBeNull();
    for (const [headers, deployment] of [
      [{ authorization: "Bearer an-earlier-deploy" }, smoke],
      [{ authorization: "Bearer " }, {}],
      [{ cookie: "icm_session=abc" }, {}],
    ] as const)
      expect(
        (
          await refuseSignedOutSimulation(
            request(nativeInput(), headers),
            deployment,
          )
        )?.status,
      ).toBe(401);
  });
});
