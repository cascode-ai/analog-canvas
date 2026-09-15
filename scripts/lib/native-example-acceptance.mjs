import assert from "node:assert/strict";

export const nativeExampleFolderIds = [
  "rc-lp-ac",
  "rc-hp-ac",
  "rc-lp-tran",
  "rc-hp-tran",
  "rlc-1",
  "rlc-2",
  "rlc-3",
  "cs-op",
  "cs-dc",
  "cs-ac",
  "cs-tran",
  "ota-op",
  "ota-dc",
  "ota-ac-tt",
  "ota-ac-ff",
  "ota-ac-ss",
  "ota-tran",
  "ota-noise",
  "ota-closed",
];

export function validateNativeExampleResult(result, measurements = []) {
  assert.equal(result.outcome?.status, "completed", "Incomplete simulation");
  assert.equal(
    result.metadata?.environment?.simulator?.name,
    "vacask",
    "Native VACASK evidence required",
  );
  assert.match(
    result.metadata.environment.fingerprint ?? "",
    /^[a-f0-9]{64}$/,
    "Runtime fingerprint missing",
  );
  assert(
    !result.diagnostics?.some((d) => d.severity === "error"),
    "Result contains errors",
  );
  const analyses = result.data?.analyses;
  assert(
    analyses?.length,
    "Complete result artifact required, not a bounded read receipt",
  );
  for (const a of analyses) {
    const axis = a.frequencyHz ?? a.timeSeconds ?? a.sweep?.values;
    if (a.analysis !== "op") validateAxis(axis);
    assert(a.probes?.length, "Missing result probes");
    for (const p of a.probes) {
      const fields = a.analysis === "ac" ? [p.real, p.imag] : [p.value];
      for (const value of fields) {
        const values = Array.isArray(value) ? value : [value];
        assert(
          values.every(Number.isFinite),
          "Nonfinite/missing probe " + p.name,
        );
        if (axis)
          assert.equal(
            values.length,
            axis.length,
            "Axis/probe length mismatch: " + p.name,
          );
        else assert.equal(values.length, 1, "OP must be scalar");
      }
    }
  }
  for (const m of measurements) {
    assert.equal(m.status, "available", "Failed native measurement " + m.name);
    assert(Number.isFinite(m.value), "Nonfinite native measurement " + m.name);
  }
  assert.equal(
    new Set(measurements.map((m) => `${m.name}:${m.occurrence}`)).size,
    measurements.length,
    "Duplicate measurement occurrence",
  );
  return analyses;
}

function validateAxis(axis) {
  assert(
    Array.isArray(axis) && axis.length >= 2,
    "Missing/truncated sample axis",
  );
  assert(
    axis.every((x, i) => Number.isFinite(x) && (!i || x > axis[i - 1])),
    "Axis must be finite and strictly increasing",
  );
}

export function distortion(time, values) {
  validateAxis(time);
  assert.equal(
    time.length,
    values.length,
    "Distortion axis/probe length mismatch",
  );
  assert(values.every(Number.isFinite), "Nonfinite distortion data");
  assert(
    time[0] <= 200e-6 && time.at(-1) >= 400e-6,
    "Distortion window is not covered; no extrapolation",
  );
  const count = 2048,
    samples = [];
  let k = 0;
  for (let j = 0; j < count; j++) {
    const at = 200e-6 + (j * 200e-6) / count;
    while (time[k + 1] < at) k++;
    const f = (at - time[k]) / (time[k + 1] - time[k]);
    samples.push(values[k] + f * (values[k + 1] - values[k]));
  }
  const harmonics = Array.from({ length: 5 }, (_, i) => {
    let re = 0,
      im = 0;
    samples.forEach((y, j) => {
      const phase = (2 * Math.PI * (i + 1) * 2 * j) / count;
      re += y * Math.cos(phase);
      im += y * Math.sin(phase);
    });
    return (2 * Math.hypot(re, im)) / count;
  });
  assert(harmonics[0] > 1e-12, "Missing fundamental; THD is undefined");
  return {
    minV: Math.min(...samples),
    maxV: Math.max(...samples),
    harmonicsV: harmonics,
    thd2to5: Math.hypot(...harmonics.slice(1)) / harmonics[0],
  };
}

export function unwrappedPhase(p) {
  assert(
    p?.real?.length && p.real.length === p.imag?.length,
    "Missing complex transfer",
  );
  const phase = [];
  p.real.forEach((re, i) => {
    assert(
      Number.isFinite(re) && Number.isFinite(p.imag[i]),
      "Nonfinite transfer",
    );
    let value = (Math.atan2(p.imag[i], re) * 180) / Math.PI;
    if (i) {
      while (value - phase[i - 1] > 180) value -= 360;
      while (value - phase[i - 1] < -180) value += 360;
    }
    phase.push(value);
  });
  return phase;
}

