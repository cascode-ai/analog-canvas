import { describe, expect, it } from "vitest";
import { parseEditableSourceParameters } from "./simulation-source-parameters.js";

describe("reversible independent-source clauses", () => {
  it("keeps DC, AC and transient clauses independent with native expressions", () => {
    expect(
      parseEditableSourceParameters(" DC {BIAS} AC {GAIN} -90 SIN(0 1 1k) "),
    ).toEqual({
      ok: true,
      parameters: {
        dc: "{BIAS}",
        acMagnitude: "{GAIN}",
        acPhase: "-90",
        waveform: "sin",
        offset: "0",
        amplitude: "1",
        frequency: "1k",
      },
    });
    expect(
      parseEditableSourceParameters("1.8 SIN (0 1 1k) AC 2"),
    ).toMatchObject({
      ok: true,
      parameters: { dc: "1.8", acMagnitude: "2", waveform: "sin" },
    });
  });
  it("parses PWL pairs and complete PULSE clauses without inventing timestep defaults", () => {
    expect(
      parseEditableSourceParameters("DC 0 PWL(0 {LOW}, 1n {HIGH})"),
    ).toMatchObject({
      ok: true,
      parameters: { pwlPoints: "0 {LOW}, 1n {HIGH}", waveform: "pwl" },
    });
    expect(
      parseEditableSourceParameters("DC 0 AC 1\n+ PULSE(0 1 0 1n 1n 5n 10n)"),
    ).toMatchObject({
      ok: true,
      parameters: { waveform: "pulse", period: "10n" },
    });
  });
  it.each([
    "DC 1 AC",
    "DC 1 AC 1 AC 2",
    "DC 1\nR1 a 0 1k",
    "DC 1; quit",
    "DC {V;quit}",
    "DC 1 PWL(0 1 2)",
    "DC 1 SIN(0 1)",
    "DC 1 PULSE(0 1)",
    "DC 1 SIN(0 1 1k) SIN(0 2 1k)",
    "DC 1 Rnew",
    "DC 1 AC {A",
    "AC 1",
  ])("does not apply incomplete or unsupported clauses: %s", (text) => {
    expect(parseEditableSourceParameters(text).ok).toBe(false);
  });
});
