import { describe, expect, it } from "vitest";

import {
  runHostedSky130Acceptance,
  runPreviewSimulationSmoke,
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

function modelResult(target, overrides = {}) {
  const base = result(target);
  return {
    ...base,
    metadata: {
      ...base.metadata,
      input: { inputRevision: `preview-sky130-${target}` },
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
      ),
    ).toMatchObject({
      target: "cloudflare-container",
      fixtureId: "ota-5t-balanced-op-v1",
      environmentFingerprint: SHA,
      values: { "v(vout)": 0.7589797395133877 },
    });
  });

  it("refuses numerical drift outside the recorded tolerance", () => {
    const candidate = modelResult("operator-host");
    candidate.data.analyses[0].probes[0].value = 0.8;
    expect(() =>
      validateHostedSky130Result(candidate, "operator-host"),
    ).toThrow(/solved v\(vout\) as 0\.8/u);
  });

  it("refuses a run that did not load the qualified corner", () => {
    const candidate = modelResult("operator-host");
    candidate.metadata.configuration.modelLibrary.section = "ff";
    expect(() =>
      validateHostedSky130Result(candidate, "operator-host"),
    ).toThrow(/qualified model-library section/u);
  });

  it("sends the model fixture through the selected executor", async () => {
    let submitted;
    const accepted = await runHostedSky130Acceptance({
      baseUrl: "https://preview.example",
      target: "operator-host",
      fetchImpl: async (_url, init) => {
        submitted = JSON.parse(init.body);
        return Response.json(modelResult("operator-host"));
      },
    });
    expect(submitted.executorTarget).toBe("operator-host");
    expect(submitted.netlist).toContain(".subckt ota_5t");
    expect(submitted.testbench).toContain("write out.raw v(vout)");
    expect(accepted.fixtureId).toBe("ota-5t-balanced-op-v1");
  });
});