export function validateNoiseIntegral(a) {
  assert.equal(
    a.integrationMethod,
    "trapezoidal-psd",
    "Do not confuse native PSD integration with ngspice per-source integration",
  );
  validateAxis(a.frequencyHz);
  for (const [density, integral] of [
    [a.inputNoiseDensity, a.integratedInputNoise],
    [a.outputNoiseDensity, a.integratedOutputNoise],
  ]) {
    assert.equal(
      density?.length,
      a.frequencyHz.length,
      "Noise density/axis mismatch",
    );
    assert(
      density.every((v) => Number.isFinite(v) && v >= 0),
      "Invalid noise density",
    );
    let power = 0;
    for (let i = 1; i < density.length; i++)
      power +=
        ((density[i] ** 2 + density[i - 1] ** 2) / 2) *
        (a.frequencyHz[i] - a.frequencyHz[i - 1]);
    assert(
      Number.isFinite(integral) &&
        Math.abs(integral - Math.sqrt(power)) <=
          1e-12 * Math.max(Math.sqrt(power), 1e-30),
      "Integrated noise does not match returned PSD",
    );
  }
}

export function analyzeNativeExampleRuns(input) {
  assert.deepEqual(
    [...input.keys()].sort(),
    [...nativeExampleFolderIds].sort(),
    "Acceptance must cover all 19 starter experiments exactly",
  );
  const runs = new Map(
    [...input].map(([id, r]) => [
      id,
      { ...r, analyses: validateNativeExampleResult(r.result, r.measurements) },
    ]),
  );
  const checks = [];
  function check(name, actual, expected, tolerance) {
    checks.push({
      name,
      actual,
      expected,
      tolerance,
      passed:
        Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    });
  }
  const meas = (id, name, occurrence = 1) =>
    runs
      .get(id)
      .measurements.find((m) => m.name === name && m.occurrence === occurrence)
      ?.value;
  const analysis = (id, kind) =>
    runs.get(id).analyses.find((a) => a.analysis === kind);
  const probe = (a, name) => {
    const p = a.probes.find((p) => p.name === name);
    assert(p, `missing ${name}`);
    return p;
  };
  const scalar = (p) => (Array.isArray(p.value) ? p.value[0] : p.value);
  // A derived Gain record does not replace the requested electrical signals.
  for (const [id, run] of runs) {
    const native = run.analyses.filter(
      (a) => !a.postprocessor || id === "cs-tran",
    );
    const expected =
      id === "cs-tran"
        ? ["tran", "tran"]
        : id.startsWith("rlc-") || id === "ota-closed"
          ? ["ac", "tran"]
          : [
              id.includes("-ac")
                ? "ac"
                : id.endsWith("-tran")
                  ? "tran"
                  : id.endsWith("-noise")
                    ? "noise"
                    : id.endsWith("-dc")
                      ? "dc"
                      : "op",
            ];
    assert.deepEqual(
      native.map((a) => a.analysis).sort(),
      expected.sort(),
      `${id}: requested analyses missing`,
    );
    for (const a of native) {
      if (a.analysis === "op" || a.analysis === "noise") continue;
      for (const name of id.startsWith("ota-")
        ? ["vinp", "vout"]
        : ["in", "out"])
        probe(a, name);
    }
  }
  for (const kind of ["lp", "hp"])
    check(
      `RC ${kind} cutoff dB`,
      meas(`rc-${kind}-ac`, "gain_at_fc"),
      -10 * Math.log10(2),
      0.005,
    );
  check(
    "RC LP one time constant",
    meas("rc-lp-tran", "at_one_tau"),
    1 - Math.exp(-1),
    0.001,
  );
  check(
    "RC HP one time constant",
    meas("rc-hp-tran", "at_one_tau"),
    Math.exp(-1),
    0.001,
  );
  const zeta = (200 / 2) * Math.sqrt(100e-9 / 10e-3);
  check(
    "RLC underdamped peak",
    meas("rlc-1", "peak_output"),
    1 + Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)),
    0.002,
  );
  check(
    "RLC resonance dB",
    meas("rlc-1", "peak_gain_db"),
    20 * Math.log10(1 / (2 * zeta * Math.sqrt(1 - zeta * zeta))),
    0.01,
  );
  for (const id of ["rlc-2", "rlc-3"])
    check(`${id} monotonic step peak`, meas(id, "peak_output"), 1, 0.001);

  const cs = analysis("cs-op", "op");
  const csOut = scalar(probe(cs, "out"));
  const csCurrent = -scalar(probe(cs, "VDD:flow(br)"));
  check("Common-source load line", csOut + csCurrent * 10000, 1.8, 1e-5);
  const csGm = scalar(cs.probes.find((p) => p.name.endsWith(".gm")));
  const csGds = scalar(cs.probes.find((p) => p.name.endsWith(".gds")));
  const gainEstimate = csGm / (1 / 10000 + csGds);
  check(
    "Common-source AC versus gm/(1/R+gds)",
    meas("cs-ac", "gain_db_1khz"),
    20 * Math.log10(gainEstimate),
    0.05,
  );
  check(
    "Common-source small signal p-p",
    meas("cs-tran", "output_pp", 1),
    0.02 * gainEstimate,
    0.02 * gainEstimate * 0.05,
  );
  const csAc = analysis("cs-ac", "ac");
  const csVout = probe(csAc, "out");
  assert(csVout.real[0] < 0, "common source must invert");
  const csDistortion = runs
    .get("cs-tran")
    .analyses.filter((a) => a.analysis === "tran")
    .map((a) => distortion(a.timeSeconds, probe(a, "out").value));
  assert.equal(csDistortion.length, 2, "Both amplitude cases must be present");
  assert(
    csDistortion[1].thd2to5 > csDistortion[0].thd2to5,
    "large signal should show greater distortion",
  );

  const otaOp = analysis("ota-op", "op");
  const otaOut = scalar(probe(otaOp, "vout"));
  check("OTA nominal output bias", otaOut, 0.75898, 0.005);
  const otaAC = [];
  for (const corner of ["tt", "ff", "ss"]) {
    assert(meas(`ota-ac-${corner}`, "dc_gain_db") > 20);
    assert(meas(`ota-ac-${corner}`, "unity_gain_hz") > 0);
    const a = runs
        .get(`ota-ac-${corner}`)
        .analyses.find((r) => r.probes?.some((p) => p.name === "Gain")),
      unity = meas(`ota-ac-${corner}`, "unity_gain_hz");
    const transfer = probe(a, "Gain");
    const phase = unwrappedPhase(transfer);
    const i = a.frequencyHz.findIndex((f) => f >= unity);
    assert(
      i > 0 && i < a.frequencyHz.length,
      "Unity crossing outside returned gain samples",
    );
    const fraction =
      Math.log(unity / a.frequencyHz[i - 1]) /
      Math.log(a.frequencyHz[i] / a.frequencyHz[i - 1]);
    otaAC.push({
      corner,
      gainDb: meas(`ota-ac-${corner}`, "dc_gain_db"),
      unityHz: unity,
      nominalPhaseMarginDeg:
        180 + phase[i - 1] + fraction * (phase[i] - phase[i - 1]),
    });
  }
  check(
    "OTA unity follower low frequency",
    meas("ota-closed", "closed_gain_db"),
    20 * Math.log10(120.1227 / (1 + 120.1227)),
    0.04,
  );
  check(
    "OTA closed-loop step target",
    meas("ota-closed", "output_at_2us"),
    0.91,
    0.003,
  );
  const noise = runs.get("ota-noise").analyses;
  const noiseRecord = noise.find((a) => a.analysis === "noise");
  assert(
    noiseRecord?.rawPlotOrdinals.length > 0,
    "capture native noise spectrum evidence",
  );
  for (const density of [
    noiseRecord.inputNoiseDensity,
    noiseRecord.outputNoiseDensity,
  ])
    assert(density.every((v) => Number.isFinite(v) && v > 0));
  assert(
    noiseRecord.integratedInputNoise > 0 &&
      noiseRecord.integratedOutputNoise > 0,
  );

  validateNoiseIntegral(noiseRecord);
  const summary = {
    scope: "starter-electrical-sanity-not-model-qualification",
    status: checks.every((c) => c.passed) ? "passed" : "failed",
    environments: Object.fromEntries(
      [...runs].map(([id, r]) => [id, r.result.metadata.environment]),
    ),
    environment: runs.get("ota-op").result.metadata.environment,
    checks,
    commonSource: {
      outputV: csOut,
      supplyA: csCurrent,
      gm: csGm,
      gds: csGds,
      gainEstimate,
      smallSignalPP: meas("cs-tran", "output_pp", 1),
      largeSignalPP: meas("cs-tran", "output_pp", 2),
      distortion: csDistortion,
    },
    ota: {
      ac: otaAC,
      outputV: otaOut,
      supplyA: -scalar(probe(otaOp, "VDD:flow(br)")),
      deviceValues: otaOp.probes.filter(
        (p) =>
          p.name.includes(".gm") ||
          p.name.includes(".gds") ||
          p.name.includes(".v") ||
          p.name.endsWith(".id"),
      ),
      noise: {
        integratedInputV: noiseRecord.integratedInputNoise,
        integratedOutputV: noiseRecord.integratedOutputNoise,
        minFrequencyHz: noiseRecord.frequencyHz[0],
        maxFrequencyHz: noiseRecord.frequencyHz.at(-1),
        inputAt1Hz: noiseRecord.inputNoiseDensity[0],
        outputAt1Hz: noiseRecord.outputNoiseDensity[0],
      },
    },
    measurements: Object.fromEntries(
      [...runs].map(([id, r]) => [id, r.measurements]),
    ),
  };
  return summary;
}
