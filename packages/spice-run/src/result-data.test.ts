import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { classifySimulationOutcome, readNgspiceDiagnostics } from "./index.js";
import {
  readSimulationData,
  simulationAnalysisToCsv,
  type AcResult,
  type OperatingPointResult,
  type SimulationAnalysisResult,
  type SimulationDataReading,
  type TransientResult,
} from "./result-data.js";

/**
 * Every expectation in this file is arithmetic.
 *
 * The three fixtures were chosen because each circuit has an answer that can
 * be written down without a simulator, so nothing here is a recorded number
 * whose only authority is that this parser once produced it. A snapshot would
 * prove the reader is self-consistent; it would not prove it read the file.
 *
 * The circuits, from the decks beside the fixtures:
 *
 * - `divider-op`: 1 V across two 1 kΩ resistors.
 * - `rc-ac`: R = 1 kΩ, C = 1 µF driven by a 1 V AC source.
 * - `rc-tran`: the same network driven by `PULSE(0 1 0 1n 1n 10m 20m)`.
 */
const R1 = 1_000;
const C1 = 1e-6;
/** RC = 1 ms. */
const TAU = R1 * C1;
/** 1/(2*pi*R*C) = 159.1549... Hz. */
const F_CORNER = 1 / (2 * Math.PI * R1 * C1);
/** The PULSE card's rise time. The source ramps; it does not step. */
const RISE_SECONDS = 1e-9;

function fixture(name: string): string {
  return readFileSync(
    new URL(`../../../fixtures/ngspice-rawfile/${name}`, import.meta.url),
    "utf8",
  );
}

function read(name: string): SimulationDataReading {
  return readSimulationData(fixture(name));
}

function expectAnalyses(
  reading: SimulationDataReading,
): readonly SimulationAnalysisResult[] {
  if (reading.status !== "read") {
    throw new Error(
      `Expected numbers, but the reading was unusable: ${reading.diagnostics
        .map((diagnostic) => diagnostic.text)
        .join(" ")}`,
    );
  }
  expect(reading.data.schemaVersion).toBe(1);
  return reading.data.analyses;
}

function only<T extends SimulationAnalysisResult["analysis"]>(
  name: string,
  analysis: T,
): Extract<SimulationAnalysisResult, { analysis: T }> {
  const analyses = expectAnalyses(read(name));
  expect(analyses).toHaveLength(1);
  const first = analyses[0]!;
  expect(first.analysis).toBe(analysis);
  return first as Extract<SimulationAnalysisResult, { analysis: T }>;
}

