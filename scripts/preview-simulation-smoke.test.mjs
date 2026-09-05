import { describe, expect, it } from "vitest";

import {
  compileHostedSky130Project,
  compileHostedSky130TransientProject,
  runHostedSky130Acceptance,
  runHostedSky130TransientAcceptance,
  runPreviewSimulationSmoke,
  validateHostedSky130TransientResult,
  validateExecutorParity,
  validateHostedSky130Result,
  validatePreviewSimulationResult,
} from "./preview-simulation-smoke.mjs";

const SHA = "a".repeat(64);
const PROFILE_ID = "sky130-core-continuous-ngspice46-v1";
const BINARY_SHA =
  "e9b0e776ac656de5e470f6b339c4a7254c961d77714b4b94f4b71be2422e7b46";
const MODEL_SHA =
  "0bf299f0e3e1616478203d370107865635fd08935bb1a9cf9db18efd31703100";
const STARTUP_SHA =
  "5ad94681e17bba379ac84d01fe7773458b34f9bbd77c127a3738f1af47ad5634";
const EXPECTED_VECTORS = [
  { probeId: "probe-vout", vector: "v(vout)", quantity: "voltage" },
  { probeId: "probe-ibias", vector: "v(ibias)", quantity: "voltage" },
  { probeId: "probe-tail", vector: "v(xdut.tail)", quantity: "voltage" },
  {
    probeId: "probe-nleft",
    vector: "v(xdut.nleft)",
    quantity: "voltage",
  },
];

function result(target, overrides = {}) {
  return {
    execution: { target },
    outcome: { status: "completed" },
    diagnostics: [],
    metadata: {
      input: { inputRevision: `preview-smoke-${target}` },
      configuration: { modelLibrary: null },
      environment: {
        reproducibility: "pinned",
        profileId: PROFILE_ID,
        startupSha256: STARTUP_SHA,
        fingerprint: SHA,
        simulator: {
          name: "ngspice",
          version: "ngspice-46",
          binarySha256: BINARY_SHA,
        },
        models: {
          id: "sky130A-continuous",
          contentSha256: MODEL_SHA,
        },
      },
    },
    data: {
      analyses: [
        {
          analysis: "op",
          probes: [{ name: "v(mid)", value: 0.5 }],
        },
      ],
    },
    ...overrides,
  };
}

function modelResult(
  target,
  overrides = {},
  inputRevision = `preview-sky130-${target}`,
) {
  const base = result(target);
  const frequencyHz = Array.from(
    { length: 91 },
    (_, index) => 10 ** (index / 10),
  );
  const acProbes = EXPECTED_VECTORS.map(({ vector }) => ({
    name: vector,
    real: Array(91).fill(0),
    imag: Array(91).fill(0),
  }));
  const vout = acProbes.find((probe) => probe.name === "v(vout)");
  const tail = acProbes.find((probe) => probe.name === "v(xdut.tail)");
  if (!vout || !tail) throw new Error("test AC probes are incomplete");
  for (const [index, real, imag] of [
    [0, 120.1227317562375, -0.0003511468844918635],
    [30, 120.1217100790957, -0.3511439119206514],
    [60, 12.1813224169096, -37.09123686627677],
    [90, -0.04031087451053017, -0.006331573453656596],
  ]) {
    vout.real[index] = real;
    vout.imag[index] = imag;
  }
  tail.real[60] = 0.4417357549275905;
  tail.imag[60] = -0.1070857397604748;
  return {
    ...base,
    metadata: {
      ...base.metadata,
      input: { inputRevision },
      configuration: {
        modelLibrary: { directive: "lib", section: "tt" },
      },
    },
    data: {
      analyses: [
        {
          analysis: "op",
          probes: [
            { name: "v(vout)", value: 0.7589797395133877 },
            { name: "v(ibias)", value: 0.6044031364286973 },
            { name: "v(xdut.tail)", value: 0.2848671983031419 },
            { name: "v(xdut.nleft)", value: 0.7589797395214736 },
          ],
        },
        {
          analysis: "ac",
          frequencyHz,
          probes: acProbes,
        },
      ],
    },
    ...overrides,
  };
}

