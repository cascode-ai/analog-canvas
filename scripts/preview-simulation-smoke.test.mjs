import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { validateQualifiedModelSelection } from "./lib/preview-simulation-sky130-validation.mjs";

import {
  compileHostedSky130Project,
  compileHostedSky130NoiseProject,
  compileHostedSky130TransientProject,
  hostedSky130CornerRequest,
  hostedSky130ExtendedDeviceRequest,
  runHostedSky130Acceptance,
  runHostedSky130CornerAcceptance,
  runHostedSky130ExtendedDeviceAcceptance,
  runHostedSky130NoiseAcceptance,
  runHostedSky130TransientAcceptance,
  runPreviewSimulationSmoke,
  validateHostedSky130TransientResult,
  validateHostedSky130NoiseResult,
  validateResistorNoiseResult,
  validateDcDividerResult,
  validateExecutorParity,
  validateHostedSky130Result,
  validateHostedSky130CornerResult,
  validateHostedSky130ExtendedDeviceResult,
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
const CORNER_ENVIRONMENT_SHA =
  "33c245e5df6dc12077b6a2e4ebf308777b0e9014fe9bfdafc3285c614688561d";
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
  const dcValues = [
    0.3052800375191325, 0.3169616386791885, 0.334216771353992,
    0.3797013459856312, 0.7589597733013465, 1.388551981037926,
    1.699385597389425, 1.730270358029663, 1.744078503303503,
  ];
  const tranValues = Array(232).fill(0.7589797395133877);
  tranValues[1] = 0.75886248142361;
  tranValues[2] = 1.699250823009046;
  tranValues[231] = 0.7732444834989551;
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
          analysis: "dc",
          sweep: {
            name: "v(v-sweep)",
            values: [0.88, 0.885, 0.89, 0.895, 0.9, 0.905, 0.91, 0.915, 0.92],
          },
          probes: EXPECTED_VECTORS.map(({ vector }) => ({
            name: vector,
            value:
              vector === "v(vout)"
                ? dcValues
                : vector === "v(xdut.tail)"
                  ? [
                      0.2687226173951219, 0.27, 0.275, 0.28, 0.2848672269272364,
                      0.288, 0.291, 0.293, 0.2958758389498102,
                    ]
                  : Array(9).fill(0.5),
          })),
        },
        {
          analysis: "ac",
          frequencyHz,
          probes: acProbes,
        },
        {
          analysis: "tran",
          timeSeconds: [...Array(231).fill(0), 4e-6],
          probes: EXPECTED_VECTORS.map(({ vector }) => ({
            name: vector,
            value: vector === "v(vout)" ? tranValues : Array(232).fill(0.5),
          })),
        },
      ],
    },
    ...overrides,
  };
}

function cornerResult(target, corner = "ff") {
  const base = result(target);
  return {
    ...base,
    metadata: {
      ...base.metadata,
      input: { inputRevision: `preview-sky130-corner-${corner}` },
      configuration: {
        modelLibrary: { directive: "lib", section: corner },
      },
      environment: {
        ...base.metadata.environment,
        fingerprint: CORNER_ENVIRONMENT_SHA,
      },
    },
    data: {
      analyses: [
        {
          analysis: "op",
          probes: [
            { name: "i(vdn)", value: -0.0002526337154561964 },
            { name: "i(vsp)", value: -9.451994627332483e-7 },
          ],
        },
      ],
    },
  };
}

function extendedDeviceResult(target, corner = "ff") {
  const base = result(target);
  const expected = {
    lvtNfetCurrentA: -0.0001329127936535723,
    lvtPfetSourceCurrentA: -0.00006968745845296193,
    resistorOutputV: 0.313487576360055,
    resistorSupplyCurrentA: -0.000313487576360055,
    pnpEmitterCurrentA: -2.149132309996193e-7,
    pnpCollectorCurrentA: 1.983406510684755e-7,
    mimOutputReal: 9.002255934489363e-12,
    mimOutputImag: -0.00000300037596550971,
  };
  return {
    ...base,
    metadata: {
      ...base.metadata,
      input: { inputRevision: `preview-sky130-extended-${corner}` },
      configuration: {
        modelLibrary: { directive: "lib", section: corner },
      },
      environment: {
        ...base.metadata.environment,
        fingerprint: CORNER_ENVIRONMENT_SHA,
      },
    },
    data: {
      analyses: [
        {
          analysis: "op",
          probes: [
            { name: "i(vdnl)", value: expected.lvtNfetCurrentA },
            { name: "i(vspl)", value: expected.lvtPfetSourceCurrentA },
            { name: "v(rout)", value: expected.resistorOutputV },
            { name: "i(vrin)", value: expected.resistorSupplyCurrentA },
            { name: "i(vpe)", value: expected.pnpEmitterCurrentA },
            { name: "i(vpc)", value: expected.pnpCollectorCurrentA },
          ],
        },
        {
          analysis: "ac",
          frequencyHz: [1e9],
          probes: [
            {
              name: "v(capout)",
              real: [expected.mimOutputReal],
              imag: [expected.mimOutputImag],
            },
          ],
        },
      ],
    },
  };
}

