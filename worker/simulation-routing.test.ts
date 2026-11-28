import { afterEach, describe, expect, it, vi } from "vitest";
import {
  routeSimulationRequest,
  refuseSignedOutSimulation,
  type SimulationEnv,
} from "./simulation";
import ngspiceProfile from "../containers/ngspice/hosted-sky130-profile.json";
import sg13g2Profile from "../containers/ngspice/sg13g2/profile.json";
import { CAPABILITIES_ACCEPT_CELL_LIBRARIES } from "@icm/simulation-service";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";
import { ngspiceInput } from "./simulation.test-fixture";

const post = (body: unknown) =>
  new Request("https://canvas.test/api/simulate", {
    method: "POST",
    body: JSON.stringify(body),
  });

const env: SimulationEnv = {
  SIMULATION_UPSTREAM_URL: "https://ngspice.test",
  SIMULATION_UPSTREAM_TOKEN: "ngspice-test-only",
  SIMULATION_DEFAULT_EXECUTOR: "operator-host",
  SG13G2_UPSTREAM_URL: "https://sg13g2.test",
};

const sg13Health = {
  status: "ready",
  environment: await createSimulationEnvironmentMetadata({
    executor: "hosted-container",
    reproducibility: "pinned",
    profileId: sg13g2Profile.id,
    platform: sg13g2Profile.platform,
    simulator: { ...sg13g2Profile.simulator, name: "ngspice" },
    models: {
      id: sg13g2Profile.models.id,
      contentSha256: sg13g2Profile.models.contentSha256,
    },
    startupSha256: sg13g2Profile.startup.contentSha256,
  }),
};

afterEach(() => vi.unstubAllGlobals());

describe("ngspice Profile routing", () => {
  it("discovers configured SKY130 and SG13G2 Profiles and returns the selected Profile's collection and limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        Response.json(
          url.hostname === "sg13g2.test"
            ? sg13Health
            : { status: "ready", limits: { outputBytes: 1024 } },
        ),
      ),
    );
    const all = (await (await routeSimulationRequest(
      post({ operation: "capabilities" }),
      env,
    ))!.json()) as {
      profiles: { id: string; engine: string; label?: string }[];
    };
    expect(all.profiles.map((p) => p.id)).toEqual([
      ngspiceProfile.id,
      sg13g2Profile.id,
    ]);
    expect(all.profiles.map((p) => p.engine)).toEqual(["ngspice", "ngspice"]);
    expect(all.profiles[0]?.label).toBe("SKY130 qualified devices · ngspice 46");
    for (const profileId of [ngspiceProfile.id, sg13g2Profile.id]) {
      const caps = (await (await routeSimulationRequest(
        post({ operation: "capabilities", environment: { profileId } }),
        env,
      ))!.json()) as {
        rawfileCollection: string;
        profiles: { id: string }[];
      };
      expect(caps.rawfileCollection).toBe("declared-single-ascii");
      expect(caps.profiles.map((p) => p.id)).toEqual([profileId]);
    }
  });

  it("routes cancellation by the captured Profile, without checking health or broadcasting", async () => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.pathname).toBe("/cancel");
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer ngspice-test-only",
      );
      return Response.json({ cancelled: true });
    });
    vi.stubGlobal("fetch", fetcher);
    for (const profileId of [ngspiceProfile.id, sg13g2Profile.id])
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
      "sg13g2.test",
    ]);
    expect(
      (await routeSimulationRequest(post({ operation: "cancel" }), env))!
        .status,
    ).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown Profiles and foreign language tags without contacting an upstream", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await routeSimulationRequest(
        post({ ...ngspiceInput(), environment: { profileId: "unknown" } }),
        env,
      ))!.status,
    ).toBe(400);
    expect(
      (await routeSimulationRequest(
        post({ ...ngspiceInput(), language: "vacask" }),
        env,
      ))!.status,
    ).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
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
      ))!.json()) as {
        profiles: {
          dependencies?: unknown[];
          devices?: string[];
          cellLibraries?: unknown[];
        }[];
      }
    ).profiles[0]!;

  it("keeps the shape an earlier client parses: one model library and no cells", async () => {
    host([models, hd]);
    const profile = await ngspiceCaps();
    // An editor tab loaded before #1596 parses capabilities strictly, and
    // its Prepare needs exactly one Profile library for every SKY130 run.
    expect(profile).not.toHaveProperty("cellLibraries");
    expect(profile.dependencies).toEqual([models]);
    expect(profile.devices).toContain("sky130_fd_pr__pfet_01v8_hvt");
    expect(profile.devices).toContain("sky130_fd_pr__nfet_g5v0d10v5");
    expect(profile.devices).toContain("sky130_fd_pr__pnp_05v5_W3p40L3p40");
    expect(profile.devices).toContain("sky130_fd_pr__npn_05v5_W1p00L1p00");
    expect(profile.devices).toContain("sky130_fd_pr__diode_pw2nd_05v5");
    expect(profile.devices).toContain("sky130_fd_pr__diode_pd2nw_05v5");
    expect(profile.devices).toContain("sky130_fd_pr__res_xhigh_po");
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
    const refused = await refuseSignedOutSimulation(request(ngspiceInput()), {});
    expect(refused?.status).toBe(401);
    expect(await refused!.json()).toMatchObject({
      error: "simulation-authentication-required",
      message: expect.stringContaining("export a SPICE or Spectre netlist"),
    });
    expect(
      await refuseSignedOutSimulation(
        request(ngspiceInput(), {}, "/api/elsewhere"),
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
          request(ngspiceInput(), { cookie: "icm_session=abc" }),
          account(team),
        ),
      ).toBeNull();
    const member = await refuseSignedOutSimulation(
      request(ngspiceInput(), { cookie: "icm_session=abc" }),
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
        request(ngspiceInput(), { authorization: "Bearer this-deploy-only" }),
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
            request(ngspiceInput(), headers),
            deployment,
          )
        )?.status,
      ).toBe(401);
  });
});
