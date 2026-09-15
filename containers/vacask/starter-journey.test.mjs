import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { parseProject } from "../../packages/project-protocol/src/index.js";
import { compileSourceSimulation } from "../../packages/netlist/src/simulation-source-compile.js";
import {
  vacaskMeasurementPythonSource,
  vacaskPlotPythonSource,
} from "../../packages/netlist/src/vacask-postprocess.js";
import { SimulationService } from "../../packages/simulation-service/src/service.js";
import { SimulationFiles } from "../../packages/simulation-service/src/files.js";
import { CapabilitiesSchema } from "../../packages/simulation-service/src/contract.js";
import { initializeVacaskRuntime } from "./runtime.mjs";
import { executeVacask } from "./execute.mjs";
import { SimulationRunSupervisor } from "../ngspice/run-supervisor.mjs";
import {
  nativeSimulationDevices,
  nativeDeviceOpAcquisitions,
} from "../../packages/netlist/src/simulation-native-devices.js";
import { parseVacaskRawfile } from "../../packages/spice-run/src/vacask-rawfile.js";

const legacyLibraryOta = JSON.parse(
  await readFile(
    new URL(
      "../../netlists/native-ota-library/legacy-source.icproj.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function assertLibraryOtaResult(id, data, measurements) {
  const original = legacyLibraryOta.simulationSetups.find(
    (s) => s.id === id,
  ).input;
  const raw = data.analyses.filter((a) => !a.postprocessor);
  // Collection order follows artifact paths, not control-program statement order.
  expect(raw.map((a) => a.analysis).sort()).toEqual(
    original.analyses.map((a) => a.kind).sort(),
  );
  const get = (a, name) => a.probes.find((p) => p.name === name);
  const sample = (x, y, at) => {
    const i = x.findIndex((v) => v >= at);
    if (i < 0 || (i === 0 && x[i] !== at))
      throw Error("Outside returned samples");
    return x[i] === at
      ? y[i]
      : y[i - 1] + ((y[i] - y[i - 1]) * (at - x[i - 1])) / (x[i] - x[i - 1]);
  };
  for (const a of original.analyses) {
    const result = raw.find((r) => r.analysis === a.kind);
    if (a.kind === "dc") {
      expect(result.sweep.values.length).toBe(
        Math.round((a.stopValue - a.startValue) / a.stepValue) + 1,
      );
      result.sweep.values.forEach((x, i) => {
        expect(x).toBeCloseTo(a.startValue + i * a.stepValue, 10);
        if (id !== "simulation-setup-ota-op-ac")
          expect(get(result, "vinp").value[i]).toBeCloseTo(x, 10);
      });
    } else if (a.kind === "ac" || a.kind === "noise") {
      expect(result.frequencyHz.length).toBe(a.points * 9 + 1);
      expect(result.frequencyHz[0]).toBe(1);
      expect(result.frequencyHz.at(-1)).toBeCloseTo(1e9, 3);
    } else if (a.kind === "tran") {
      const time = result.timeSeconds,
        input = get(result, "vinp")?.value;
      expect(time.at(-1)).toBeCloseTo(a.stopSeconds, 12);
      expect(
        time.every(
          (t, i) =>
            !i ||
            t - time[i - 1] <= (a.maxStepSeconds ?? a.stepSeconds) * 1.000001,
        ),
      ).toBe(true);
      if (id === "simulation-setup-ota-op-ac") {
        // That historical folder requests only four output/internal voltages.
        expect(input).toBeUndefined();
      } else if (id.endsWith("sin-tt")) {
        time.forEach((t, i) =>
          expect(input[i]).toBeCloseTo(
            0.9 + 0.01 * Math.sin(2 * Math.PI * 1e6 * t),
            9,
          ),
        );
      } else {
        expect(sample(time, input, 0.5e-6)).toBeCloseTo(0.9, 9);
        expect(sample(time, input, 1.5e-6)).toBeCloseTo(0.91, 9);
      }
    }
  }
  if (original.deviceOperatingPoints?.length) {
    const op = raw.find((a) => a.analysis === "op");
    const parameters = op.probes.filter(
      (p) => p.name.startsWith("XDUT:XM") && p.name.includes("."),
    );
    expect(parameters).toHaveLength(18);
    expect(parameters.every((p) => Number.isFinite(p.value))).toBe(true);
    expect(new Set(parameters.map((p) => p.name.split(":")[1]))).toEqual(
      new Set(["XM1", "XM3"]),
    );
    for (const native of raw.filter((a) => a.analysis !== "noise")) {
      if (native.analysis !== "op")
        expect(
          native.probes.some(
            (p) => p.name.startsWith("XDUT:XM") && p.name.includes("."),
          ),
        ).toBe(false);
      const derived = data.analyses.find(
        (a) =>
          a.analysis === native.analysis &&
          a.postprocessor &&
          get(a, "I_supply"),
      );
      const supply = get(derived, "I_supply"),
        current = get(native, "VDD:flow(br)");
      expect(supply.unit).toBe("A");
      if (native.analysis === "ac") {
        expect(supply.real).toEqual(current.real.map((v) => -v));
        expect(supply.imag).toEqual(current.imag.map((v) => -v));
      } else {
        expect(supply.value).toEqual(
          Array.isArray(current.value)
            ? current.value.map((v) => -v)
            : -current.value,
        );
      }
    }
  }
  expect(measurements.map((m) => m.name).sort()).toEqual(
    (original.measurements ?? []).map((m) => m.id).sort(),
  );
  for (const spec of original.measurements ?? []) {
    const a = raw.find((a) => a.analysis === spec.analysis),
      method = spec.method;
    let axis = a.timeSeconds ?? a.frequencyHz ?? a.sweep?.values ?? [0];
    let values;
    if (spec.outputId === "noise-output-density") values = a.outputNoiseDensity;
    else if (spec.outputId === "noise-input-density")
      values = a.inputNoiseDensity;
    else if (spec.outputId === "probe-gain-db") {
      const out = get(a, "vout"),
        inp = get(a, "vinp");
      values = out.real.map(
        (r, i) =>
          20 *
          Math.log10(
            Math.hypot(r, out.imag[i]) / Math.hypot(inp.real[i], inp.imag[i]),
          ),
      );
      const derived = data.analyses.find(
        (a) => a.analysis === "ac" && a.postprocessor && get(a, "Gain"),
      );
      const gain = get(derived, "Gain");
      values.forEach((v, i) =>
        expect(
          20 * Math.log10(Math.hypot(gain.real[i], gain.imag[i])),
        ).toBeCloseTo(v, 10),
      );
    } else {
      const p = get(
        a,
        spec.outputId === "probe-supply-current" ? "VDD:flow(br)" : "vout",
      );
      values = Array.isArray(p.value) ? p.value : [p.value];
      if (spec.outputId === "probe-supply-current")
        values = values.map((v) => -v);
    }
    if (method.window) {
      const { start, stop } = method.window;
      const pairs = [
        [start, sample(axis, values, start)],
        ...axis.flatMap((x, i) =>
          x > start && x < stop ? [[x, values[i]]] : [],
        ),
        [stop, sample(axis, values, stop)],
      ];
      axis = pairs.map((p) => p[0]);
      values = pairs.map((p) => p[1]);
    }
    let expected;
    switch (method.kind) {
      case "value":
        expected = values[0];
        break;
      case "sample-at":
        expected = sample(axis, values, method.coordinate);
        break;
      case "minimum":
        expected = Math.min(...values);
        break;
      case "maximum":
        expected = Math.max(...values);
        break;
      case "peak-to-peak":
        expected = Math.max(...values) - Math.min(...values);
        break;
      case "mean":
      case "rms": {
        const power = method.kind === "rms" ? 2 : 1;
        const integral = values
          .slice(1)
          .reduce(
            (sum, v, i) =>
              sum +
              ((axis[i + 1] - axis[i]) * (values[i] ** power + v ** power)) / 2,
            0,
          );
        expected = integral / (axis.at(-1) - axis[0]);
        if (power === 2) expected = Math.sqrt(expected);
        break;
      }
      default:
        throw Error(`Unverified measurement ${method.kind}`);
    }
    const value = measurements.find((m) => m.name === spec.id).value;
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value - expected)).toBeLessThan(
      Math.max(1e-15, Math.abs(expected) * 1e-10),
    );
  }
}