function noiseResult(target, inputRevision = `preview-sky130-noise-${target}`) {
  const base = modelResult(target, {}, inputRevision);
  const frequencyHz = Array.from(
    { length: 181 },
    (_, index) => 10 ** (index / 20),
  );
  const outputNoiseDensity = Array(181).fill(1e-9);
  const inputNoiseDensity = Array(181).fill(1e-9);
  for (const [index, frequency, output, input] of [
    [0, 1, 0.0003527268281019868, 0.000002936387001390052],
    [80, 9999.999999999938, 0.000006728436964105413, 5.603672350495118e-8],
    [120, 999999.9999999905, 6.807410088432378e-7, 1.743688273418767e-8],
    [180, 999999999.9999859, 6.221508309545533e-10, 1.524689249398183e-8],
  ]) {
    frequencyHz[index] = frequency;
    outputNoiseDensity[index] = output;
    inputNoiseDensity[index] = input;
  }
  return {
    ...base,
    metadata: {
      ...base.metadata,
      environment: {
        ...base.metadata.environment,
        fingerprint: CORNER_ENVIRONMENT_SHA,
      },
    },
    data: {
      analyses: [
        {
          analysis: "noise",
          frequencyHz,
          outputNoiseDensity,
          inputNoiseDensity,
          integratedOutputNoise: 0.002464690192665594,
          integratedInputNoise: 0.0007312163500832933,
          units: {
            outputDensity: "V/sqrt(Hz)",
            inputDensity: "V/sqrt(Hz)",
            integratedOutput: "V",
            integratedInput: "V",
          },
        },
      ],
    },
  };
}

function resistorNoiseResult(target) {
  const base = result(target);
  const density = Math.sqrt(4 * 1.380649e-23 * (273.15 + 27) * 500);
  return {
    ...base,
    data: {
      analyses: [
        {
          analysis: "noise",
          frequencyHz: [10, 21.5, 46.4, 100, 215, 464, 1000],
          outputNoiseDensity: Array(7).fill(density),
          inputNoiseDensity: Array(7).fill(density * 2),
          integratedOutputNoise: density * Math.sqrt(990),
          integratedInputNoise: density * Math.sqrt(990) * 2,
          units: {
            outputDensity: "V/sqrt(Hz)",
            inputDensity: "V/sqrt(Hz)",
            integratedOutput: "V",
            integratedInput: "V",
          },
        },
      ],
    },
  };
}