function relative(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

/** The deck's own source: a 1 ns ramp from 0 V to 1 V, then flat. */
function pulseVolts(seconds: number): number {
  // Spelled as a multiplication rather than `t / RISE_SECONDS` because the two
  // differ by one ulp at five of the fixture's timesteps. That is a rounding
  // detail of this expected-value formula, not of the file: the assertion
  // below is bit-exact, so the spelling that matches how the value was
  // computed is the one that can be.
  return seconds <= RISE_SECONDS ? seconds * 1e9 : 1;
}

describe("an operating point", () => {
  it("is the scalar the divider arithmetic says it is", () => {
    const op = only("divider-op.raw", "op") satisfies OperatingPointResult;
    expect(op.plotName).toBe("Operating Point");
    expect(
      op.probes.map((probe) => [probe.name, probe.quantity, probe.unit]),
    ).toEqual([
      ["v(in)", "voltage", "V"],
      ["v(mid)", "voltage", "V"],
      ["i(v1)", "current", "A"],
    ]);

    const at = (name: string): number =>
      op.probes.find((probe) => probe.name === name)!.value;

    expect(at("v(in)")).toBe(1);
    // Two equal resistors across 1 V put exactly half of it on the middle
    // node, and the source carries 1 V / 2 kΩ out of its positive terminal.
    expect(at("v(mid)")).toBe(at("v(in)") / 2);
    expect(at("v(mid)")).toBe(0.5);
    expect(at("i(v1)")).toBe(-at("v(in)") / (2 * R1));
    expect(at("i(v1)")).toBe(-0.0005);
  });
});

describe("an operating point written with an explicit vector list", () => {
  // `write file v(in) v(mid) i(v1)` is how a compiled setup asks for exactly
  // its probes. ngspice 46 answers by writing the plot's scale first, and an
  // operating point's scale is its first vector, so the file carries v(in)
  // twice (see the fixture's Variables block). A table with the same probe
  // on two rows is what a reader sees if it takes the file at its word.
  it("reads each probe once and the same numbers as the unlisted write", () => {
    const listed = only("divider-op-listed.raw", "op");
    const whole = only("divider-op.raw", "op");
    expect(listed.probes.map((probe) => probe.name)).toEqual([
      "v(in)",
      "v(mid)",
      "i(v1)",
    ]);
    expect(listed.probes).toEqual(whole.probes);
  });

  it("still refuses a file that gives one probe two different values", () => {
    const contradiction = fixture("divider-op-listed.raw").replace(
      /(Values:\n 0\t)(\S+)/u,
      (_, head: string, value: string) => `${head}${Number(value) + 1}`,
    );
    const reading = readSimulationData(contradiction);
    expect(reading.status).toBe("unusable");
    if (reading.status === "unusable") {
      expect(reading.diagnostics.map((d) => d.text).join(" ")).toMatch(
        /two different values for "v\(in\)"/u,
      );
    }
  });
});

describe("an AC sweep", () => {
  const ac = (): AcResult => only("rc-ac.raw", "ac");
  const probe = (analysis: AcResult, name: string) =>
    analysis.probes.find((entry) => entry.name === name)!;

  it("matches 1/(1 + jf/fc) at all seventeen swept frequencies", () => {
    const analysis = ac();
    expect(analysis.frequencyHz).toHaveLength(17);
    const vin = probe(analysis, "v(in)");
    const vout = probe(analysis, "v(out)");

    let asserted = 0;
    let worstMagnitude = 0;
    let worstPhaseDegrees = 0;
    for (const [k, frequency] of analysis.frequencyHz.entries()) {
      // `ac dec 4 1 10k`: four points per decade from 1 Hz, so f = 10^(k/4).
      expect(relative(frequency, 10 ** (k / 4))).toBeLessThan(1e-12);
      // The source is 1 V at zero degrees at every frequency.
      expect(vin.real[k]).toBe(1);
      expect(vin.imag[k]).toBe(0);

      const x = frequency / F_CORNER;
      const denominator = 1 + x * x;
      const expectedReal = 1 / denominator;
      const expectedImag = -x / denominator;
      expect(relative(vout.real[k]!, expectedReal)).toBeLessThan(1e-12);
      expect(relative(vout.imag[k]!, expectedImag)).toBeLessThan(1e-12);

      // Magnitude and phase are computed here, by the test, from the real and
      // imaginary parts the protocol carries. The protocol does not offer
      // them: what a magnitude means depends on a testbench it never sees.
      worstMagnitude = Math.max(
        worstMagnitude,
        relative(
          Math.hypot(vout.real[k]!, vout.imag[k]!),
          Math.hypot(expectedReal, expectedImag),
        ),
      );
      worstPhaseDegrees = Math.max(
        worstPhaseDegrees,
        Math.abs(
          (Math.atan2(vout.imag[k]!, vout.real[k]!) -
            Math.atan2(expectedImag, expectedReal)) *
            (180 / Math.PI),
        ),
      );
      asserted += 1;
    }

    // The whole sweep, not one point near the corner. Measured agreement is
    // 4.7e-16 in magnitude and 2.1e-14 degrees, which is machine precision.
    expect(asserted).toBe(17);
    expect(worstMagnitude).toBeLessThan(1e-12);
    expect(worstPhaseDegrees).toBeLessThan(1e-12);
  });

  it("keeps every point's current consistent with Ohm's law on R1", () => {
    const analysis = ac();
    const vin = probe(analysis, "v(in)");
    const vout = probe(analysis, "v(out)");
    const current = probe(analysis, "i(v1)");
    // Ties all four columns together at every point in complex arithmetic: a
    // reader that mismatched a column or a point would fail here even where
    // each column on its own looked plausible.
    for (let k = 0; k < analysis.frequencyHz.length; k += 1) {
      const expectedReal = -(vin.real[k]! - vout.real[k]!) / R1;
      const expectedImag = -(vin.imag[k]! - vout.imag[k]!) / R1;
      const residual = Math.hypot(
        current.real[k]! - expectedReal,
        current.imag[k]! - expectedImag,
      );
      expect(residual / Math.hypot(expectedReal, expectedImag)).toBeLessThan(
        1e-12,
      );
    }
  });

  it("offers a complex point and never a magnitude to mistake for a gain", () => {
    const vout = probe(ac(), "v(out)");
    expect(Object.keys(vout).sort()).toEqual([
      "imag",
      "name",
      "quantity",
      "real",
      "unit",
    ]);
    expect(vout.real).toHaveLength(17);
    expect(vout.imag).toHaveLength(17);
    expect(vout.unit).toBe("V");
  });
});

describe("a transient run", () => {
  const tran = (): TransientResult => only("rc-tran.raw", "tran");
  const probe = (analysis: TransientResult, name: string) =>
    analysis.probes.find((entry) => entry.name === name)!;

  it("carries the simulator's own timesteps, which span a factor of eight million", () => {
    const analysis = tran();
    expect(analysis.timeSeconds).toHaveLength(79);
    expect(analysis.timeSeconds[0]).toBe(0);
    expect(analysis.timeSeconds[1]).toBe(1e-11);
    expect(analysis.timeSeconds[78]).toBe(0.004);

    const steps = analysis.timeSeconds
      .slice(1)
      .map((time, index) => time - analysis.timeSeconds[index]!);
    expect(Math.min(...steps)).toBe(1e-11);
    expect(Math.max(...steps)).toBeCloseTo(8e-5, 12);
    // ngspice chose these. Any reader that treats a transient run as evenly
    // spaced is wrong by this factor, and wrong silently.
    expect(Math.max(...steps) / Math.min(...steps)).toBeGreaterThan(7.9e6);
  });

  it("recovers the file's time points, which a reconstructed grid would not", () => {
    const analysis = tran();
    const vin = probe(analysis, "v(in)");

    // v(in) is the deck's own PULSE card, so its value at each recovered time
    // is known exactly without a simulator. Evaluated at the times this parse
    // produced, it reproduces the file's v(in) column to the last bit at all
    // 79 points — which it could not do if any time had been reconstructed.
    for (const [index, time] of analysis.timeSeconds.entries()) {
      expect(vin.value[index]).toBe(pulseVolts(time));
    }

    // The grid a stride-assuming reader would build instead: it puts the
    // second point at 51 µs, where the source has long since finished its
    // 1 ns ramp, and so would claim v(in) was 1 V when the file says 0.01 V.
    const reconstructed = analysis.timeSeconds.map(
      (_, index) => (index * 0.004) / 78,
    );
    expect(reconstructed[1]).toBeGreaterThan(5e-5);
    expect(pulseVolts(reconstructed[1]!)).toBe(1);
    expect(vin.value[1]).toBe(0.01);
  });

  it("keeps every point's current consistent with Ohm's law on R1", () => {
    const analysis = tran();
    const vin = probe(analysis, "v(in)");
    const vout = probe(analysis, "v(out)");
    const current = probe(analysis, "i(v1)");
    for (let index = 0; index < analysis.timeSeconds.length; index += 1) {
      const expected = -(vin.value[index]! - vout.value[index]!) / R1;
      if (expected === 0) {
        expect(current.value[index]).toBe(0);
        continue;
      }
      expect(relative(current.value[index]!, expected)).toBeLessThan(1e-12);
    }
  });

  it("matches the step response 1 - exp(-t/tau) once the source has stepped", () => {
    const analysis = tran();
    const vout = probe(analysis, "v(out)");

    // The domain is stated rather than tuned. The ideal step response
    // describes this circuit only after the source has finished its 1 ns
    // ramp, and the deck ramps: at t = 10 ps the file's v(in) is 0.01 V, not
    // 1 V, so comparing there measures the difference between two circuits
    // and not the accuracy of anything. From 1 µs — a thousand rise times
    // after the ramp, and still a thousandth of tau — the comparison is the
    // circuit's.
    const domain = analysis.timeSeconds
      .map((time, index) => ({ time, index }))
      .filter((point) => point.time >= 1e-6);
    expect(domain).toHaveLength(57);

    let worst = 0;
    for (const point of domain) {
      const ideal = 1 - Math.exp(-point.time / TAU);
      worst = Math.max(worst, relative(vout.value[point.index]!, ideal));
    }
    expect(worst).toBeLessThan(1e-3);
    // Measured 4.76e-4, and the residual has two identifiable causes with
    // opposite signs; neither is the parser, and the assertions below pin
    // which is which so a future tolerance change has to argue with physics.
    expect(worst).toBeGreaterThan(4e-4);
  });

  it("attributes the step-response residual to the deck, not to the reader", () => {
    const analysis = tran();
    const vout = probe(analysis, "v(out)");
    const ideal = (time: number): number => 1 - Math.exp(-time / TAU);

    // Cause one, dominant early. A ramp of duration t_r integrated by an RC
    // leaves the output permanently below the ideal step by t_r/(2*tau) —
    // here 5e-7 V. While t is still far below tau the ideal value is small,
    // so that fixed deficit is the whole relative error: 5e-7 / 1.05e-3 is
    // the 4.8e-4 measured at the first asserted point.
    const deficit = RISE_SECONDS / (2 * TAU);
    expect(deficit).toBe(5e-7);
    for (const [index, time] of analysis.timeSeconds.entries()) {
      if (time < 1e-6 || time > 1e-5) continue;
      const signed = ideal(time) - vout.value[index]!;
      expect(relative(signed, deficit)).toBeLessThan(0.05);
    }

    // Cause two, dominant late and of the opposite sign: trapezoidal
    // integration over 80 µs steps on a 1 ms time constant overshoots. At the
    // end of the run the output is ABOVE the ideal curve, which the rise time
    // alone can never produce.
    const last = analysis.timeSeconds.length - 1;
    const overshoot = vout.value[last]! - ideal(analysis.timeSeconds[last]!);
    expect(overshoot).toBeGreaterThan(0);
    expect(
      relative(vout.value[last]!, ideal(analysis.timeSeconds[last]!)),
    ).toBeLessThan(1e-4);
  });
});

describe("a run that produced no numbers", () => {
  it("calls an absent rawfile unusable rather than an empty success", () => {
    const reading = readSimulationData("");
    expect(reading.status).toBe("unusable");
    expect(reading.diagnostics).toHaveLength(1);
    expect(reading.diagnostics[0]!.severity).toBe("error");
    expect(reading.diagnostics[0]!.text).toContain("no vectors");
  });

  it("calls a plot with no points unusable", () => {
    const empty = fixture("divider-op.raw")
      .replace("No. Points: 1", "No. Points: 0")
      .replace(/Values:[\s\S]*$/u, "Values:\n");
    const reading = readSimulationData(empty);
    expect(reading.status).toBe("unusable");
    expect(reading.diagnostics[0]!.text).toContain("nothing in it to read");
  });

  it("is a failure even when the simulator exited zero and logged normally", () => {
    // The measured shape of this trap: ngspice returns 0, prints a plausible
    // batch log, and leaves nothing behind. Since #572 an exit code is not a
    // verdict at all, so nothing about the process can catch this -- only the
    // rawfile can. The reading's own error diagnostic is what carries it into
    // the outcome the rest of the pipeline sees.
    const log = [
      "Circuit: * rc low pass",
      "",
      "Doing analysis at TEMP = 27.000000 and TNOM = 27.000000",
      "No. of Data Rows : 0",
    ].join("\n");
    const reading = readSimulationData("");
    expect(reading.status).toBe("unusable");

    expect(
      classifySimulationOutcome(readNgspiceDiagnostics(log), {
        timedOut: false,
        timeoutMs: 30_000,
      }),
    ).toEqual({ status: "completed" });

    expect(
      classifySimulationOutcome(
        [...readNgspiceDiagnostics(log), ...reading.diagnostics],
        { timedOut: false, timeoutMs: 30_000 },
      ),
    ).toEqual({ status: "failed" });
  });

  it("never reports a reading that succeeded with nothing in it", () => {
    // A plot this release does not read, alone in the file. There is nothing
    // to show, so this is unusable — not `read` with an empty list, which is
    // the same blank chart by another route.
    const unknown = fixture("divider-op.raw").replace(
      "Plotname: Operating Point",
      "Plotname: DC transfer characteristic",
    );
    const reading = readSimulationData(unknown);
    expect(reading.status).toBe("unusable");
    expect(reading.diagnostics[0]!.severity).toBe("error");
    expect(reading.diagnostics[0]!.text).toContain(
      "DC transfer characteristic",
    );
  });

  it("reads the plots it knows and names the one it skipped", () => {
    const unknown = fixture("divider-op.raw").replace(
      "Plotname: Operating Point",
      "Plotname: DC transfer characteristic",
    );
    const reading = readSimulationData(unknown + fixture("rc-tran.raw"));
    const analyses = expectAnalyses(reading);
    expect(analyses.map((analysis) => analysis.analysis)).toEqual(["tran"]);
    if (reading.status !== "read") throw new Error("unreachable");
    expect(reading.diagnostics).toHaveLength(1);
    expect(reading.diagnostics[0]!.severity).toBe("warning");
    expect(reading.diagnostics[0]!.text).toContain(
      "DC transfer characteristic",
    );
  });

  it("refuses an AC plot whose sweep axis is missing", () => {
    const noAxis = fixture("rc-ac.raw").replace(
      "\t0\tfrequency\tfrequency grid=3",
      "\t0\tfrequency\tvoltage",
    );
    const reading = readSimulationData(noAxis);
    expect(reading.status).toBe("unusable");
    expect(reading.diagnostics[0]!.text).toContain("sweep axis is unknown");
  });
});

describe("CSV derived from the same parse", () => {
  const rows = (csv: string): string[] => {
    expect(csv.endsWith("\n")).toBe(true);
    return csv.trimEnd().split("\n");
  };

  it("writes an operating point as one row per probe, with units", () => {
    const csv = simulationAnalysisToCsv(only("divider-op.raw", "op"));
    expect(rows(csv)).toEqual([
      "variable,value,unit",
      "v(in),1,V",
      "v(mid),0.5,V",
      "i(v1),-0.0005,A",
    ]);
  });

  it("keeps both parts of every AC point and never a magnitude", () => {
    const analysis = only("rc-ac.raw", "ac");
    const lines = rows(simulationAnalysisToCsv(analysis));
    expect(lines[0]).toBe(
      "frequency [Hz],re(v(in)) [V],im(v(in)) [V],re(v(out)) [V],im(v(out)) [V],re(i(v1)) [A],im(i(v1)) [A]",
    );
    expect(lines).toHaveLength(18);

    // Read the file back and compare with the analysis it was derived from.
    // Exact equality, not a tolerance: a CSV that rounded would be a second,
    // quieter answer to the same question.
    for (const [point, line] of lines.slice(1).entries()) {
      const cells = line.split(",").map(Number);
      expect(cells[0]).toBe(analysis.frequencyHz[point]);
      const vout = analysis.probes.find((p) => p.name === "v(out)")!;
      expect(cells[3]).toBe(vout.real[point]);
      expect(cells[4]).toBe(vout.imag[point]);
    }
  });

  it("keeps the transient run's own time points", () => {
    const analysis = only("rc-tran.raw", "tran");
    const lines = rows(simulationAnalysisToCsv(analysis));
    expect(lines[0]).toBe("time [s],v(in) [V],v(out) [V],i(v1) [A]");
    expect(lines).toHaveLength(80);

    const times = lines.slice(1).map((line) => Number(line.split(",")[0]));
    // The uneven grid survives the round trip exactly, including the 10 ps
    // first step that a re-derived time column would lose.
    expect(times).toEqual([...analysis.timeSeconds]);
    expect(times[1]).toBe(1e-11);

    const vout = analysis.probes.find((probe) => probe.name === "v(out)")!;
    const column = lines.slice(1).map((line) => Number(line.split(",")[2]));
    expect(column).toEqual([...vout.value]);
  });

  it("quotes a field that would otherwise split a row", () => {
    // ngspice's vector names have no commas today. If one ever arrives, the
    // row keeps its shape instead of gaining a column.
    const analysis: OperatingPointResult = {
      analysis: "op",
      plotName: "Operating Point",
      probes: [
        { name: "v(a,b)", quantity: "voltage", unit: "V", value: 0.25 },
        { name: 'v("q")', quantity: "voltage", unit: "V", value: -1 },
      ],
    };
    expect(rows(simulationAnalysisToCsv(analysis))).toEqual([
      "variable,value,unit",
      '"v(a,b)",0.25,V',
      '"v(""q"")",-1,V',
    ]);
  });
});
