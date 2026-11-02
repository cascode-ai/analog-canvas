import { afterEach, expect, it, vi } from "vitest";
import { routeSimulationRequest, type SimulationEnv } from "./simulation";
import sky130 from "../containers/ngspice/hosted-sky130-profile.json";
import sg13 from "../containers/ngspice/sg13g2/profile.json";
import { createSimulationEnvironmentMetadata } from "@icm/spice-run";

const health = {
  status: "ready",
  environment: await createSimulationEnvironmentMetadata({
    executor: "hosted-container",
    reproducibility: "pinned",
    profileId: sg13.id,
    platform: sg13.platform,
    simulator: { ...sg13.simulator, name: "ngspice" },
    models: { id: sg13.models.id, contentSha256: sg13.models.contentSha256 },
    startupSha256: sg13.startup.contentSha256,
  }),
};

const post = (body: unknown) =>
  new Request("https://canvas.test/api/simulate", {
    method: "POST",
    body: JSON.stringify(body),
  });
const env: SimulationEnv = {
  SIMULATION_UPSTREAM_URL: "https://sim.test",
  SIMULATION_UPSTREAM_TOKEN: "protocol-test-token",
  SG13G2_UPSTREAM_URL: "https://sim.test/sg13g2",
};
afterEach(() => vi.unstubAllGlobals());

it("discovers independent SKY130 and SG13 Profiles and prepares the selected model library", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(health)),
  );
  const all = (await (await routeSimulationRequest(
    post({ operation: "capabilities" }),
    env,
  ))!.json()) as any;
  expect(all.profiles.map((p: { id: string }) => p.id)).toEqual([
    sky130.id,
    sg13.id,
  ]);
  const selected = (await (await routeSimulationRequest(
    post({ operation: "capabilities", environment: { profileId: sg13.id } }),
    env,
  ))!.json()) as any;
  expect(selected.configured).toBe(true);
  expect(selected.modelLibrary).toEqual({
    path: "/opt/sg13g2/sg13g2.lib.spice",
    section: "nominal",
  });
  expect(selected.profiles).toHaveLength(1);
  expect(selected.profiles[0].devices).toContain("npn13G2");
  expect(selected.profiles[0].devices).not.toContain("sg13_hv_nmos");
  expect(selected.profiles[0].corners).toEqual(["nominal"]);
  const onlySg13 = await routeSimulationRequest(
    post({ operation: "capabilities" }),
    {
      SG13G2_UPSTREAM_URL: env.SG13G2_UPSTREAM_URL!,
    },
  );
  expect((await onlySg13!.json()).configured).toBe(true);
});

it("refuses conflicting engine identities and results from the wrong executor", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      environment: { ...health.environment, profileId: sky130.id },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const collision = await routeSimulationRequest(
    post({ operation: "capabilities" }),
    { ...env, VACASK_PROFILE_ID: sg13.id },
  );
  expect(collision!.status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
  const result = await routeSimulationRequest(
    post({
      environment: { profileId: sg13.id },
      mode: "raw",
      netlist: "",
      testbench:
        "title\nV1 a 0 1\nR1 a 0 1k\n.control\nop\nquit\n.endc\n.end\n",
      inputRevision: "identity-refusal",
    }),
    env,
  );
  expect(result!.status).toBe(502);
  expect((await result!.json()).error).toBe("simulator-protocol-invalid");
});

it("does not advertise SG13 while its host is missing or serves a different model identity", async () => {
  for (const reply of [
    { status: "not-ready" },
    { ...health, environment: { ...health.environment, profileId: sky130.id } },
  ]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(reply)),
    );
    const result = (await (await routeSimulationRequest(
      post({ operation: "capabilities" }),
      env,
    ))!.json()) as any;
    expect(result.profiles.map((p: { id: string }) => p.id)).toEqual([
      sky130.id,
    ]);
  }
});

it("cancels only the selected SG13 executor, retaining its gateway path", async () => {
  const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
    expect(url.toString()).toBe("https://sim.test/sg13g2/cancel");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer protocol-test-token",
    );
    expect(init.redirect).toBe("manual");
    return Response.json({ cancelled: true });
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await routeSimulationRequest(
    post({
      operation: "cancel",
      environment: { profileId: sg13.id },
      runToken: "11111111-1111-4111-8111-111111111111",
    }),
    env,
  );
  expect(result!.status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("does not substitute SKY130 when SG13 is unconfigured, or accept SKY130 corners on SG13", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const [environment, configuration] of [
    [{ profileId: sg13.id }, { ...env, SG13G2_UPSTREAM_URL: "" }],
    [{ profileId: sg13.id, corner: "tt" }, env],
  ] as const) {
    const result = await routeSimulationRequest(
      post({
        environment,
        mode: "raw",
        netlist: "",
        testbench: "title\n.end\n",
        inputRevision: "r1",
      }),
      configuration,
    );
    expect(result!.status).toBe(400);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