describe("the Preview dual-executor smoke", () => {
  it("accepts a numerical operating point with measured environment identity", () => {
    expect(
      validatePreviewSimulationResult(
        result("cloudflare-container"),
        "cloudflare-container",
      ),
    ).toEqual({
      target: "cloudflare-container",
      value: 0.5,
      environmentFingerprint: SHA,
      simulatorVersion: "ngspice-46",
    });
  });

  it("refuses a success-shaped response from the wrong executor", () => {
    expect(() =>
      validatePreviewSimulationResult(
        result("operator-host"),
        "cloudflare-container",
      ),
    ).toThrow(/reported operator-host/u);
  });

  it("refuses completed without the requested number", () => {
    expect(() =>
      validatePreviewSimulationResult(
        result("operator-host", { data: { analyses: [] } }),
        "operator-host",
      ),
    ).toThrow(/operating-point/u);
  });

  it("refuses an observed environment that has not earned the Profile", () => {
    const candidate = result("cloudflare-container");
    candidate.metadata.environment.reproducibility = "observed";
    expect(() =>
      validatePreviewSimulationResult(candidate, "cloudflare-container"),
    ).toThrow(/did not verify its runtime as pinned/u);
  });

  it("refuses a result for a different input revision", () => {
    expect(() =>
      validatePreviewSimulationResult(
        result("operator-host", {
          metadata: {
            input: { inputRevision: "preview-smoke-cloudflare-container" },
            environment: result("operator-host").metadata.environment,
          },
        }),
        "operator-host",
      ),
    ).toThrow(/\[result:stale-input\].*preview-smoke-cloudflare-container/u);
  });

  it("refuses two executors that measured different environments", () => {
    expect(() =>
      validateExecutorParity([
        {
          target: "cloudflare-container",
          environmentFingerprint: "a".repeat(64),
        },
        {
          target: "operator-host",
          environmentFingerprint: "b".repeat(64),
        },
      ]),
    ).toThrow(/do not share one environment/u);
  });

  it("names infrastructure refusals instead of calling them circuit failures", async () => {
    await expect(
      runPreviewSimulationSmoke({
        baseUrl: "https://preview.example",
        target: "operator-host",
        fetchImpl: async () =>
          Response.json(
            {
              error: "simulator-refused",
              reason: "simulator-busy",
              message: "one circuit at a time",
            },
            { status: 502 },
          ),
      }),
    ).rejects.toThrow(
      "[infrastructure:simulator-refused] operator-host answered HTTP 502 (simulator-busy): one circuit at a time",
    );
  });

  it("names a malformed smoke request separately from executor failure", async () => {
    await expect(
      runPreviewSimulationSmoke({
        baseUrl: "https://preview.example",
        target: "cloudflare-container",
        fetchImpl: async () =>
          Response.json(
            {
              error: "invalid-request",
              message: "a circuit and testbench are required",
            },
            { status: 400 },
          ),
      }),
    ).rejects.toThrow(
      "[request:invalid-request] cloudflare-container answered HTTP 400: a circuit and testbench are required",
    );
  });

  it("keeps a timed-out run separate from an infrastructure refusal", () => {
    expect(() =>
      validatePreviewSimulationResult(
        result("operator-host", {
          outcome: { status: "timed-out" },
          diagnostics: [{ text: "the deadline expired" }],
        }),
        "operator-host",
      ),
    ).toThrow(/\[run:timed-out\].*the deadline expired/u);
  });

  it("names a non-JSON response as a protocol failure", async () => {
    await expect(
      runPreviewSimulationSmoke({
        baseUrl: "https://preview.example",
        target: "operator-host",
        fetchImpl: async () =>
          new Response("bad gateway", {
            status: 502,
            headers: { "content-type": "text/plain" },
          }),
      }),
    ).rejects.toThrow(
      "[protocol:non-json] operator-host answered HTTP 502: bad gateway",
    );
  });
});

