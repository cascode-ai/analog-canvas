import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simulationAnalysisToCsv } from "./result-data.js";
import { SimulationResultDataSchema } from "./result-schema.js";
import {
  readVacaskSimulationData,
  type VacaskPlotProjection,
} from "./vacask-result-data.js";

const fixture = (file: string) =>
  readFileSync(
    new URL(`../../../netlists/vacask-resistor-noise/${file}`, import.meta.url),
    "utf8",
  );
const voltage = fixture("resistor_noise.raw");
const current = fixture("current_noise.raw");
const projection = (
  inputQuantity: "voltage" | "current" = "voltage",
): Extract<VacaskPlotProjection, { analysis: "noise" }> => ({
  artifactPath: "noise.raw",
  plotOrdinal: 0,
  analysis: "noise",
  axis: "frequency",
  outputPsd: "onoise",
  powerGain: "gain",
  inputQuantity,
});
function read(
  text = voltage,
  inputQuantity: "voltage" | "current" = "voltage",
) {
  const reading = readVacaskSimulationData(
    [{ path: "noise.raw", text }],
    [projection(inputQuantity)],
  );
  if (
    reading.status !== "read" ||
    reading.data.analyses[0]?.analysis !== "noise"
  )
    throw Error(JSON.stringify(reading));
  expect(SimulationResultDataSchema.safeParse(reading.data).success).toBe(true);
  return { noise: reading.data.analyses[0], diagnostics: reading.diagnostics };
}
const closeRelative = (actual: number | null | undefined, expected: number) => {
  if (actual == null) throw Error("Expected finite noise value");
  expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-12);
};

// Authored analytical adapter input, not a claimed simulator capture.
function analyticalSpectrum(
  frequency: number[],
  psd: number[],
  gain: number[],
) {
  return `Title: Analytical noise integration
Date: analytical test input
Plotname: noise
Flags: real
No. Variables: 3
No. Points: ${frequency.length}
Variables:
0 frequency frequency
1 onoise notype
2 gain notype
Values:
${frequency.map((f, i) => `${i} ${f}\n ${psd[i]}\n ${gain[i]}`).join("\n")}
`;
}

