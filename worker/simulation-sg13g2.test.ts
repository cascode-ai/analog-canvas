import { afterEach, expect, it, vi } from "vitest";
import { routeSimulationRequest, type SimulationEnv } from "./simulation";
import sky130 from "../containers/ngspice/hosted-sky130-profile.json";
import sg13 from "../containers/ngspice/sg13g2/profile.json";
import {
  encodeExecutionReceipt,
  EXECUTION_RECEIPT_HEADER,
  sha256,
} from "@icm/simulation-service";
import {
  createSimulationInputMetadata,
  createSimulationEnvironmentMetadata,
} from "@icm/spice-run";

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
  expect(selected.profiles[0].devices).toContain("sg13_hv_nmos");
  expect(selected.profiles[0].corners).toEqual(sg13.qualifiedScope.sections);
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

it("cancels only the selected SG13 executor", async () => {
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
    {
      ...env,
    },
  );
  expect(result!.status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  [sg13, 200],
  [{ ...sg13, id: "ihp-sg13g2-nominal-ngspice46-v1" }, 502],
] as const)(
  "checks the streaming receipt identity for the final Profile ($1)",
  async (identity, status) => {
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(url.toString()).toBe("https://sim.test/sg13g2/run");
      const { deck, outputContext, runToken, files } = JSON.parse(
        String(init.body),
      );
      const environment = await createSimulationEnvironmentMetadata({
        executor: "hosted-container",
        reproducibility: "pinned",
        profileId: identity.id,
        platform: identity.platform,
        simulator: { ...identity.simulator, name: "ngspice" },
        models: {
          id: identity.models.id,
          contentSha256: identity.models.contentSha256,
        },
        startupSha256: identity.startup.contentSha256,
      });
      const metadata = {
        schemaVersion: 1,
        environment,
        configuration: { modelLibrary: null },
        input: await createSimulationInputMetadata({ ...outputContext, deck }),
      };
      const outcome = { status: "completed" };
      const text = JSON.stringify({ metadata, outcome });
      return new Response(text, {
        headers: {
          [EXECUTION_RECEIPT_HEADER]: encodeExecutionReceipt({
            schemaVersion: 1,
            runToken,
            byteLength: new TextEncoder().encode(text).length,
            sha256: await sha256(text),
            executedFilesSha256: await sha256(JSON.stringify(files)),
            outcome,
            metadata,
            execution: outputContext.execution,
            cancelled: false,
            collectionStatus: "complete",
          }),
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await routeSimulationRequest(
      post({
        environment: { profileId: sg13.id },
        mode: "raw",
        netlist: "",
        testbench:
          "title\nV1 a 0 1\nR a 0 1k\n.control\nop\nquit\n.endc\n.end\n",
        inputRevision: "identity-refusal",
        runToken: crypto.randomUUID(),
      }),
      {
        ...env,
      },
    );
    expect(result!.status).toBe(status);
    if (status === 502)
      expect((await result!.json()).error).toBe("simulator-protocol-invalid");
    else expect(result!.headers.has(EXECUTION_RECEIPT_HEADER)).toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

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

it("offers exactly one SG13 Profile with all qualified devices", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(health)),
  );
  const reply = await routeSimulationRequest(
    post({ operation: "capabilities" }),
    env,
  );
  const capabilities = await reply!.json();
  expect(capabilities.profiles.map((p: { id: string }) => p.id)).toEqual([
    sky130.id,
    sg13.id,
  ]);
  expect(capabilities.profiles[1].devices).toHaveLength(13);
});

it("refuses the retired SG13 Profile without substituting the final model", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const operation of ["capabilities", "cancel", undefined]) {
    const result = await routeSimulationRequest(
      post({
        operation,
        environment: { profileId: "ihp-sg13g2-nominal-ngspice46-v1" },
        runToken: crypto.randomUUID(),
      }),
      env,
    );
    expect(result!.status).toBe(400);
    expect((await result!.json()).error).toBe("simulation-profile-unavailable");
  }
  expect(fetcher).not.toHaveBeenCalled();
});