describe("the Preview dual-executor smoke", () => {
  it("accepts a one-source DC divider curve", () => {
    const candidate = result("operator-host", {
      data: {
        analyses: [
          {
            analysis: "dc",
            sweep: { name: "v(v-sweep)", values: [0, 0.5, 1, 1.5] },
            probes: [{ name: "v(out)", value: [0, 0.25, 0.5, 0.75] }],
          },
        ],
      },
    });
    expect(validateDcDividerResult(candidate, "operator-host")).toEqual({
      target: "operator-host",
      pointCount: 4,
    });
  });

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
  it("builds and validates the selected process-corner request", async () => {
    expect(hostedSky130CornerRequest("ff")).toMatchObject({
      environment: { profileId: PROFILE_ID, corner: "ff" },
      inputRevision: "preview-sky130-corner-ff",
    });
    expect(
      validateHostedSky130CornerResult(
        cornerResult("operator-host"),
        "operator-host",
        "ff",
      ),
    ).toMatchObject({
      corner: "ff",
      nfetCurrentA: -0.0002526337154561964,
    });

    let submitted;
    await runHostedSky130CornerAcceptance({
      baseUrl: "https://preview.example",
      target: "operator-host",
      corner: "ff",
      fetchImpl: async (_url, init) => {
        submitted = JSON.parse(init.body);
        return Response.json(cornerResult("operator-host"));
      },
    });
    expect(submitted.environment).toEqual({
      profileId: PROFILE_ID,
      corner: "ff",
    });
  });

  it("refuses process-corner numerical drift", () => {
    const candidate = cornerResult("operator-host");
    candidate.data.analyses[0].probes[0].value = -0.001;
    expect(() =>
      validateHostedSky130CornerResult(candidate, "operator-host", "ff"),
    ).toThrow(/unexpected ff currents/u);
  });

  it("qualifies every newly exposed wrapper from one OP/AC deck", async () => {
    const request = hostedSky130ExtendedDeviceRequest("ff");
    expect(request.netlist).toContain("sky130_fd_pr__nfet_01v8_lvt");
    expect(request.netlist).toContain("sky130_fd_pr__pfet_01v8_lvt");
    expect(request.netlist).toContain("sky130_fd_pr__res_high_po");
    expect(request.netlist).toContain("sky130_fd_pr__cap_mim_m3_1");
    expect(request.netlist).toContain(
      "XQP pc pb pe sky130_fd_pr__pnp_05v5_W0p68L0p68",
    );
    expect(request.netlist).not.toContain(
      "XQP pc pb pe 0 sky130_fd_pr__pnp_05v5_W0p68L0p68",
    );
    expect(
      validateHostedSky130ExtendedDeviceResult(
        extendedDeviceResult("operator-host"),
        "operator-host",
        "ff",
      ),
    ).toMatchObject({
      corner: "ff",
      resistorOutputV: 0.313487576360055,
    });

    let submitted;
    await runHostedSky130ExtendedDeviceAcceptance({
      baseUrl: "https://preview.example",
      target: "operator-host",
      corner: "ff",
      fetchImpl: async (_url, init) => {
        submitted = JSON.parse(init.body);
        return Response.json(extendedDeviceResult("operator-host"));
      },
    });
    expect(submitted.environment).toEqual({
      profileId: PROFILE_ID,
      corner: "ff",
    });
  });

  it("refuses extended-device numerical drift", () => {
    const candidate = extendedDeviceResult("operator-host");
    candidate.data.analyses[0].probes[0].value = -0.001;
    expect(() =>
      validateHostedSky130ExtendedDeviceResult(
        candidate,
        "operator-host",
        "ff",
      ),
    ).toThrow(/lvtNfetCurrentA/u);
  });

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
      fixtureId: "ota-5t-structured-op-dc-ac-tran-noise-v3",
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
    candidate.data.analyses[2].probes[0].real[60] = 13;
    expect(() =>
      validateHostedSky130Result(
        candidate,
        "operator-host",
        "preview-sky130-operator-host",
        EXPECTED_VECTORS,
      ),
    ).toThrow(/solved v\(vout\)\[60\] as 13/u);
  });

  it("refuses DC drift outside the recorded tolerance", () => {
    const candidate = modelResult("operator-host");
    candidate.data.analyses[1].probes[0].value[4] = 0.9;
    expect(() =>
      validateHostedSky130Result(
        candidate,
        "operator-host",
        "preview-sky130-operator-host",
        EXPECTED_VECTORS,
      ),
    ).toThrow(/solved v\(vout\)\[4\] as 0\.9/u);
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

  it("verifies source model selection against the executed input hash and pinned dependency", async () => {
    const { request } = await compileHostedSky130Project();
    const candidate = modelResult("operator-host", {}, request.inputRevision);
    candidate.metadata.configuration.modelLibrary = null;
    candidate.metadata.input.testbenchSha256 = createHash("sha256")
      .update(request.testbench)
      .digest("hex");
    expect(() =>
      validateQualifiedModelSelection(candidate, "operator-host", request),
    ).not.toThrow();
    expect(() =>
      validateQualifiedModelSelection(candidate, "operator-host"),
    ).toThrow(/verified input evidence/u);
    const wrongCorner = structuredClone(request);
    wrongCorner.environment.corner = "ff";
    expect(() =>
      validateQualifiedModelSelection(candidate, "operator-host", wrongCorner),
    ).toThrow(/qualified model-library/u);
    const changed = structuredClone(request);
    changed.testbench += "\n* changed after execution\n";
    expect(() =>
      validateQualifiedModelSelection(candidate, "operator-host", changed),
    ).toThrow(/verified input evidence/u);
    const wrongModel = structuredClone(request);
    wrongModel.dependencies[0].sha256 = SHA;
    expect(() =>
      validateQualifiedModelSelection(candidate, "operator-host", wrongModel),
    ).toThrow(/verified input evidence/u);
  }, 15_000);

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
    expect(submitted.files.map((file) => file.text).join("\n")).toContain(
      ".subckt ota_5t",
    );
    expect(submitted.testbench).toContain("set appendwrite");
    expect(submitted.testbench).toContain("write out.raw");
    expect(submitted.testbench).toContain("v(vout)");
    expect(submitted.testbench).toContain("ac dec 10 1 1000000000");
    expect(accepted.fixtureId).toBe("ota-5t-structured-op-dc-ac-tran-noise-v3");
  }, 15_000);

  it("compiles the persisted Project setup into the qualified request", async () => {
    const compiled = await compileHostedSky130Project();
    for (const command of ["op", "dc VINP", "ac dec", "tran "]) {
      expect(compiled.request.testbench).toContain(command);
    }
    expect(
      compiled.vectors.map(({ vector, quantity }) => ({ vector, quantity })),
    ).toEqual(
      EXPECTED_VECTORS.map(({ vector, quantity }) => ({ vector, quantity })),
    );
    expect(compiled.request.inputRevision).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("compiles and validates the model-backed structured transient slice", async () => {
    const compiled = await compileHostedSky130TransientProject();
    expect(compiled.request.testbench).not.toMatch(/^op$/mu);
    expect(compiled.request.testbench).toContain("tran 2e-8 0.000004");
    expect(
      compiled.request.files.map((file) => file.text).join("\n"),
    ).toContain("VINP vinp 0 DC 0.9 AC 1 0 PULSE(0.9 0.91 1u 1n 1n 1u 3u)");

    const values = Array(232).fill(0.7589797395133877);
    values[1] = 0.75886248142361;
    values[2] = 1.699250823009046;
    values[231] = 0.7732444834989551;
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
    const values = Array(232).fill(0.7589797395133877);
    values[1] = 0.75886248142361;
    values[2] = 1.699250823009046;
    values[231] = 0.7732444834989551;
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

  it("compiles and validates the model-backed structured Noise slice", async () => {
    const compiled = await compileHostedSky130NoiseProject();
    expect(compiled.request.testbench).not.toMatch(/^op$/mu);
    expect(compiled.request.testbench).toContain(
      "noise v(vout) VINP dec 20 1 1000000000",
    );
    expect(compiled.request.testbench).toContain(
      "write out.raw noise1.all noise2.all",
    );
    expect(
      validateHostedSky130NoiseResult(
        noiseResult("operator-host", compiled.request.inputRevision),
        "operator-host",
        compiled.request.inputRevision,
      ),
    ).toMatchObject({
      pointCount: 181,
      integratedOutputNoise: 0.002464690192665594,
    });
  });

  it("sends the structured Noise slice through the selected executor", async () => {
    let submitted;
    const accepted = await runHostedSky130NoiseAcceptance({
      baseUrl: "https://preview.example",
      target: "operator-host",
      fetchImpl: async (_url, init) => {
        submitted = JSON.parse(init.body);
        return Response.json(
          noiseResult("operator-host", submitted.inputRevision),
        );
      },
    });
    expect(submitted.executorTarget).toBe("operator-host");
    expect(submitted.testbench).toContain(
      "noise v(vout) VINP dec 20 1 1000000000",
    );
    expect(accepted.pointCount).toBe(181);
  });

  it("checks resistor Noise against the 4kTR thermal-noise law", () => {
    expect(
      validateResistorNoiseResult(
        resistorNoiseResult("operator-host"),
        "operator-host",
      ),
    ).toMatchObject({ target: "operator-host", pointCount: 7 });
    const drifted = resistorNoiseResult("operator-host");
    drifted.data.analyses[0].outputNoiseDensity[0] *= 2;
    expect(() => validateResistorNoiseResult(drifted, "operator-host")).toThrow(
      /inconsistent with 4kTR/u,
    );
  });
});
