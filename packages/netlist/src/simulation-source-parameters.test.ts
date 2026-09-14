import { describe, expect, it } from "vitest";
import { parseEditableSourceParameters } from "./simulation-source-parameters.js";

describe("reversible independent-source clauses", () => {
  it("keeps DC, AC and transient clauses independent with native expressions", () => {
    expect(
      parseEditableSourceParameters(
        ' dc=(BIAS) mag=(GAIN) phase=-90 type="sine" sinedc=0 ampl=1 freq=1k ',
      ),
    ).toEqual({
      ok: true,
      parameters: {
        dc: "{BIAS}",
        acMagnitude: "{GAIN}",
        acPhase: "-90",
        waveform: "sin",
        offset: "0",
        amplitude: "1",
        frequency: "1000",
      },
    });
    expect(
      parseEditableSourceParameters(
        'dc=1.8 type="sine" sinedc=0 ampl=1 freq=1k mag=2',
      ),
    ).toMatchObject({
      ok: true,
      parameters: { dc: "1.8", acMagnitude: "2", waveform: "sin" },
    });
  });
  it("parses PWL pairs and complete PULSE clauses without inventing timestep defaults", () => {
    expect(
      parseEditableSourceParameters('dc=0 type="pwl" wave=[0,LOW,1n,HIGH]'),
    ).toMatchObject({
      ok: true,
      parameters: { pwlPoints: "0 {LOW}, 1e-9 {HIGH}", waveform: "pwl" },
    });
    expect(
      parseEditableSourceParameters(
        'dc=0 mag=1 type="pulse" val0=0 val1=1 delay=0 rise=1n fall=1n width=5n period=10n',
      ),
    ).toMatchObject({
      ok: true,
      parameters: { waveform: "pulse", period: "1e-8" },
    });
  });
  it.each([
    "dc=1 mag=",
    "dc=1 dc=2",
    "dc=1 phase=-90",
    'dc=1 type="pwl" wave=[0,1,2]',
    'dc=1 type="sine" sinedc=0 ampl=1',
    'dc=1 type="pulse" val0=0 val1=1',
    "dc=(BIAS;quit)",
    "dc=(BIAS) Rnew",
    "dc=1 // comment",
    "dc=1 unknown=2",
    "dc=1 constructor=2",
    "dc=1 toString=2",
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