describe("native noise numerical semantics", () => {
  it.each(["voltage", "current"] as const)(
    "qualifies captured %s-input output against 4kTR",
    (quantity) => {
      const { noise, diagnostics } = read(
        quantity === "voltage" ? voltage : current,
        quantity,
      );
      // The pinned compiler's embedded constants.vams defaults to NIST1998
      // P_K=1.3806503e-23; native resistor.va uses that macro. Keep numerical
      // projection tolerance separate from the existing 1e-5 physical check
      // against today's SI constant (scripts/vacask-qualification.mjs).
      const psd = 4 * 1.3806503e-23 * 300 * 1000;
      expect(Math.abs(psd / (4 * 1.380649e-23 * 300 * 1000) - 1)).toBeLessThan(
        1e-5,
      );
      const density = Math.sqrt(psd);
      const gain = quantity === "voltage" ? 1 : 1e6;
      const inputDensity = density / Math.sqrt(gain);
      noise.outputNoiseDensity.forEach((v) => closeRelative(v, density));
      noise.inputNoiseDensity.forEach((v) => closeRelative(v, inputDensity));
      const bandwidth = noise.frequencyHz.at(-1)! - noise.frequencyHz[0]!;
      closeRelative(
        noise.integratedOutputNoise,
        density * Math.sqrt(bandwidth),
      );
      closeRelative(
        noise.integratedInputNoise,
        inputDensity * Math.sqrt(bandwidth),
      );
      expect(noise.integrationMethod).toBe("trapezoidal-psd");
      expect(noise.units.inputDensity).toBe(
        quantity === "voltage" ? "V/sqrt(Hz)" : "A/sqrt(Hz)",
      );
      expect(noise.probes?.map((v) => v.name)).toEqual([
        "onoise",
        "gain",
        "n(R1)",
      ]);
      expect(noise.probes?.find((v) => v.name === "gain")).toMatchObject({
        unit: quantity === "voltage" ? "1" : "V²/A²",
        value: Array(13).fill(gain),
      });
      expect(diagnostics).toEqual([]);
      const csv = simulationAnalysisToCsv(noise);
      expect(csv).toContain("sampled PSD, trapezoidal");
      expect(csv).toContain("onoise [V²/Hz]");
      expect(csv).toContain("n(R1)");
    },
  );

  it("protects the unmodified current-reference bytes", () => {
    expect(createHash("sha256").update(current).digest("hex")).toBe(
      "36f873547a76ee361e0a01b529ee24277754332b54c866ff3c4825f8eaa85a10",
    );
  });

  it("integrates varying PSD, not the displayed amplitude density", () => {
    // A two-sample analytical spectrum: area = (1 + 9) / 2 * 10 = 50.
    // This is adapter test input, not a claimed simulator capture.
    const { noise } = read(`Title: Analytical spectrum
Date: analytical test input
Plotname: test_noise
Flags: real
No. Variables: 3
No. Points: 2
Variables:
0 frequency frequency
1 onoise notype
2 gain notype
Values:
0 10
 1
 4
1 20
 9
 4
`);
    expect(noise.outputNoiseDensity).toEqual([1, 3]);
    expect(noise.inputNoiseDensity).toEqual([0.5, 1.5]);
    closeRelative(noise.integratedOutputNoise, Math.sqrt(50));
    closeRelative(noise.integratedInputNoise, Math.sqrt(12.5));
  });

  it("preserves output noise when one input-referral point is undefined", () => {
    // Fault injection into a copy; the authoritative native fixture is unchanged.
    const { noise, diagnostics } = read(
      voltage.replace("\t1.000000000000000e+00\n", "\t0.000000000000000e+00\n"),
    );
    expect(noise.inputNoiseDensity[0]).toBeNull();
    expect(noise.inputNoiseDensity.slice(1).every((v) => v !== null)).toBe(
      true,
    );
    expect(noise.integratedInputNoise).toBeUndefined();
    expect(noise.integratedOutputNoise).toBeGreaterThan(0);
    expect(diagnostics.map((d) => d.text).join("\n")).toContain(
      "gaps, not zero",
    );
    const csv = simulationAnalysisToCsv(noise).split("\n");
    expect(csv[1]!.split(",")[2]).toBe("");
    expect(csv.find((line) => line.startsWith("input-referred noise,"))).toBe(
      "input-referred noise,,V",
    );
  });

  it("refers each endpoint through its own power gain before integrating", () => {
    // Flat output PSD, changing gain: input PSD endpoints are 0.01 and 0.04.
    // Using the right-end gain for the whole interval would wrongly yield 0.4.
    const { noise } = read(analyticalSpectrum([10, 20], [1, 1], [100, 25]));
    closeRelative(noise.integratedOutputNoise, Math.sqrt(10));
    closeRelative(noise.integratedInputNoise, Math.sqrt(0.25));
    expect(noise.inputNoiseDensity).toEqual([0.1, 0.2]);
  });

  it("converges to the closed-form 1/f integral as log sampling is refined", () => {
    const exact = Math.sqrt(Math.log(100));
    const error = (pointsPerDecade: number) => {
      const frequency = Array.from(
        { length: 2 * pointsPerDecade + 1 },
        (_, i) => 10 ** (i / pointsPerDecade),
      );
      const { noise } = read(
        analyticalSpectrum(
          frequency,
          frequency.map((f) => 1 / f),
          frequency.map(() => 1),
        ),
      );
      expect(noise.integratedOutputNoise).toBe(noise.integratedInputNoise);
      return noise.integratedOutputNoise! / exact - 1;
    };
    // Convex PSD makes the trapezoidal estimate an overestimate; its error
    // decreases quadratically. An ngspice-reported integral is not the oracle
    // for this explicitly labelled sampled-spectrum numerical method.
    const coarse = error(20),
      fine = error(200);
    expect(coarse).toBeGreaterThan(0);
    expect(coarse).toBeLessThan(0.002);
    expect(fine).toBeGreaterThan(0);
    expect(fine).toBeLessThan(coarse / 90);
    expect(fine).toBeLessThan(0.00002);
  });

  it("does not infer bandwidth from a single frequency", () => {
    const one = voltage.split("\n 1\t")[0]! + "\n";
    const { noise, diagnostics } = read(
      one.replace(/No\. Points: 13\s*\n/, "No. Points: 1\n"),
    );
    expect(noise.frequencyHz).toEqual([10]);
    expect(noise.integratedOutputNoise).toBeUndefined();
    expect(noise.integratedInputNoise).toBeUndefined();
    expect(diagnostics[0]?.text).toContain(
      "at least two increasing frequencies",
    );
  });

  it("does not sort or integrate across a repeated frequency", () => {
    const { noise } = read(
      voltage.replace("1.778279410038924e+01", "1.000000000000000e+01"),
    );
    expect(noise.frequencyHz.slice(0, 2)).toEqual([10, 10]);
    expect(noise.integratedOutputNoise).toBeUndefined();
    expect(noise.outputNoiseDensity).toHaveLength(13);
  });

  it("rejects negative total PSD and ambiguous role assignments", () => {
    for (const [text, plan] of [
      [
        voltage.replace("1.656780360000000e-17", "-1.656780360000000e-17"),
        projection(),
      ],
      [voltage, { ...projection(), outputPsd: "gain" }],
    ] as const)
      expect(
        readVacaskSimulationData([{ path: "noise.raw", text }], [plan]).status,
      ).toBe("unusable");
  });
});