describe("the hosted SKY130 qualification", () => {
  it("accepts the model-backed OTA operating point", () => {
    expect(
      validateHostedSky130Result(
        modelResult("cloudflare-container"),
        "cloudflare-container",
        "preview-sky130-cloudflare-container",
        EXPECTED_VECTORS,
      ),
    ).toMatchObject({
      target: "cloudflare-container",
      fixtureId: "ota-5t-structured-op-ac-tran-v1",
      environmentFingerprint: SHA,
      values: { "v(vout)": 0.7589797395133877 },
    });
  });

  it("refuses numerical drift outside the recorded tolerance", () => {
    const candidate = modelResult("operator-host");
    candidate.data.analyses[0].probes[0].value = 0.8;
    expect(() =>
      validateHostedSky130Result(
        candidate,
        "operator-host",
        "preview-sky130-operator-host",
        EXPECTED_VECTORS,
      ),
    ).toThrow(/solved v\(vout\) as 0\.8/u);
  });

  it("refuses AC drift outside the recorded tolerance", () => {
    const candidate = modelResult("operator-host");
    candidate.data.analyses[1].probes[0].real[60] = 13;
    expect(() =>
      validateHostedSky130Result(
        candidate,
        "operator-host",
        "preview-sky130-operator-host",
        EXPECTED_VECTORS,
      ),
    ).toThrow(/solved v\(vout\)\[60\] as 13/u);
  });

  it("refuses a run that did not load the qualified corner", () => {
    const candidate = modelResult("operator-host");
    candidate.metadata.configuration.modelLibrary.section = "ff";
    expect(() =>
      validateHostedSky130Result(
        candidate,
        "operator-host",
        "preview-sky130-operator-host",
        EXPECTED_VECTORS,
      ),
    ).toThrow(/qualified model-library section/u);
  });

  it("sends the model fixture through the selected executor", async () => {
    let submitted;
    const accepted = await runHostedSky130Acceptance({
      baseUrl: "https://preview.example",
      target: "operator-host",
      fetchImpl: async (_url, init) => {
        submitted = JSON.parse(init.body);
        return Response.json(
          modelResult("operator-host", {}, submitted.inputRevision),
        );
      },
    });
    expect(submitted.executorTarget).toBe("operator-host");
    expect(submitted.netlist).toContain(".subckt ota_5t");
    expect(submitted.testbench).toContain("set appendwrite");
    expect(submitted.testbench).toContain("write out.raw v(vout)");
    expect(submitted.testbench).toContain("ac dec 10 1 1000000000");
    expect(accepted.fixtureId).toBe("ota-5t-structured-op-ac-tran-v1");
  });

  it("compiles the persisted Project setup into the qualified request", async () => {
    const compiled = await compileHostedSky130Project();
    expect(compiled.request.analyses).toEqual(["op", "ac"]);
    expect(compiled.vectors).toEqual(EXPECTED_VECTORS);
    expect(compiled.request.inputRevision).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("compiles and validates the model-backed structured transient slice", async () => {
    const compiled = await compileHostedSky130TransientProject();
    expect(compiled.request.analyses).toEqual(["tran"]);
    expect(compiled.request.testbench).toContain("tran 2e-8 0.000004");
    expect(compiled.request.testbench).toContain(
      "VINP vinp 0 PULSE(0.89 0.91 1u 1n 1n 1u 3u)",
    );

    const values = Array(232).fill(0.3342235191104477);
    values[1] = 0.3342107447553537;
    values[2] = 1.698172273444083;
    values[231] = 0.3342235434776202;
    const payload = modelResult(
      "operator-host",
      {
        data: {
          analyses: [
            {
              analysis: "tran",
              timeSeconds: [...Array(231).fill(0), 4e-6],
              probes: EXPECTED_VECTORS.map(({ vector }) => ({
                name: vector,
                value: vector === "v(vout)" ? values : Array(232).fill(0.5),
              })),
            },
          ],
        },
      },
      compiled.request.inputRevision,
    );
    expect(
      validateHostedSky130TransientResult(
        payload,
        "operator-host",
        compiled.request.inputRevision,
        compiled.vectors,
      ),
    ).toEqual({ target: "operator-host", pointCount: 232 });
  });

  it("sends the structured transient slice through the selected executor", async () => {
    let submitted;
    const compiled = await compileHostedSky130TransientProject();
    const values = Array(232).fill(0.3342235191104477);
    values[1] = 0.3342107447553537;
    values[2] = 1.698172273444083;
    values[231] = 0.3342235434776202;
    const accepted = await runHostedSky130TransientAcceptance({
      baseUrl: "https://preview.example",
      target: "operator-host",
      fetchImpl: async (_url, init) => {
        submitted = JSON.parse(init.body);
        return Response.json(
          modelResult(
            "operator-host",
            {
              data: {
                analyses: [
                  {
                    analysis: "tran",
                    timeSeconds: [...Array(231).fill(0), 4e-6],
                    probes: EXPECTED_VECTORS.map(({ vector }) => ({
                      name: vector,
                      value:
                        vector === "v(vout)" ? values : Array(232).fill(0.5),
                    })),
                  },
                ],
              },
            },
            submitted.inputRevision,
          ),
        );
      },
    });
    expect(submitted.inputRevision).toBe(compiled.request.inputRevision);
    expect(submitted.executorTarget).toBe("operator-host");
    expect(accepted.pointCount).toBe(232);
  });
});
