import { describe, expect, it } from "vitest";

import {
  runPreviewSimulationSmoke,
  validateExecutorParity,
  validatePreviewSimulationResult,
} from "./preview-simulation-smoke.mjs";

const SHA = "a".repeat(64);

function result(target, overrides = {}) {
  return {
    execution: { target },
    outcome: { status: "completed" },
    diagnostics: [],
    metadata: {
      environment: {
        fingerprint: SHA,
        simulator: {
          name: "ngspice",
          version: "ngspice-46",
          binarySha256: SHA,
        },
        models: { id: "sky130A", contentSha256: SHA },
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
      "operator-host answered HTTP 502: simulator-refused (simulator-busy): one circuit at a time",
    );
  });
});