function assertOtaResult(id, data, measurements) {
  const get = (plot, name) => plot.probes.find((p) => p.name === name);
  const measured = (name) => measurements.find((m) => m.name === name).value;
  const sample = (axis, values, target) => {
    const i = axis.findIndex((x) => x >= target);
    if (i < 0) throw Error("Measurement outside returned data");
    if (axis[i] === target) return values[i];
    if (!i) throw Error("Measurement precedes returned data");
    return (
      values[i - 1] +
      ((values[i] - values[i - 1]) * (target - axis[i - 1])) /
        (axis[i] - axis[i - 1])
    );
  };
  if (id === "ota-op") {
    const op = data.analyses.find((a) => a.analysis === "op");
    const parameters = op.probes.filter(
      (p) => p.name.startsWith("XDUT:XM") && p.name.includes("."),
    );
    expect(parameters).toHaveLength(54);
    expect(parameters.every((p) => Number.isFinite(p.value))).toBe(true);
    for (const name of ["vout", "N0001", "XDUT:tail", "XDUT:nleft"]) {
      expect(get(op, name).value).toBeGreaterThan(0);
      expect(get(op, name).value).toBeLessThan(1.8);
    }
    expect(measured("supply_current")).toBe(-get(op, "VDD:flow(br)").value);
  } else if (id === "ota-dc") {
    const dc = data.analyses.find((a) => a.analysis === "dc");
    expect(dc.sweep.values).toHaveLength(81);
    for (const [i, v] of dc.sweep.values.entries()) {
      expect(v).toBeCloseTo(0.86 + i * 0.001, 10);
      expect(get(dc, "vinp").value[i]).toBeCloseTo(v, 10);
    }
    expect(get(dc, "vout").value.every(Number.isFinite)).toBe(true);
  } else if (id === "ota-noise") {
    const noise = data.analyses.find((a) => a.analysis === "noise");
    expect(noise.frequencyHz).toHaveLength(271);
    expect(noise.frequencyHz[0]).toBe(1);
    expect(noise.frequencyHz.at(-1)).toBeCloseTo(1e9, 3);
    expect(noise.integrationMethod).toBe("trapezoidal-psd");
    for (const [density, total] of [
      [noise.inputNoiseDensity, noise.integratedInputNoise],
      [noise.outputNoiseDensity, noise.integratedOutputNoise],
    ]) {
      expect(density.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
      const sum = density
        .slice(1)
        .reduce(
          (acc, v, i) =>
            acc +
            ((noise.frequencyHz[i + 1] - noise.frequencyHz[i]) *
              (v * v + density[i] * density[i])) /
              2,
          0,
        );
      expect(Math.abs(total / Math.sqrt(sum) - 1)).toBeLessThan(1e-12);
    }
  }
  if (id.startsWith("ota-ac-") || id === "ota-closed") {
    const raw = data.analyses.find(
      (a) => a.analysis === "ac" && !a.postprocessor,
    );
    const ac = data.analyses.find(
      (a) => a.analysis === "ac" && a.postprocessor,
    );
    expect(ac.frequencyHz).toHaveLength(541);
    expect(ac.frequencyHz).toEqual(raw.frequencyHz);
    const gain = get(ac, "Gain"),
      input = get(raw, "vinp"),
      output = get(raw, "vout");
    for (let i = 0; i < gain.real.length; i++) {
      const denominator = input.real[i] ** 2 + input.imag[i] ** 2;
      expect(
        Math.abs(
          gain.real[i] -
            (output.real[i] * input.real[i] + output.imag[i] * input.imag[i]) /
              denominator,
        ),
      ).toBeLessThan(1e-12);
      expect(
        Math.abs(
          gain.imag[i] -
            (output.imag[i] * input.real[i] - output.real[i] * input.imag[i]) /
              denominator,
        ),
      ).toBeLessThan(1e-12);
    }
    const db = gain.real.map(
      (v, i) => 20 * Math.log10(Math.hypot(v, gain.imag[i])),
    );
    expect(
      measured(id === "ota-closed" ? "closed_gain_db" : "dc_gain_db"),
    ).toBeCloseTo(db[0], 10);
    if (id !== "ota-closed") {
      const i = db.findIndex((v, i) => i > 0 && db[i - 1] > 0 && v <= 0);
      expect(i).toBeGreaterThan(0);
      const crossing =
        ac.frequencyHz[i - 1] +
        ((ac.frequencyHz[i] - ac.frequencyHz[i - 1]) * -db[i - 1]) /
          (db[i] - db[i - 1]);
      expect(measured("unity_gain_hz")).toBeCloseTo(crossing, 7);
    }
  }
  if (id === "ota-tran" || id === "ota-closed") {
    const tran = data.analyses.find((a) => a.analysis === "tran");
    const time = tran.timeSeconds,
      output = get(tran, "vout").value,
      input = get(tran, "vinp").value;
    expect(time.at(-1)).toBeCloseTo(6e-6, 12);
    expect(output.every(Number.isFinite)).toBe(true);
    expect(sample(time, input, 0.5e-6)).toBeCloseTo(0.9, 9);
    expect(sample(time, input, 1.5e-6)).toBeCloseTo(0.91, 9);
    expect(sample(time, input, 2.5e-6)).toBeCloseTo(
      id === "ota-closed" ? 0.91 : 0.9,
      9,
    );
    if (id === "ota-tran") {
      expect(measured("output_max")).toBe(Math.max(...output));
      expect(measured("output_min")).toBe(Math.min(...output));
    } else {
      expect(measured("output_at_2us")).toBeCloseTo(
        sample(time, output, 2e-6),
        12,
      );
      const window = output.filter((_, i) => time[i] > 1e-6 && time[i] < 3e-6);
      window.push(sample(time, output, 1e-6), sample(time, output, 3e-6));
      expect(measured("output_peak")).toBeCloseTo(Math.max(...window), 12);
    }
  }
}

// These are source/result-fidelity and circuit-law checks, not new foundry
// qualification tolerances or a substitute for the frozen cross-engine oracle.
function assertCommonSourceResult(id, data, measurements, originalSweep) {
  const analyses = data.analyses;
  const get = (plot, name) => plot.probes.find((p) => p.name === name);
  if (id === "cs-op") {
    const op = analyses.find((a) => a.analysis === "op");
    const value = (name) => get(op, name).value;
    const model = (name) => value(`XM1:msky130_fd_pr__nfet_01v8.${name}`);
    expect(value("in")).toBeCloseTo(0.7, 10);
    expect(value("out")).toBeGreaterThan(0);
    expect(value("out")).toBeLessThan(1.8);
    // Model outputs use g_int/d_int/b_int/s_int, not external terminals.
    // Series resistance makes Vgs slightly less than the 0.7 V source; do not
    // relabel intrinsic voltages as terminal measurements or tune the model.
    expect(model("vgs")).toBeGreaterThan(0);
    expect(model("vgs")).toBeLessThanOrEqual(value("in"));
    expect(model("vds")).toBeGreaterThan(0);
    expect(model("vds")).toBeLessThanOrEqual(value("out"));
    const drainCurrent = (1.8 - value("out")) / 1e4;
    // Model-native id is a channel output, not the complete terminal branch
    // current (which also contains junction/gate leakage). KCL below compares
    // external supply and resistor currents only.
    expect(model("id")).toBeGreaterThan(0);
    expect(Math.abs(value("VDD:flow(br)") + drainCurrent)).toBeLessThan(1e-9);
    for (const name of [
      "id",
      "vgs",
      "vds",
      "vbs",
      "gm",
      "gds",
      "gmbs",
      "vth",
      "vdsat",
    ])
      expect(Number.isFinite(model(name)), name).toBe(true);
    expect(model("gm")).toBeGreaterThan(0);
  } else if (id === "cs-dc") {
    const dc = analyses.find((a) => a.analysis === "dc");
    expect(dc.sweep.values).toHaveLength(181);
    const out = get(dc, "out").value,
      input = get(dc, "in").value;
    const current = get(dc, "VDD:flow(br)").value;
    for (const [i, v] of dc.sweep.values.entries()) {
      expect(v).toBeCloseTo(0.3 + i * 0.005, 10);
      expect(input[i]).toBeCloseTo(v, 10);
      expect(Math.abs(current[i] + (1.8 - out[i]) / 1e4)).toBeLessThan(1e-9);
      if (i) expect(out[i] - out[i - 1]).toBeLessThan(1e-6);
    }
    expect(out[0]).toBeGreaterThan(out.at(-1));
  } else if (id === "cs-ac") {
    const raw = analyses.find((a) => a.analysis === "ac" && !a.postprocessor);
    const ac = analyses.find((a) => a.analysis === "ac" && a.postprocessor);
    expect(ac.frequencyHz).toEqual(raw.frequencyHz);
    expect(ac.frequencyHz).toHaveLength(641);
    const gain = get(ac, "Gain"),
      inp = get(raw, "in"),
      out = get(raw, "out");
    for (let i = 0; i < gain.real.length; i++) {
      const denominator = inp.real[i] ** 2 + inp.imag[i] ** 2;
      expect(
        Math.abs(
          gain.real[i] -
            (out.real[i] * inp.real[i] + out.imag[i] * inp.imag[i]) /
              denominator,
        ),
      ).toBeLessThan(1e-12);
      expect(
        Math.abs(
          gain.imag[i] -
            (out.imag[i] * inp.real[i] - out.real[i] * inp.imag[i]) /
              denominator,
        ),
      ).toBeLessThan(1e-12);
    }
    expect(gain.real[0]).toBeLessThan(-1);
    const index = ac.frequencyHz.findIndex((f) => Math.abs(f - 1000) < 1e-6);
    expect(index).toBeGreaterThan(0);
    expect(measurements).toHaveLength(1);
    expect(measurements[0].name).toBe("gain_db_1khz");
    expect(measurements[0].value).toBeCloseTo(
      20 * Math.log10(Math.hypot(gain.real[index], gain.imag[index])),
      9,
    );
  } else {
    const plots = analyses.filter((a) => a.analysis === "tran");
    expect(plots).toHaveLength(2);
    expect(measurements.map((m) => m.name)).toEqual(["output_pp", "output_pp"]);
    const parsed = parseVacaskRawfile(originalSweep);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    const vectors = new Map(
      parsed.plots[0].vectors.map((v) => [v.variable.name, v.real]),
    );
    for (const [i, amplitude] of [0.01, 0.2].entries()) {
      const plot = plots[i],
        time = plot.timeSeconds;
      expect(plot.plotName).toContain(`${amplitude} V input`);
      expect(time[0]).toBe(0);
      expect(time.at(-1)).toBeCloseTo(400e-6, 12);
      const indices = vectors
        .get("amplitude")
        .flatMap((a, index) => (a === amplitude ? [index] : []));
      expect(time).toEqual(indices.map((index) => vectors.get("time")[index]));
      for (const name of ["in", "out"])
        expect(get(plot, name).value).toEqual(
          indices.map((index) => vectors.get(name)[index]),
        );
      const input = get(plot, "in").value,
        output = get(plot, "out").value;
      for (const [index, t] of time.entries())
        expect(
          Math.abs(
            input[index] - (0.7 + amplitude * Math.sin(2 * Math.PI * 1e4 * t)),
          ),
        ).toBeLessThan(1e-9);
      const window = output.filter(
        (_, index) => time[index] >= 200e-6 && time[index] <= 400e-6,
      );
      // Sine extrema lie inside this two-period window; interpolated endpoints
      // in the report cannot change the sampled peak-to-peak extrema.
      expect(measurements[i].value).toBeCloseTo(
        Math.max(...window) - Math.min(...window),
        12,
      );
    }
    expect(measurements[1].value).toBeGreaterThan(measurements[0].value);
  }
}

// Analytical series RLC, output across C. Integrate the unit-step response
// over the unchanged 100 ns source ramp; do not approximate it as an ideal step.
function rlcReference(resistance) {
  const L = 0.01,
    C = 1e-7,
    a = resistance / (2 * L),
    w2 = 1 / (L * C);
  let step, integral;
  if (Math.abs(w2 - a * a) < w2 * 1e-8) {
    // The saved critical R has nine significant digits. Use the continuous
    // critical limit to avoid subtracting nearly equal roots (~5e-11 relative).
    step = (t) => 1 - Math.exp(-a * t) * (1 + a * t);
    integral = (t) => t - (2 - (2 + a * t) * Math.exp(-a * t)) / a;
  } else if (a * a < w2) {
    const b = Math.sqrt(w2 - a * a);
    step = (t) =>
      1 - Math.exp(-a * t) * (Math.cos(b * t) + (a / b) * Math.sin(b * t));
    integral = (t) => {
      const c = Math.cos(b * t),
        s = Math.sin(b * t),
        e = Math.exp(-a * t);
      return (
        t -
        (e * (-a * c + b * s) + a) / w2 -
        ((a / b) * (e * (-a * s - b * c) + b)) / w2
      );
    };
  } else {
    const d = Math.sqrt(a * a - w2),
      p = -a + d,
      q = -a - d;
    const cp = q / (p - q),
      cq = -p / (p - q);
    step = (t) => 1 + cp * Math.exp(p * t) + cq * Math.exp(q * t);
    integral = (t) =>
      t + (cp * Math.expm1(p * t)) / p + (cq * Math.expm1(q * t)) / q;
  }
  const positive = (f, t) => (t > 0 ? f(t) : 0);
  return (time) => {
    const t = time - 100e-6,
      rise = 100e-9;
    return {
      voltage: (positive(integral, t) - positive(integral, t - rise)) / rise,
      current: (C * (positive(step, t) - positive(step, t - rise))) / rise,
    };
  };
}

function assertRlcResult(data, measurements, resistance) {
  const ac = data.analyses.find((a) => a.analysis === "ac" && a.postprocessor);
  const tran = data.analyses.find((a) => a.analysis === "tran");
  expect(ac.frequencyHz).toHaveLength(401);
  expect(ac.frequencyHz[0]).toBe(100);
  expect(ac.frequencyHz.at(-1)).toBeCloseTo(1e6, 5);
  const gain = ac.probes.find((p) => p.name === "Gain");
  let maxAc = 0;
  for (const [index, frequency] of ac.frequencyHz.entries()) {
    const w = 2 * Math.PI * frequency,
      re = 1 - w * w * 0.01 * 1e-7,
      im = w * resistance * 1e-7;
    maxAc = Math.max(
      maxAc,
      Math.abs(gain.real[index] - re / (re * re + im * im)),
      Math.abs(gain.imag[index] + im / (re * re + im * im)),
    );
  }
  expect(maxAc).toBeLessThan(1e-7);
  const output = tran.probes.find((p) => p.name === "out");
  const current = tran.probes.find((p) => p.name === "L1:flow(br)");
  expect(current).toBeDefined();
  expect(tran.timeSeconds.at(-1)).toBe(1e-3);
  const reference = rlcReference(resistance);
  let maxVoltage = 0,
    maxCurrent = 0;
  for (const [index, time] of tran.timeSeconds.entries()) {
    const exact = reference(time);
    maxVoltage = Math.max(
      maxVoltage,
      Math.abs(output.value[index] - exact.voltage),
    );
    maxCurrent = Math.max(
      maxCurrent,
      Math.abs(current.value[index] - exact.current),
    );
  }
  console.info(
    "RLC-analytical-errors",
    JSON.stringify({ resistance, maxAc, maxVoltage, maxCurrent }),
  );
  expect(maxVoltage).toBeLessThan(1e-5);
  expect(maxCurrent).toBeLessThan(1e-7);
  const measured = (name) => measurements.find((m) => m.name === name).value;
  expect(measured("peak_output")).toBe(Math.max(...output.value));
  expect(measured("final_value")).toBe(output.value.at(-1));
  expect(
    Math.abs(
      measured("peak_gain_db") -
        Math.max(
          ...gain.real.map(
            (v, i) => 20 * Math.log10(Math.hypot(v, gain.imag[i])),
          ),
        ),
    ),
  ).toBeLessThan(1e-10);
}

const projects = await Promise.all(
  ["rc", "rlc", "common-source", "ota", "ota-library"].map(async (kind) => ({
    kind,
    project: parseProject(
      await readFile(
        new URL(
          kind === "ota-library"
            ? "../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json"
            : `../../apps/editor/src/examples/simulation-${kind}.icproj.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  })),
);
const resistanceFor = (id) =>
  ({ "rlc-1": 200, "rlc-2": 632.455532, "rlc-3": 1000 })[id];
const reference = (kind, name) =>
  readFile(
    new URL(
      `../../netlists/native-${kind === "rc" ? "rc-filters" : "rlc-filter"}/${name}`,
      import.meta.url,
    ),
    "utf8",
  );

const { library } = JSON.parse(
  await readFile(
    new URL(
      "../../netlists/vacask-sky130/model-symbols-tt.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const cornerLibraries = Object.fromEntries(
  await Promise.all(
    ["tt", "ff", "ss", "fs", "sf"].map(async (corner) => [
      corner,
      JSON.parse(
        await readFile(
          new URL(
            `../../netlists/vacask-sky130/model-symbols-${corner}.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ).library,
    ]),
  ),
);

it("preserves all twelve Library OTA experiments, their circuits and native report source", async () => {
  const { project } = projects.find((p) => p.kind === "ota-library");
  const before = parseProject(JSON.stringify(legacyLibraryOta));
  expect({ ...project, simulationFolders: [] }).toEqual({
    ...before,
    simulationFolders: [],
  });
  expect(project.simulationFolders.map((f) => f.id)).toEqual(
    before.simulationFolders.map((f) => f.id),
  );
  for (const folder of project.simulationFolders) {
    const original = before.simulationFolders.find((f) => f.id === folder.id);
    expect(folder.input.circuitBindings).toEqual(
      original.input.circuitBindings,
    );
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    for (const [file, path] of [
      ["report.py", "netlists/native-ota-library/report.py"],
      ["native_report.py", "scripts/lib/native-starter-report.py"],
    ])
      expect(folder.input.files.find((f) => f.path === file).text).toBe(
        (
          await readFile(new URL(`../../${path}`, import.meta.url), "utf8")
        ).replaceAll("\r\n", "\n"),
      );
    const corner = legacyLibraryOta.simulationSetups.find(
      (s) => s.id === folder.id,
    ).input.environment.corner;
    const lib = cornerLibraries[corner];
    expect(folder.input.dependencies).toEqual([
      {
        id: lib.dependencyId,
        sha256: lib.sha256,
        mountPath: "models/library.inc",
      },
    ]);
    if (folder.id.includes("bias") || folder.id.includes("full")) {
      const ops = nativeSimulationDevices(project, folder.input, [lib])
        .filter((d) => ["M1", "M3"].includes(d.instanceId))
        .flatMap((d) => nativeDeviceOpAcquisitions(d));
      expect(ops).toHaveLength(18);
      for (const op of ops)
        expect(
          compiled.files.find((f) => f.path === folder.input.entry).text,
        ).toContain(op.save);
    }
  }
});

it("ships all eight OTA native folders without substituting corners or the code-owned feedback testbench", async () => {
  const { project } = projects.find((p) => p.kind === "ota");
  expect(project.simulationFolders).toHaveLength(8);
  for (const folder of project.simulationFolders) {
    const corner = folder.id.startsWith("ota-ac-") ? folder.id.slice(-2) : "tt";
    const mode = folder.id.startsWith("ota-ac-") ? "ac" : folder.id.slice(4);
    const template = (
      await readFile(
        new URL(`../../netlists/native-ota/${mode}.sim`, import.meta.url),
        "utf8",
      )
    ).replaceAll("\r\n", "\n");
    const code = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    ).text;
    expect(code).toBe(
      folder.name + "\n" + template.slice(template.indexOf("\n") + 1),
    );
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    expect(compiled.config.environment.profileId).toBe(
      `vacask-sky130-${corner}-candidate`,
    );
    const lib = cornerLibraries[corner];
    expect(folder.input.dependencies).toEqual([
      {
        id: lib.dependencyId,
        sha256: lib.sha256,
        mountPath: "models/library.inc",
      },
    ]);
    if (mode === "op") {
      const ops = nativeSimulationDevices(project, folder.input, [lib])
        .filter((d) => d.polarity)
        .flatMap((d) => nativeDeviceOpAcquisitions(d));
      expect(ops).toHaveLength(54);
      for (const op of ops) expect(code).toContain(op.save);
    }
    if (mode === "closed") {
      expect(folder.input.circuitBindings[0]).toMatchObject({
        documentId: "document-ota-5t",
        emission: "subcircuit",
      });
      expect(
        folder.input.files.find((f) => f.path === "testbench.spice").text,
      ).toBe(
        (
          await readFile(
            new URL("../../netlists/native-ota/testbench.sim", import.meta.url),
            "utf8",
          )
        ).replaceAll("\r\n", "\n"),
      );
    }
    if (!["dc", "noise"].includes(mode)) {
      expect(folder.input.files.find((f) => f.path === "report.py").text).toBe(
        (
          await readFile(
            new URL(
              "../../scripts/lib/native-starter-report.py",
              import.meta.url,
            ),
            "utf8",
          )
        ).replaceAll("\r\n", "\n"),
      );
    }
  }
});

it("ships four native common-source experiments with converter-checked wrapper selectors and explicit candidate identity", async () => {
  const { project } = projects.find((p) => p.kind === "common-source");
  const before = structuredClone(project);
  const report = (
    await readFile(
      new URL("../../scripts/lib/native-starter-report.py", import.meta.url),
      "utf8",
    )
  ).replaceAll("\r\n", "\n");
  expect(project.simulationFolders.map((f) => f.id)).toEqual([
    "cs-op",
    "cs-dc",
    "cs-ac",
    "cs-tran",
  ]);
  for (const folder of project.simulationFolders) {
    const template = (
      await readFile(
        new URL(
          `../../netlists/native-common-source/${folder.id.slice(3)}.sim`,
          import.meta.url,
        ),
        "utf8",
      )
    ).replaceAll("\r\n", "\n");
    const code = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    ).text;
    expect(code).toBe(
      folder.name + "\n" + template.slice(template.indexOf("\n") + 1),
    );
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    expect(compiled.config.environment.profileId).toBe(
      "vacask-sky130-tt-candidate",
    );
    expect(folder.input.dependencies).toEqual([
      {
        id: library.dependencyId,
        sha256: library.sha256,
        mountPath: "models/library.inc",
      },
    ]);
    expect(code).not.toMatch(/options\s+scale=/u);
    if (folder.id === "cs-op") {
      const device = nativeSimulationDevices(project, folder.input, [
        library,
      ]).find((d) => d.instanceId === "XM1");
      const acquisitions = nativeDeviceOpAcquisitions(device);
      expect(acquisitions).toHaveLength(9);
      for (const op of acquisitions) expect(code).toContain(op.save);
    }
    if (["cs-ac", "cs-tran"].includes(folder.id)) {
      expect(folder.input.files.find((f) => f.path === "report.py").text).toBe(
        report,
      );
      expect(
        folder.input.files.find((f) => f.path === "icm_reports.py").text,
      ).toBe(vacaskMeasurementPythonSource() + "\n" + vacaskPlotPythonSource());
    }
  }
  expect(project).toEqual(before);
});

it.each(projects.filter((p) => ["rc", "rlc"].includes(p.kind)))(
  "ships $kind experiments as native source with editable shared report helpers",
  async ({ kind, project }) => {
    const before = structuredClone(project);
    expect(project.simulationFolders).toHaveLength(kind === "rc" ? 4 : 3);
    for (const folder of project.simulationFolders) {
      const source = (path) =>
        folder.input.files.find((file) => file.path === path).text;
      const template = (
        await reference(
          kind,
          kind === "rlc"
            ? "rlc.sim"
            : folder.id.endsWith("-ac")
              ? "ac.sim"
              : "step.sim",
        )
      )
        .replaceAll("\r\n", "\n")
        .replace(
          'alter instance("R1") r=200',
          `alter instance("R1") r=${resistanceFor(folder.id)}`,
        );
      expect(source(folder.input.entry)).toBe(
        folder.name + "\n" + template.slice(template.indexOf("\n") + 1),
      );
      expect(source("report.py")).toBe(
        (
          await readFile(
            new URL(
              "../../scripts/lib/native-starter-report.py",
              import.meta.url,
            ),
            "utf8",
          )
        ).replaceAll("\r\n", "\n"),
      );
      expect(source("icm_reports.py")).toBe(
        vacaskMeasurementPythonSource() + "\n" + vacaskPlotPythonSource(),
      );
      const compiled = compileSourceSimulation(project, folder);
      expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      expect(compiled.config.environment.profileId).toBe("vacask-passives-v1");
      expect(
        compiled.files.find((f) => f.path === "circuit.spice").text,
      ).toContain('load "capacitor.osdi"');
    }
    expect(project).toEqual(before);
  },
);

// Real local, observed native Profile, not pinned/cloud/model qualification.
it
  .skipIf(
    !process.env.VACASK_BIN ||
      !process.env.VACASK_MODULES ||
      !process.env.ICM_PYTHON ||
      !process.env.ICM_PYTHON_LIBRARIES,
  )
  .each(
    projects.flatMap((p) =>
      p.kind === "ota-library"
        ? ["tt", "ff", "ss", "fs", "sf"].map((corner) => ({ ...p, corner }))
        : p.kind === "ota"
          ? ["tt", "ff", "ss"].map((corner) => ({ ...p, corner }))
          : [{ ...p, corner: "tt" }],
    ),
  )(
  "runs bundled $kind $corner experiments through Prepare/Run/Read, measurements and CSV",
  async ({ kind, project, corner }, context) => {
    const commonSource = kind === "common-source";
    const modelBacked = commonSource || kind.startsWith("ota");
    const lib = cornerLibraries[corner];
    const modelPath =
      process.env[`ICM_VACASK_CONVERTED_${corner.toUpperCase()}`];
    if (modelBacked && !modelPath) context.skip();
    const profile = modelBacked
      ? {
          id: `vacask-sky130-${corner}-candidate`,
          corners: [],
          dependencies: [{ id: lib.dependencyId, sha256: lib.sha256 }],
          modelSymbols: [lib],
          modelLibrary: {
            dependencyId: lib.dependencyId,
            defaultScale: 1e-6,
          },
        }
      : { id: "vacask-passives-v1", corners: [] };
    const before = structuredClone(project);
    const root = await mkdtemp(join(tmpdir(), `icm-${kind}-starters-`));
    try {
      const startupPath = join(root, "startup.toml");
      await writeFile(
        startupPath,
        `[Binaries]\npython = ${JSON.stringify(process.env.ICM_PYTHON)}\n`,
      );
      const runtime = await initializeVacaskRuntime({
        executor: "local-host",
        profileId: profile.id,
        binary: resolve(process.env.VACASK_BIN),
        modules: resolve(process.env.VACASK_MODULES),
        startupPath,
        runRoot: root,
        python: {
          binary: resolve(process.env.ICM_PYTHON),
          libraries: process.env.ICM_PYTHON_LIBRARIES.split(delimiter),
        },
        ...(modelBacked
          ? {
              dependencies: [
                {
                  id: lib.dependencyId,
                  sha256: lib.sha256,
                  runtimePath: resolve(modelPath),
                },
              ],
            }
          : {}),
        ...(process.env.ICM_VACASK_LIBRARY_PATH
          ? { libraryPath: process.env.ICM_VACASK_LIBRARY_PATH }
          : {}),
      });
      const limits = {
        maxInputBytes: 65536,
        maxInputFiles: 12,
        maxOutputBytes: modelBacked ? 8 * 1048576 : 1048576,
        maxLogBytes: 65536,
        maxRawFiles: 16,
        maxEntries: 256,
      };
      const capabilities = CapabilitiesSchema.parse({
        configured: true,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        analyses: ["op", "dc", "ac", "tran", "noise"],
        parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
        profiles: [profile],
        maxTimeoutMs: 15000,
        maxInputBytes: limits.maxInputBytes,
        maxInputFiles: limits.maxInputFiles,
        maxOutputBytes: limits.maxOutputBytes,
        cancel: false,
      });
      const supervisor = new SimulationRunSupervisor();
      const files = new SimulationFiles();
      const service = new SimulationService(
        files,
        {
          capabilities: async () => capabilities,
          execute: async (input) => {
            const reply = await executeVacask(
              input,
              runtime,
              limits,
              supervisor,
            );
            if (!reply.ok) throw Error(JSON.stringify(reply));
            return reply.output;
          },
          cancel: async () => {},
        },
        () => project,
      );
      for (const folder of project.simulationFolders) {
        if (
          modelBacked &&
          JSON.parse(
            folder.input.files.find((f) => f.path === folder.input.configPath)
              .text,
          ).environment.profileId !== profile.id
        )
          continue;
        const prepared = await service.handle(
          {
            operation: "prepare",
            source: {
              kind: "project-folder",
              folderId: folder.id,
              expectedStructureRevision: project.structureRevision,
            },
          },
          `prepare-${folder.id}`,
        );
        expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
        const started = await service.handle(
          {
            operation: "start",
            preparedId: prepared.prepared.id,
            digest: prepared.prepared.digest,
          },
          `start-${folder.id}`,
        );
        expect(started.ok, JSON.stringify(started)).toBe(true);
        let run;
        await vi.waitFor(
          async () => {
            const reply = await service.handle(
              { operation: "read", runId: started.run.id },
              `read-${folder.id}`,
            );
            expect(reply.ok, JSON.stringify(reply)).toBe(true);
            run = reply.run;
            expect(run.state).toBe("finished");
          },
          { timeout: 20000 },
        );
        expect(
          run.result.outcome.status,
          JSON.stringify({ id: folder.id, result: run.result }),
        ).toBe("completed");
        expect(
          run.error,
          JSON.stringify({ id: folder.id, error: run.error }),
        ).toBeUndefined();
        // Large waveforms intentionally leave Read as a bounded receipt. Fetch
        // complete arrays through the same paged File API used by GUI/MCP.
        const artifactText = async (name) => {
          const ref = run.artifacts.find((a) => a.name === name);
          expect(ref, name).toBeDefined();
          let offset = 0,
            text = "";
          do {
            const part = await files.handle({
              action: "artifact",
              artifactId: ref.id,
              offset,
              maxChars: 65536,
            });
            expect(part.ok, name).toBe(true);
            text += part.text;
            offset = part.nextOffset;
          } while (offset !== null);
          return text;
        };
        const measurements = run.artifacts.some(
          (a) => a.name === "native-measurements.json",
        )
          ? JSON.parse(await artifactText("native-measurements.json"))
          : [];
        const result = JSON.parse(await artifactText("result.json"));
        if (modelBacked && process.env.ICM_VACASK_EVIDENCE_DIR) {
          const parent = resolve(process.env.ICM_VACASK_EVIDENCE_DIR);
          await mkdir(parent, { recursive: true });
          const evidence = await mkdtemp(join(parent, `${folder.id}-public-`));
          for (const name of [
            "result.json",
            "outputs.json",
            "evidence.json",
            "native-measurements.json",
          ])
            if (run.artifacts.some((a) => a.name === name))
              await writeFile(join(evidence, name), await artifactText(name));
          await writeFile(
            join(evidence, "input.sim"),
            await artifactText(`executed/${folder.input.entry}`),
          );
          await writeFile(
            join(evidence, "circuit.sim"),
            await artifactText("executed/circuit.spice"),
          );
          console.info("Model-starter-public-artifacts", evidence);
        }
        console.info(
          "Starter-native-evidence",
          JSON.stringify({
            folderId: folder.id,
            metadata: result.metadata,
            measurements,
            analyses: result.data.analyses.map((a) => ({
              analysis: a.analysis,
              points: a.frequencyHz?.length ?? a.timeSeconds?.length,
              postprocessor: !!a.postprocessor,
            })),
          }),
        );
        expect(
          measurements.every((m) => m.status === "available"),
          JSON.stringify(measurements),
        ).toBe(true);
        const high = folder.id.includes("-hp-");
        if (kind.startsWith("ota")) {
          if (kind === "ota-library")
            assertLibraryOtaResult(folder.id, result.data, measurements);
          else assertOtaResult(folder.id, result.data, measurements);
          expect(run.artifacts.some((a) => a.name.endsWith(".csv"))).toBe(true);
          for (const item of run.artifacts.filter((a) =>
            a.name.endsWith(".csv"),
          ))
            expect((await artifactText(item.name)).length).toBeGreaterThan(20);
          continue;
        }
        if (commonSource) {
          assertCommonSourceResult(
            folder.id,
            result.data,
            measurements,
            folder.id === "cs-tran"
              ? await artifactText("raw/signal.raw")
              : undefined,
          );
          // Every numerical record is downloadable, including both sweep cases.
          const csv = run.artifacts.filter((a) => a.name.endsWith(".csv"));
          expect(csv.length).toBeGreaterThan(0);
          for (const item of csv)
            expect((await artifactText(item.name)).length).toBeGreaterThan(20);
          continue;
        } else if (kind === "rlc") {
          assertRlcResult(result.data, measurements, resistanceFor(folder.id));
        } else if (folder.id.endsWith("-ac")) {
          const transfer = result.data.analyses.find((a) => a.postprocessor);
          expect(transfer.analysis).toBe("ac");
          expect(transfer.frequencyHz[0]).toBe(10);
          expect(transfer.frequencyHz.at(-1)).toBeCloseTo(1e6, 5);
          const gain = transfer.probes.find((p) => p.name === "Gain");
          expect(gain.real).toHaveLength(401);
          for (let index = 0; index < transfer.frequencyHz.length; index++) {
            const w = 2 * Math.PI * transfer.frequencyHz[index] * 1e-4;
            const real = high ? (w * w) / (1 + w * w) : 1 / (1 + w * w);
            const imag = (high ? w : -w) / (1 + w * w);
            expect(Math.abs(gain.real[index] - real)).toBeLessThan(1e-7);
            expect(Math.abs(gain.imag[index] - imag)).toBeLessThan(1e-7);
          }
          // The authored measurement interpolates the sampled dB trace, like the
          // original recipe. Its grid error is not a solver/model tolerance.
          expect(
            Math.abs(
              measurements.find((m) => m.name === "gain_at_fc").value +
                10 * Math.log10(2),
            ),
          ).toBeLessThan(0.002);
        } else {
          const rampEnd = 100.1e-6,
            tau = 1e-4,
            rise = 100e-9;
          const highAt = (time) =>
            (tau / rise) *
            -Math.expm1(-rise / tau) *
            Math.exp(-(time - rampEnd) / tau);
          for (const [name, time] of [
            ["at_one_tau", 200.05e-6],
            ["final_value", 1e-3],
          ]) {
            const expected = high ? highAt(time) : 1 - highAt(time);
            // Linear interpolation at a requested instant on a <=1 us grid;
            // the bound covers that sampling error for this analytical RC.
            expect(
              Math.abs(
                measurements.find((m) => m.name === name).value - expected,
              ),
            ).toBeLessThan(1e-5);
          }
        }
        const csv = run.artifacts.find(
          (a) => a.name === "native-measurements.csv",
        );
        expect(csv).toBeDefined();
        const downloaded = await files.handle({
          action: "artifact",
          artifactId: csv.id,
          maxChars: 65536,
        });
        expect(downloaded.ok).toBe(true);
        expect(downloaded.text).toContain(
          kind === "rlc"
            ? "peak_output"
            : folder.id.endsWith("-ac")
              ? "gain_at_fc"
              : "at_one_tau",
        );
      }
      expect(project).toEqual(before);
      expect(supervisor.snapshot().state).toBe("idle");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
