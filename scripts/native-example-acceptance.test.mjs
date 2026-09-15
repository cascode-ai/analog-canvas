import { describe, it, expect } from "vitest";
import {
  analyzeNativeExampleRuns,
  validateNativeExampleResult,
  validateNoiseIntegral,
  unwrappedPhase,
  distortion,
} from "./lib/native-example-acceptance.mjs";

const frame = () => ({
  outcome: { status: "completed" },
  metadata: {
    environment: { simulator: { name: "vacask" }, fingerprint: "a".repeat(64) },
  },
  data: {
    analyses: [
      {
        analysis: "tran",
        timeSeconds: [0, 1],
        probes: [{ name: "out", value: [0, 1] }],
      },
    ],
  },
});

describe("native starter acceptance evidence", () => {
  it("requires all nineteen experiments rather than an empty/subset success", () => {
    expect(() => analyzeNativeExampleRuns(new Map())).toThrow("all 19");
    expect(() => analyzeNativeExampleRuns(new Map([["cs-op", {}]]))).toThrow(
      "all 19",
    );
  });
  it("accepts complete native frames, not receipts or foreign simulator identities", () => {
    expect(validateNativeExampleResult(frame())).toHaveLength(1);
    const r = frame();
    delete r.data;
    expect(() => validateNativeExampleResult(r)).toThrow("artifact");
    const old = frame();
    old.metadata.environment.simulator.name = "ngspice";
    expect(() => validateNativeExampleResult(old)).toThrow("VACASK");
  });
  it.each(["axis", "length", "nonfinite", "measurement", "outcome"])(
    "rejects incomplete %s evidence",
    (mode) => {
      const r = frame(),
        a = r.data.analyses[0],
        measurements = [];
      if (mode === "axis") a.timeSeconds = [0, 0];
      if (mode === "length") a.probes[0].value = [0];
      if (mode === "nonfinite") a.probes[0].value[1] = NaN;
      if (mode === "measurement")
        measurements.push({ name: "gain", status: "failed" });
      if (mode === "outcome") r.outcome.status = "failed";
      expect(() => validateNativeExampleResult(r, measurements)).toThrow();
    },
  );
  it("unwraps complex phase across the negative real axis without using an ngspice phase vector", () => {
    const degrees = [-170, 170, 150],
      radians = degrees.map((x) => (x * Math.PI) / 180);
    const phase = unwrappedPhase({
      real: radians.map(Math.cos),
      imag: radians.map(Math.sin),
    });
    phase.forEach((v, i) => expect(v).toBeCloseTo([-170, -190, -210][i], 10));
  });
  it("checks PSD integration, not the historical number of raw noise plots", () => {
    const noise = {
      frequencyHz: [1, 2, 4],
      inputNoiseDensity: [2, 2, 2],
      outputNoiseDensity: [3, 3, 3],
      integratedInputNoise: Math.sqrt(12),
      integratedOutputNoise: Math.sqrt(27),
      integrationMethod: "trapezoidal-psd",
    };
    expect(() => validateNoiseIntegral(noise)).not.toThrow();
    expect(() =>
      validateNoiseIntegral({ ...noise, integratedOutputNoise: 3 }),
    ).toThrow("PSD");
    expect(() =>
      validateNoiseIntegral({ ...noise, integrationMethod: "ngspice" }),
    ).toThrow("per-source");
  });
  it("measures harmonic distortion and rejects short waveforms instead of extrapolating", () => {
    const time = Array.from({ length: 4097 }, (_, i) => (i * 400e-6) / 4096);
    const values = time.map(
      (t) =>
        1 +
        Math.sin(2 * Math.PI * 1e4 * t) +
        0.1 * Math.sin(4 * Math.PI * 1e4 * t),
    );
    const r = distortion(time, values);
    expect(r.harmonicsV[0]).toBeCloseTo(1, 8);
    expect(r.thd2to5).toBeCloseTo(0.1, 8);
    expect(() => distortion(time.slice(0, -2), values.slice(0, -2))).toThrow(
      "window",
    );
    expect(() =>
      distortion(
        time,
        time.map(() => 0),
      ),
    ).toThrow("fundamental");
  });
});
