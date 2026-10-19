import { describe, expect, it } from "vitest";

import { convertNetlist } from "./conversion.js";
import { importSpiceSources } from "./importer.js";

const file = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});

/**
 * The parameters the import gives each source of a SPICE deck, by reference.
 * The deck's cards are the body of a subcircuit, since a source on the deck's
 * own top level belongs to a testbench's run, not to a Cell.
 */
async function sources(body: string) {
  const text = `.subckt top\n${body}\n.ends top\n`;
  const result = await importSpiceSources([file("deck.sp", text)], "deck.sp");
  expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
  return Object.fromEntries(
    result.project!.documents.flatMap((document) =>
      document.instances
        .filter((instance) =>
          ["voltage-source", "current-source"].includes(instance.symbolId),
        )
        .map((instance) => [instance.reference, instance.netlist?.parameters]),
    ),
  );
}

const PULSE_FIELDS = {
  waveform: "pulse",
  low: "0.9",
  high: "0.91",
  delay: "1u",
  rise: "1n",
  fall: "1n",
  width: "1u",
  period: "3u",
};

// A Canvas source keeps its DC value, its AC magnitude and phase and its
// transient function apart, and its value label shows the DC value; the card's
// whole tail used to come in as the DC value (0.9 AC 1 0 PULSE(...)).
describe("an independent source's card tail in the SPICE import", () => {
  it("splits the DC value, the AC clause and the function into the source's fields", async () => {
    const found = await sources(
      [
        "V1 a 0 DC 0.9 AC 1 0 PULSE(0.9 0.91 1u 1n 1n 1u 3u)",
        "V2 b 0 0.9 AC 1 PULSE(0.9 0.91 1u 1n 1n 1u 3u)",
        "V3 c 0 DC 0.9 SIN(0.9 10m 1Meg)",
        "V4 d 0 AC 1 0.5",
        "I1 e 0 DC 15u PWL(0 0 1u 1 2u 0)",
        "I2 f 0 SIN(0 1u 1k 1n 0 90)",
        "R1 a b 1k",
        "R2 c d 1k",
        "R3 e f 1k",
        "",
      ].join("\n"),
    );
    expect(found.V1).toEqual({
      dc: "0.9",
      acMagnitude: "1",
      acPhase: "0",
      ...PULSE_FIELDS,
    });
    expect(found.V2).toEqual({ dc: "0.9", acMagnitude: "1", ...PULSE_FIELDS });
    expect(found.V3).toEqual({
      dc: "0.9",
      waveform: "sin",
      offset: "0.9",
      amplitude: "10m",
      frequency: "1Meg",
    });
    // No DC value is invented where the card has none.
    expect(found.V4).toEqual({ acMagnitude: "1", acPhase: "0.5" });
    expect(found.I1).toEqual({
      dc: "15u",
      waveform: "pwl",
      pwlPoints: "0 0, 1u 1, 2u 0",
    });
    expect(found.I2).toEqual({
      waveform: "sin",
      offset: "0",
      amplitude: "1u",
      frequency: "1k",
      delay: "1n",
      damping: "0",
      phase: "90",
    });
  });

  it("leaves a plain DC source, and a tail that fits no field, as it was", async () => {
    const found = await sources(
      [
        "V1 a 0 1.8",
        "V2 b 0 DC 1.8",
        // Six arguments: the seventh would default; the source keeps its text.
        "V3 c 0 DC 0 PULSE(0 1 0 1n 1n 1u)",
        "V4 d 0 EXP(0 1 1n 1n 2n 1n)",
        "R1 a b 1k",
        "R2 c d 1k",
        "",
      ].join("\n"),
    );
    expect(found.V1).toEqual({ dc: "1.8" });
    expect(found.V2).toEqual({ dc: "1.8" });
    expect(found.V3).toEqual({ dc: "0 PULSE(0 1 0 1n 1n 1u)" });
    expect(found.V4).toEqual({ dc: "EXP(0 1 1n 1n 2n 1n)" });
  });

  it("reads the same source from a Spectre card", async () => {
    const spectre = [
      "V1 (a 0) vsource dc=0.9 mag=1 phase=0 type=pulse val0=0.9 val1=0.91 delay=1u rise=1n fall=1n width=1u period=3u",
      "V2 (b 0) vsource dc=0.9 type=sine ampl=10m freq=1M",
      "I1 (c 0) isource dc=15u",
      "R1 (a b) resistor r=1k",
      "R2 (b c) resistor r=1k",
    ].join("\n");
    const converted = convertNetlist({
      text: spectre,
      source: "spectre",
      target: "spice",
      fragment: true,
    });
    expect(converted.status).toBe("converted");
    if (converted.status !== "converted") return;
    // The numbers keep their digits and suffixes; Spectre's M is mega, which
    // SPICE writes Meg.
    expect(converted.text).toContain(
      "V1 a 0 DC 0.9 AC 1 0 PULSE(0.9 0.91 1u 1n 1n 1u 3u)",
    );
    expect(converted.text).toContain("1Meg");
    const found = await sources(converted.text);
    expect(found.V1).toEqual({
      dc: "0.9",
      acMagnitude: "1",
      acPhase: "0",
      ...PULSE_FIELDS,
    });
    expect(found.V2).toMatchObject({
      dc: "0.9",
      waveform: "sin",
      amplitude: "10m",
      frequency: "1Meg",
    });
    expect(found.I1).toEqual({ dc: "15u" });
  });
});
