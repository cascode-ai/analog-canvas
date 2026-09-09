/**
 * Preview's numerical simulation smoke.
 *
 * The deck is sent through every configured hosted transport — since
 * 2026-09-04 that is the operator host alone; the Cloudflare Container was
 * removed. A green HTTP response is not enough: the selected executor,
 * terminal outcome, rawfile-derived operating-point value, and measured
 * simulator/model identity all have to be present, and when more than one
 * transport is configured their environment fingerprints must agree because
 * they run the same pinned image.
 */
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const profile = JSON.parse(
  readFileSync(
    new URL(
      "../containers/ngspice/hosted-sky130-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const qualification = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/simulation-acceptance/hosted-sky130-core-continuous-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const extendedQualification = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/simulation-acceptance/hosted-sky130-extended-devices-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
if (qualification.profileId !== profile.id) {
  throw new Error(
    `Qualification ${qualification.fixtureId} targets ${String(qualification.profileId)}, not Profile ${profile.id}.`,
  );
}
if (extendedQualification.profileId !== profile.id) {
  throw new Error(
    `Qualification ${extendedQualification.fixtureId} targets ${String(extendedQualification.profileId)}, not Profile ${profile.id}.`,
  );
}
const evidencedDevices = new Set([
  ...(qualification.devices ?? []),
  ...(extendedQualification.devices ?? []),
]);
if (
  evidencedDevices.size !== profile.qualifiedScope.devices.length ||
  profile.qualifiedScope.devices.some((device) => !evidencedDevices.has(device))
) {
  throw new Error(
    `Profile ${profile.id} device scope is not fully backed by tracked qualification fixtures.`,
  );
}
for (const analysis of qualification.analyses) {
  if (!profile.qualifiedScope.analyses.includes(analysis)) {
    throw new Error(
      `Qualification ${qualification.fixtureId} uses undeclared analysis ${String(analysis)}.`,
    );
  }
}
for (const analysis of extendedQualification.analyses) {
  if (!profile.qualifiedScope.analyses.includes(analysis)) {
    throw new Error(
      `Qualification ${extendedQualification.fixtureId} uses undeclared analysis ${String(analysis)}.`,
    );
  }
}
if (
  qualification.modelLibrary.directive !== profile.models.library.directive ||
  !profile.models.library.sections.includes(qualification.modelLibrary.section)
) {
  throw new Error(
    `Qualification ${qualification.fixtureId} uses a model selection outside Profile ${profile.id}.`,
  );
}
const qualificationCorners = Object.keys(qualification.expectedCorners ?? {});
if (
  qualificationCorners.length === 0 ||
  qualificationCorners.some(
    (corner) => !profile.qualifiedScope.sections.includes(corner),
  ) ||
  profile.qualifiedScope.sections.some(
    (corner) => !qualificationCorners.includes(corner),
  )
) {
  throw new Error(
    `Qualification ${qualification.fixtureId} does not cover every declared Profile corner.`,
  );
}
const extendedQualificationCorners = Object.keys(
  extendedQualification.expectedCorners ?? {},
);
if (
  extendedQualification.modelLibrary?.directive !==
    profile.models.library.directive ||
  extendedQualificationCorners.length === 0 ||
  extendedQualificationCorners.some(
    (corner) => !profile.qualifiedScope.sections.includes(corner),
  ) ||
  profile.qualifiedScope.sections.some(
    (corner) => !extendedQualificationCorners.includes(corner),
  )
) {
  throw new Error(
    `Qualification ${extendedQualification.fixtureId} does not cover the Profile model selection.`,
  );
}

const EXECUTORS = ["operator-host"];
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUEST_ERRORS = new Set([
  "deck-too-large",
  "invalid-json",
  "invalid-request",
  "method-not-allowed",
]);

export const DIVIDER_REQUEST = {
  netlist: [
    ".subckt divider in out",
    "R1 in out 1k",
    "R2 out 0 1k",
    ".ends divider",
  ].join("\n"),
  testbench: [
    "V1 in 0 DC 1",
    "X1 in mid divider",
    ".control",
    "set filetype=ascii",
    "op",
    "write out.raw v(mid)",
    ".endc",
    ".end",
  ].join("\n"),
  timeoutMs: 110_000,
};

export const RC_TRAN_REQUEST = {
  mode: "raw",
  netlist: "",
  testbench: [
    "RC transient qualification",
    "V1 in 0 PULSE(0 1 0 1n 1n 5u 10u)",
    "R1 in out 1k",
    "C1 out 0 1n",
    ".control",
    "set filetype=ascii",
    "tran 10n 10u",
    "write out.raw v(in) v(out)",
    ".endc",
    ".end",
  ].join("\n"),
  timeoutMs: 30_000,
};

export const DIVIDER_DC_REQUEST = {
  mode: "raw",
  netlist: "",
  testbench: [
    "DC divider qualification",
    "V1 in 0 DC 0",
    "R1 in out 1k",
    "R2 out 0 1k",
    ".control",
    "set filetype=ascii",
    "dc V1 0 1.5 0.5",
    "write out.raw v(in) v(out) i(v1)",
    ".endc",
    ".end",
  ].join("\n"),
  timeoutMs: 30_000,
};

export const RESISTOR_NOISE_REQUEST = {
  mode: "raw",
  netlist: "",
  testbench: [
    "Resistor thermal-noise qualification",
    "V1 in 0 DC 0 AC 1",
    "R1 in out 1k",
    "R2 out 0 1k",
    ".control",
    "set filetype=ascii",
    "noise v(out) V1 dec 3 10 1k",
    "write out.raw noise1.all noise2.all",
    ".endc",
    ".end",
  ].join("\n"),
  timeoutMs: 30_000,
};

export function hostedSky130CornerRequest(corner) {
  return {
    netlist: [
      ".subckt corner_pair gn dn gp sp dp",
      "XMN dn gn 0 0 sky130_fd_pr__nfet_01v8 L=0.5 W=10",
      "XMP dp gp sp sp sky130_fd_pr__pfet_01v8 L=0.5 W=10",
      ".ends corner_pair",
    ].join("\n"),
    testbench: [
      "VGN gn 0 0.9",
      "VDN dn 0 1.8",
      "VGP gp 0 0.9",
      "VSP sp 0 1.8",
      "VDP dp 0 0",
      "XDUT gn dn gp sp dp corner_pair",
      ".control",
      "set filetype=ascii",
      "op",
      "write out.raw i(vdn) i(vsp)",
      ".endc",
      ".end",
    ].join("\n"),
    timeoutMs: 110_000,
    inputRevision: `preview-sky130-corner-${corner}`,
    environment: { profileId: profile.id, corner },
  };
}

export function hostedSky130ExtendedDeviceRequest(corner) {
  return {
    netlist: [
      ".subckt extended_models gnl dnl gpl spl dpl rin rout capin capout pc pb pe",
      "XMNL dnl gnl 0 0 sky130_fd_pr__nfet_01v8_lvt L=0.5 W=3 nf=2",
      "XMPL dpl gpl spl spl sky130_fd_pr__pfet_01v8_lvt L=0.5 W=3 nf=2",
      "XR1 rin rout 0 sky130_fd_pr__res_high_po w=1 l=5.5 mult=1",
      "XC1 capout 0 sky130_fd_pr__cap_mim_m3_1 w=5 l=5 mf=1",
      "XQP pc pb pe 0 sky130_fd_pr__pnp_05v5_W0p68L0p68",
      ".ends extended_models",
    ].join("\n"),
    testbench: [
      "* Extended device qualification",
      "VGNL gnl 0 0.9",
      "VDNL dnl 0 1.8",
      "VGPL gpl 0 0.9",
      "VSPL spl 0 1.8",
      "VDPL dpl 0 0",
      "VRIN rin 0 1",
      "RLOAD rout 0 1k",
      "VAC capin 0 DC 0 AC 1",
      "RCAP capin capout 1g",
      "VPE pe 0 1.8",
      "VPB pb 0 1.1",
      "VPC pc 0 0",
      "XDUT gnl dnl gpl spl dpl rin rout capin capout pc pb pe extended_models",
      ".control",
      "set filetype=ascii",
      "op",
      "write out.raw i(vdnl) i(vspl) v(rout) i(vrin) i(vpe) i(vpc)",
      "set appendwrite",
      "ac lin 1 1g 1g",
      "write out.raw v(capout)",
      ".endc",
      ".end",
    ].join("\n"),
    timeoutMs: 110_000,
    inputRevision: `preview-sky130-extended-${corner}`,
    environment: { profileId: profile.id, corner },
  };
}

export async function compileHostedSky130Project() {
  const [{ compileStructuredSimulation }, { parseProject }] = await Promise.all(
    [import("@icm/netlist"), import("@icm/project-protocol")],
  );
  const project = parseProject(
    readFileSync(
      new URL(`../${qualification.inputs.project}`, import.meta.url),
      "utf8",
    ),
  );
  const setup = project.simulationSetups[0];
  if (!setup) {
    throw new Error(
      `Qualification ${qualification.fixtureId} Project has no persisted SimulationSetup.`,
    );
  }
  const selection = setup.input.environment;
  if (
    selection.profileId !== qualification.profileId ||
    selection.corner !== qualification.modelLibrary.section
  ) {
    throw new Error(
      `Qualification ${qualification.fixtureId} Project does not select its declared Profile and corner.`,
    );
  }
  const compiled = await compileStructuredSimulation(project, setup, {
    timeoutMs: 110_000,
  });
  if (!compiled.ok) {
    throw new Error(
      `Qualification ${qualification.fixtureId} did not compile: ${compiled.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join(" | ")}`,
    );
  }
  return compiled;
}

export async function compileHostedSky130TransientProject() {
  const [{ compileStructuredSimulation }, { parseProject }] = await Promise.all(
    [import("@icm/netlist"), import("@icm/project-protocol")],
  );
  const project = parseProject(
    readFileSync(
      new URL(`../${qualification.inputs.project}`, import.meta.url),
      "utf8",
    ),
  );
  const expected = qualification.expectedTran;
  const source = project.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.id === expected.source.instanceId);
  const setup = project.simulationSetups[0];
  if (!source?.netlist || !setup) {
    throw new Error(
      `Qualification ${qualification.fixtureId} has no transient source or setup.`,
    );
  }
  source.symbolId = "pulse-voltage-source";
  source.netlist.parameters = { ...expected.source.parameters };
  setup.input.analyses = [{ ...expected.analysis }];
  const compiled = await compileStructuredSimulation(project, setup, {
    timeoutMs: 60_000,
  });
  if (!compiled.ok) {
    throw new Error(
      `Qualification ${qualification.fixtureId} TRAN did not compile: ${compiled.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join(" | ")}`,
    );
  }
  return compiled;
}

export async function compileHostedSky130NoiseProject() {
  const [{ compileStructuredSimulation }, { parseProject }] = await Promise.all(
    [import("@icm/netlist"), import("@icm/project-protocol")],
  );
  const project = parseProject(
    readFileSync(
      new URL(`../${qualification.inputs.project}`, import.meta.url),
      "utf8",
    ),
  );
  const expected = qualification.expectedNoise;
  const setup = project.simulationSetups[0];
  const output =
    setup?.input.kind === "structured"
      ? setup.input.outputs.find(
          (candidate) => candidate.id === expected.analysis.outputProbeId,
        )
      : undefined;
  if (
    !setup ||
    setup.input.kind !== "structured" ||
    !output ||
    output.expression.kind !== "voltage"
  ) {
    throw new Error(
      `Qualification ${qualification.fixtureId} has no Noise output probe.`,
    );
  }
  const { kind: _kind, ...positive } = output.expression;
  setup.input.analyses = [
    {
      kind: "noise",
      output: { positive },
      inputSourceInstanceId: expected.analysis.inputSourceInstanceId,
      sweep: expected.analysis.sweep,
      points: expected.analysis.points,
      startHz: expected.analysis.startHz,
      stopHz: expected.analysis.stopHz,
    },
  ];
  setup.input.outputs = [];
  const compiled = await compileStructuredSimulation(project, setup, {
    timeoutMs: 110_000,
  });
  if (!compiled.ok) {
    throw new Error(
      `Qualification ${qualification.fixtureId} Noise did not compile: ${compiled.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join(" | ")}`,
    );
  }
  return compiled;
}

function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is absent or is not an object.`);
  }
  return value;
}

function diagnosticSummary(payload) {
  if (!Array.isArray(payload.diagnostics)) return "no diagnostics";
  const messages = payload.diagnostics
    .map((item) =>
      typeof item === "object" && item !== null && "text" in item
        ? String(item.text)
        : "",
    )
    .filter(Boolean);
  return messages.length > 0
    ? messages.slice(0, 3).join(" | ")
    : "no diagnostics";
}

function validatePinnedEnvironment(environment, target) {
  const simulator = object(environment.simulator, "simulator identity");
  const models = object(environment.models, "model identity");
  if (environment.reproducibility !== "pinned") {
    throw new Error(`${target} did not verify its runtime as pinned.`);
  }
  if (environment.profileId !== profile.id) {
    throw new Error(
      `${target} reported Profile ${String(environment.profileId)}, expected ${profile.id}.`,
    );
  }
  if (
    simulator.name !== profile.simulator.name ||
    simulator.version !== profile.simulator.version ||
    simulator.binarySha256 !== profile.simulator.binarySha256
  ) {
    throw new Error(`${target} does not match the Profile simulator identity.`);
  }
  if (
    models.id !== profile.models.id ||
    models.contentSha256 !== profile.models.contentSha256
  ) {
    throw new Error(`${target} does not match the Profile model identity.`);
  }
  if (environment.startupSha256 !== profile.startup.contentSha256) {
    throw new Error(`${target} does not match the Profile startup identity.`);
  }
  if (!SHA256.test(String(environment.fingerprint))) {
    throw new Error(`${target} returned no valid environment fingerprint.`);
  }
  return { simulator, models };
}

export function validatePreviewSimulationResult(payload, expectedTarget) {
  const result = object(payload, "simulation response");
  const execution = object(result.execution, "execution metadata");
  if (execution.target !== expectedTarget) {
    throw new Error(
      `[result:wrong-executor] requested ${expectedTarget}, but the Worker reported ${String(execution.target)}.`,
    );
  }

  const outcome = object(result.outcome, "simulation outcome");
  if (outcome.status !== "completed") {
    const layer = outcome.status === "timed-out" ? "run" : "simulation";
    throw new Error(
      `[${layer}:${String(outcome.status)}] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  }

  const metadata = object(result.metadata, "run metadata");
  const input = object(metadata.input, "input metadata");
  const expectedRevision = `preview-smoke-${expectedTarget}`;
  if (input.inputRevision !== expectedRevision) {
    throw new Error(
      `[result:stale-input] requested ${expectedRevision}, but the Worker returned ${String(input.inputRevision)}.`,
    );
  }
  const environment = object(metadata.environment, "environment metadata");
  const { simulator } = validatePinnedEnvironment(environment, expectedTarget);

  const data = object(result.data, "parsed result data");
  if (!Array.isArray(data.analyses)) {
    throw new Error(`${expectedTarget} returned no parsed analyses.`);
  }
  const operatingPoint = data.analyses.find(
    (analysis) =>
      typeof analysis === "object" &&
      analysis !== null &&
      analysis.analysis === "op",
  );
  if (!operatingPoint || !Array.isArray(operatingPoint.probes)) {
    throw new Error(`${expectedTarget} returned no operating-point analysis.`);
  }
  const midpoint = operatingPoint.probes.find(
    (probe) =>
      typeof probe === "object" && probe !== null && probe.name === "v(mid)",
  );
  if (!midpoint || typeof midpoint.value !== "number") {
    throw new Error(`${expectedTarget} returned no scalar v(mid).`);
  }
  if (Math.abs(midpoint.value - 0.5) > 1e-12) {
    throw new Error(
      `${expectedTarget} solved the equal divider as ${midpoint.value}, expected 0.5.`,
    );
  }

  return {
    target: expectedTarget,
    value: midpoint.value,
    environmentFingerprint: environment.fingerprint,
    simulatorVersion: simulator.version,
  };
}

function transientAnalysis(payload, expectedTarget) {
  const result = object(payload, "simulation response");
  const execution = object(result.execution, "execution metadata");
  if (execution.target !== expectedTarget) {
    throw new Error(
      `[result:wrong-executor] requested ${expectedTarget}, but the Worker reported ${String(execution.target)}.`,
    );
  }
  if (object(result.outcome, "simulation outcome").status !== "completed") {
    throw new Error(
      `[simulation:tran] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  }
  validatePinnedEnvironment(
    object(object(result.metadata, "run metadata").environment, "environment"),
    expectedTarget,
  );
  const data = object(result.data, "parsed result data");
  const tran = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "tran",
      )
    : null;
  if (
    !tran ||
    !Array.isArray(tran.timeSeconds) ||
    !Array.isArray(tran.probes)
  ) {
    throw new Error(`${expectedTarget} returned no structured TRAN result.`);
  }
  return { result, tran };
}

export function validateRcTransientResult(payload, expectedTarget) {
  const { tran } = transientAnalysis(payload, expectedTarget);
  if (
    tran.timeSeconds.length !== 1027 ||
    Math.abs(tran.timeSeconds.at(-1) - 1e-5) > 1e-15
  ) {
    throw new Error(`${expectedTarget} returned an unexpected RC time axis.`);
  }
  const output = tran.probes.find((probe) => probe?.name === "v(out)");
  if (!output || !Array.isArray(output.value)) {
    throw new Error(`${expectedTarget} returned no RC v(out) series.`);
  }
  const maximum = Math.max(...output.value);
  const last = output.value.at(-1);
  if (
    typeof last !== "number" ||
    Math.abs(maximum - 0.9932657010978244) > 1e-10 ||
    Math.abs(last - 0.006702329182061853) > 1e-10
  ) {
    throw new Error(
      `${expectedTarget} returned unexpected RC step values (max=${maximum}, last=${String(last)}).`,
    );
  }
  return { target: expectedTarget, pointCount: tran.timeSeconds.length };
}

export function validateDcDividerResult(payload, expectedTarget) {
  const result = object(payload, "simulation response");
  if (object(result.outcome, "simulation outcome").status !== "completed") {
    throw new Error(
      `[simulation:dc] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  }
  validatePinnedEnvironment(
    object(object(result.metadata, "run metadata").environment, "environment"),
    expectedTarget,
  );
  const data = object(result.data, "parsed result data");
  const dc = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "dc",
      )
    : null;
  if (!dc || !Array.isArray(dc.sweep?.values) || !Array.isArray(dc.probes)) {
    throw new Error(`${expectedTarget} returned no structured DC result.`);
  }
  if (dc.sweep.name !== "v(v-sweep)") {
    throw new Error(`${expectedTarget} returned an unexpected DC sweep axis.`);
  }
  const expectedAxis = [0, 0.5, 1, 1.5];
  if (
    dc.sweep.values.length !== expectedAxis.length ||
    dc.sweep.values.some((value, index) => value !== expectedAxis[index])
  ) {
    throw new Error(`${expectedTarget} returned unexpected DC sweep values.`);
  }
  const output = dc.probes.find((probe) => probe?.name === "v(out)");
  if (
    !output ||
    !Array.isArray(output.value) ||
    output.value.some(
      (value, index) => Math.abs(value - expectedAxis[index] / 2) > 1e-12,
    )
  ) {
    throw new Error(
      `${expectedTarget} returned an incorrect DC divider curve.`,
    );
  }
  return { target: expectedTarget, pointCount: expectedAxis.length };
}

export function validateHostedSky130TransientResult(
  payload,
  expectedTarget,
  expectedInputRevision,
  expectedVectors,
) {
  const { result, tran } = transientAnalysis(payload, expectedTarget);
  const metadata = object(result.metadata, "run metadata");
  const input = object(metadata.input, "input metadata");
  if (input.inputRevision !== expectedInputRevision) {
    throw new Error(`${expectedTarget} returned stale structured TRAN data.`);
  }
  const modelLibrary = object(
    object(metadata.configuration, "configuration metadata").modelLibrary,
    "model selection",
  );
  if (
    modelLibrary.directive !== qualification.modelLibrary.directive ||
    modelLibrary.section !== qualification.modelLibrary.section
  ) {
    throw new Error(
      `${expectedTarget} did not run TRAN with the qualified model-library section.`,
    );
  }
  const expected = qualification.expectedTran;
  if (
    tran.timeSeconds.length !== expected.pointCount ||
    Math.abs(tran.timeSeconds.at(-1) - expected.stopSeconds) >
      expected.timeAbsoluteTolerance
  ) {
    throw new Error(`${expectedTarget} returned an unexpected OTA time axis.`);
  }
  for (const binding of expectedVectors) {
    const probe = tran.probes.find(
      (candidate) => candidate?.name === binding.vector,
    );
    if (
      !probe ||
      !Array.isArray(probe.value) ||
      probe.value.length !== expected.pointCount
    ) {
      throw new Error(
        `${expectedTarget} returned no complete TRAN series for ${binding.vector}.`,
      );
    }
  }
  for (const [name, expectation] of Object.entries(expected.probes)) {
    const probe = tran.probes.find((candidate) => candidate?.name === name);
    if (!probe || !Array.isArray(probe.value)) {
      throw new Error(
        `${expectedTarget} returned no qualified TRAN series ${name}.`,
      );
    }
    const actual = {
      first: probe.value[0],
      minimum: Math.min(...probe.value),
      maximum: Math.max(...probe.value),
      last: probe.value.at(-1),
    };
    for (const key of ["first", "minimum", "maximum", "last"]) {
      if (
        typeof actual[key] !== "number" ||
        Math.abs(actual[key] - expectation[key]) > expectation.absoluteTolerance
      ) {
        throw new Error(
          `${expectedTarget} solved TRAN ${name}.${key} as ${String(actual[key])}, expected ${expectation[key]}.`,
        );
      }
    }
  }
  return { target: expectedTarget, pointCount: tran.timeSeconds.length };
}

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1);
}

function relativeValueError(actual, expected, absoluteTolerance = 0) {
  return (
    Math.abs(actual - expected) /
    Math.max(Math.abs(expected), absoluteTolerance || Number.MIN_VALUE)
  );
}

function parsedNoiseAnalysis(payload, expectedTarget) {
  const result = object(payload, "simulation response");
  if (object(result.execution, "execution metadata").target !== expectedTarget)
    throw new Error(`${expectedTarget} did not execute the Noise analysis.`);
  if (object(result.outcome, "simulation outcome").status !== "completed")
    throw new Error(
      `[simulation:noise] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  const environment = object(
    object(result.metadata, "run metadata").environment,
    "environment",
  );
  validatePinnedEnvironment(environment, expectedTarget);
  const data = object(result.data, "parsed result data");
  const noise = Array.isArray(data.analyses)
    ? data.analyses.find((analysis) => analysis?.analysis === "noise")
    : null;
  if (
    !noise ||
    !Array.isArray(noise.frequencyHz) ||
    !Array.isArray(noise.outputNoiseDensity) ||
    !Array.isArray(noise.inputNoiseDensity)
  )
    throw new Error(`${expectedTarget} returned no structured Noise result.`);
  return { result, environment, noise };
}

export function validateResistorNoiseResult(payload, expectedTarget) {
  const { noise } = parsedNoiseAnalysis(payload, expectedTarget);
  if (noise.frequencyHz.length !== 7)
    throw new Error(`${expectedTarget} returned an unexpected Noise axis.`);
  const kelvin = 273.15 + 27;
  const boltzmann = 1.380649e-23;
  const expectedOutputDensity = Math.sqrt(4 * boltzmann * kelvin * 500);
  const firstOutput = noise.outputNoiseDensity[0];
  const firstInput = noise.inputNoiseDensity[0];
  if (
    typeof firstOutput !== "number" ||
    relativeValueError(firstOutput, expectedOutputDensity) > 2e-4 ||
    typeof firstInput !== "number" ||
    relativeValueError(firstInput, expectedOutputDensity * 2) > 2e-4
  )
    throw new Error(
      `${expectedTarget} returned resistor Noise inconsistent with 4kTR.`,
    );
  const expectedIntegrated = expectedOutputDensity * Math.sqrt(990);
  if (
    typeof noise.integratedOutputNoise !== "number" ||
    relativeValueError(noise.integratedOutputNoise, expectedIntegrated) >
      2e-4 ||
    typeof noise.integratedInputNoise !== "number" ||
    relativeValueError(noise.integratedInputNoise, expectedIntegrated * 2) >
      2e-4
  )
    throw new Error(`${expectedTarget} returned incorrect integrated Noise.`);
  return {
    target: expectedTarget,
    pointCount: noise.frequencyHz.length,
    outputDensity: firstOutput,
  };
}

export function validateHostedSky130NoiseResult(
  payload,
  expectedTarget,
  expectedInputRevision,
) {
  const { result, environment, noise } = parsedNoiseAnalysis(
    payload,
    expectedTarget,
  );
  const metadata = object(result.metadata, "run metadata");
  if (
    object(metadata.input, "input metadata").inputRevision !==
    expectedInputRevision
  )
    throw new Error(`${expectedTarget} returned stale structured Noise data.`);
  const modelLibrary = object(
    object(metadata.configuration, "configuration metadata").modelLibrary,
    "model selection",
  );
  if (
    modelLibrary.directive !== qualification.modelLibrary.directive ||
    modelLibrary.section !== qualification.modelLibrary.section
  )
    throw new Error(
      `${expectedTarget} did not run Noise with the qualified model-library section.`,
    );
  const expected = qualification.expectedNoise;
  if (environment.fingerprint !== expected.evidence.environmentFingerprint)
    throw new Error(
      `${expectedTarget} Noise evidence came from a different environment.`,
    );
  if (
    noise.frequencyHz.length !== expected.pointCount ||
    noise.outputNoiseDensity.length !== expected.pointCount ||
    noise.inputNoiseDensity.length !== expected.pointCount
  )
    throw new Error(
      `${expectedTarget} returned an incomplete OTA Noise result.`,
    );
  for (const sample of expected.samples) {
    const frequency = noise.frequencyHz[sample.index];
    const output = noise.outputNoiseDensity[sample.index];
    const input = noise.inputNoiseDensity[sample.index];
    if (
      typeof frequency !== "number" ||
      relativeValueError(frequency, sample.frequencyHz) >
        expected.frequencyRelativeTolerance ||
      typeof output !== "number" ||
      (Math.abs(output - sample.outputNoiseDensity) >
        expected.valueAbsoluteTolerance &&
        relativeValueError(
          output,
          sample.outputNoiseDensity,
          expected.valueAbsoluteTolerance,
        ) > expected.valueRelativeTolerance) ||
      typeof input !== "number" ||
      (Math.abs(input - sample.inputNoiseDensity) >
        expected.valueAbsoluteTolerance &&
        relativeValueError(
          input,
          sample.inputNoiseDensity,
          expected.valueAbsoluteTolerance,
        ) > expected.valueRelativeTolerance)
    )
      throw new Error(
        `${expectedTarget} returned unexpected OTA Noise at index ${sample.index}.`,
      );
  }
  for (const [key, expectedValue] of [
    ["integratedOutputNoise", expected.integratedOutputNoise],
    ["integratedInputNoise", expected.integratedInputNoise],
  ]) {
    const actual = noise[key];
    if (
      typeof actual !== "number" ||
      relativeValueError(
        actual,
        expectedValue,
        expected.valueAbsoluteTolerance,
      ) > expected.valueRelativeTolerance
    )
      throw new Error(
        `${expectedTarget} returned unexpected OTA ${key}: ${String(actual)}.`,
      );
  }
  if (JSON.stringify(noise.units) !== JSON.stringify(expected.units))
    throw new Error(`${expectedTarget} returned unexpected Noise units.`);
  return {
    target: expectedTarget,
    pointCount: noise.frequencyHz.length,
    integratedOutputNoise: noise.integratedOutputNoise,
    integratedInputNoise: noise.integratedInputNoise,
    environmentFingerprint: environment.fingerprint,
  };
}

export function validateHostedSky130Result(
  payload,
  expectedTarget,
  expectedInputRevision,
  expectedVectors,
) {
  const result = object(payload, "simulation response");
  const execution = object(result.execution, "execution metadata");
  if (execution.target !== expectedTarget) {
    throw new Error(
      `[result:wrong-executor] requested ${expectedTarget}, but the Worker reported ${String(execution.target)}.`,
    );
  }
  if (object(result.outcome, "simulation outcome").status !== "completed") {
    throw new Error(
      `[simulation:model-qualification] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  }
  const metadata = object(result.metadata, "run metadata");
  const input = object(metadata.input, "input metadata");
  if (input.inputRevision !== expectedInputRevision) {
    throw new Error(
      `[result:stale-input] requested ${expectedInputRevision}, but the Worker returned ${String(input.inputRevision)}.`,
    );
  }
  const configuration = object(
    metadata.configuration,
    "configuration metadata",
  );
  const modelLibrary = object(configuration.modelLibrary, "model selection");
  if (
    modelLibrary.directive !== qualification.modelLibrary.directive ||
    modelLibrary.section !== qualification.modelLibrary.section
  ) {
    throw new Error(
      `${expectedTarget} did not run the qualified model-library section.`,
    );
  }
  const environment = object(metadata.environment, "environment metadata");
  validatePinnedEnvironment(environment, expectedTarget);

  const data = object(result.data, "parsed result data");
  const operatingPoint = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "op",
      )
    : null;
  if (!operatingPoint || !Array.isArray(operatingPoint.probes)) {
    throw new Error(`${expectedTarget} returned no qualified OP result.`);
  }

  const values = {};
  for (const [name, expected] of Object.entries(qualification.expectedProbes)) {
    const probe = operatingPoint.probes.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        candidate.name === name,
    );
    if (!probe || typeof probe.value !== "number") {
      throw new Error(`${expectedTarget} returned no scalar ${name}.`);
    }
    if (Math.abs(probe.value - expected.value) > expected.absoluteTolerance) {
      throw new Error(
        `${expectedTarget} solved ${name} as ${probe.value}, expected ${expected.value} ± ${expected.absoluteTolerance}.`,
      );
    }
    values[name] = probe.value;
  }

  const dc = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "dc",
      )
    : null;
  const expectedDc = qualification.expectedDc;
  if (!dc || !Array.isArray(dc.sweep?.values) || !Array.isArray(dc.probes)) {
    throw new Error(`${expectedTarget} returned no qualified DC result.`);
  }
  if (
    dc.sweep.name !== expectedDc.sweepName ||
    dc.sweep.values.length !== expectedDc.pointCount ||
    Math.abs(dc.sweep.values[0] - expectedDc.startValue) >
      expectedDc.absoluteTolerance ||
    Math.abs(dc.sweep.values.at(-1) - expectedDc.stopValue) >
      expectedDc.absoluteTolerance
  ) {
    throw new Error(`${expectedTarget} returned an unexpected OTA DC axis.`);
  }
  for (const binding of expectedVectors) {
    const probe = dc.probes.find(
      (candidate) => candidate?.name === binding.vector,
    );
    if (!probe || !Array.isArray(probe.value)) {
      throw new Error(
        `${expectedTarget} returned no DC series for ${binding.probeId} (${binding.vector}).`,
      );
    }
    if (probe.value.length !== expectedDc.pointCount) {
      throw new Error(
        `${expectedTarget} returned an incomplete DC series for ${binding.vector}.`,
      );
    }
  }
  for (const [name, expected] of Object.entries(expectedDc.probes)) {
    const probe = dc.probes.find((candidate) => candidate?.name === name);
    if (!probe || !Array.isArray(probe.value)) {
      throw new Error(
        `${expectedTarget} returned no qualified DC series ${name}.`,
      );
    }
    for (const sample of expected.samples) {
      const actual = probe.value[sample.index];
      if (
        typeof actual !== "number" ||
        Math.abs(actual - sample.value) > expectedDc.absoluteTolerance
      ) {
        throw new Error(
          `${expectedTarget} solved ${name}[${sample.index}] as ${String(actual)}, expected ${sample.value} ± ${expectedDc.absoluteTolerance}.`,
        );
      }
    }
  }

  const ac = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "ac",
      )
    : null;
  if (!ac || !Array.isArray(ac.frequencyHz) || !Array.isArray(ac.probes)) {
    throw new Error(`${expectedTarget} returned no qualified AC result.`);
  }
  const expectedAc = qualification.expectedAc;
  if (ac.frequencyHz.length !== expectedAc.pointCount) {
    throw new Error(
      `${expectedTarget} returned ${ac.frequencyHz.length} AC points, expected ${expectedAc.pointCount}.`,
    );
  }
  const firstFrequency = ac.frequencyHz[0];
  const lastFrequency = ac.frequencyHz.at(-1);
  if (
    typeof firstFrequency !== "number" ||
    relativeError(firstFrequency, expectedAc.startHz) >
      expectedAc.frequencyRelativeTolerance ||
    typeof lastFrequency !== "number" ||
    relativeError(lastFrequency, expectedAc.stopHz) >
      expectedAc.frequencyRelativeTolerance
  ) {
    throw new Error(
      `${expectedTarget} returned an unexpected AC frequency axis (${String(firstFrequency)} .. ${String(lastFrequency)}).`,
    );
  }
  for (const binding of expectedVectors) {
    const probe = ac.probes.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        candidate.name === binding.vector,
    );
    if (!probe || !Array.isArray(probe.real) || !Array.isArray(probe.imag)) {
      throw new Error(
        `${expectedTarget} returned no AC series for ${binding.probeId} (${binding.vector}).`,
      );
    }
    if (
      probe.real.length !== expectedAc.pointCount ||
      probe.imag.length !== expectedAc.pointCount
    ) {
      throw new Error(
        `${expectedTarget} returned an incomplete AC series for ${binding.vector}.`,
      );
    }
  }
  for (const [name, expected] of Object.entries(expectedAc.probes)) {
    const probe = ac.probes.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        candidate.name === name,
    );
    if (!probe || !Array.isArray(probe.real) || !Array.isArray(probe.imag)) {
      throw new Error(
        `${expectedTarget} returned no qualified AC series ${name}.`,
      );
    }
    for (const sample of expected.samples) {
      const real = probe.real[sample.index];
      const imag = probe.imag[sample.index];
      if (
        typeof real !== "number" ||
        typeof imag !== "number" ||
        Math.abs(real - sample.real) > sample.absoluteTolerance ||
        Math.abs(imag - sample.imag) > sample.absoluteTolerance
      ) {
        throw new Error(
          `${expectedTarget} solved ${name}[${sample.index}] as ${String(real)} + j${String(imag)}, expected ${sample.real} + j${sample.imag} ± ${sample.absoluteTolerance}.`,
        );
      }
    }
  }
  validateHostedSky130TransientResult(
    payload,
    expectedTarget,
    expectedInputRevision,
    expectedVectors,
  );
  return {
    target: expectedTarget,
    fixtureId: qualification.fixtureId,
    values,
    environmentFingerprint: environment.fingerprint,
  };
}

export async function runHostedSky130Acceptance({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const compiled = await compileHostedSky130Project();
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...compiled.request,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `[protocol:non-json] ${target} model qualification answered HTTP ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  if (!response.ok) {
    const refusal = object(payload, "simulation refusal");
    throw new Error(
      `[infrastructure:${String(refusal.error ?? `http-${response.status}`)}] ${target} model qualification answered HTTP ${response.status}`,
    );
  }
  return validateHostedSky130Result(
    payload,
    target,
    compiled.request.inputRevision,
    compiled.vectors,
  );
}

export function validateHostedSky130CornerResult(
  payload,
  expectedTarget,
  corner,
) {
  const expected = qualification.expectedCorners?.[corner];
  if (!expected)
    throw new Error(`No qualification evidence exists for ${corner}.`);
  const result = object(payload, "simulation response");
  if (object(result.execution, "execution metadata").target !== expectedTarget)
    throw new Error(`${expectedTarget} did not execute corner ${corner}.`);
  if (object(result.outcome, "simulation outcome").status !== "completed")
    throw new Error(`${expectedTarget} did not complete corner ${corner}.`);
  const metadata = object(result.metadata, "run metadata");
  const configuration = object(
    metadata.configuration,
    "configuration metadata",
  );
  const modelLibrary = object(configuration.modelLibrary, "model selection");
  if (
    modelLibrary.directive !== profile.models.library.directive ||
    modelLibrary.section !== corner
  )
    throw new Error(
      `${expectedTarget} loaded ${String(modelLibrary.section)}, expected corner ${corner}.`,
    );
  const environment = object(metadata.environment, "environment metadata");
  validatePinnedEnvironment(environment, expectedTarget);
  if (
    environment.fingerprint !==
    qualification.cornerEvidence.environmentFingerprint
  )
    throw new Error(
      `${expectedTarget} corner evidence came from a different environment.`,
    );
  const data = object(result.data, "parsed result data");
  const operatingPoint = Array.isArray(data.analyses)
    ? data.analyses.find((analysis) => analysis?.analysis === "op")
    : null;
  if (!operatingPoint || !Array.isArray(operatingPoint.probes))
    throw new Error(`${expectedTarget} returned no OP result for ${corner}.`);
  const readCurrent = (name) => {
    const probe = operatingPoint.probes.find(
      (candidate) => candidate?.name === name,
    );
    if (typeof probe?.value !== "number")
      throw new Error(`${expectedTarget} returned no ${name} for ${corner}.`);
    return probe.value;
  };
  const nfetCurrentA = readCurrent("i(vdn)");
  const pfetSourceCurrentA = readCurrent("i(vsp)");
  const tolerance = qualification.cornerEvidence.absoluteTolerance;
  if (
    Math.abs(nfetCurrentA - expected.nfetCurrentA) > tolerance ||
    Math.abs(pfetSourceCurrentA - expected.pfetSourceCurrentA) > tolerance
  )
    throw new Error(
      `${expectedTarget} returned unexpected ${corner} currents ` +
        `(NFET=${nfetCurrentA}, PFET=${pfetSourceCurrentA}).`,
    );
  return { corner, nfetCurrentA, pfetSourceCurrentA };
}

export async function runHostedSky130CornerAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...hostedSky130CornerRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} corner qualification failed.`,
    );
  return validateHostedSky130CornerResult(payload, target, corner);
}

export function validateHostedSky130ExtendedDeviceResult(
  payload,
  expectedTarget,
  corner,
) {
  const expected = extendedQualification.expectedCorners?.[corner];
  if (!expected)
    throw new Error(`No extended-device evidence exists for ${corner}.`);
  const result = object(payload, "simulation response");
  if (object(result.execution, "execution metadata").target !== expectedTarget)
    throw new Error(
      `${expectedTarget} did not execute extended devices at ${corner}.`,
    );
  if (object(result.outcome, "simulation outcome").status !== "completed")
    throw new Error(
      `${expectedTarget} did not complete extended devices at ${corner}.`,
    );
  const metadata = object(result.metadata, "run metadata");
  const modelLibrary = object(
    object(metadata.configuration, "configuration metadata").modelLibrary,
    "model selection",
  );
  if (
    modelLibrary.directive !== profile.models.library.directive ||
    modelLibrary.section !== corner
  )
    throw new Error(
      `${expectedTarget} loaded ${String(modelLibrary.section)}, expected corner ${corner}.`,
    );
  const environment = object(metadata.environment, "environment metadata");
  validatePinnedEnvironment(environment, expectedTarget);
  if (
    environment.fingerprint !==
    extendedQualification.evidence.environmentFingerprint
  )
    throw new Error(
      `${expectedTarget} extended-device evidence came from a different environment.`,
    );
  const data = object(result.data, "parsed result data");
  const analyses = Array.isArray(data.analyses) ? data.analyses : [];
  const operatingPoint = analyses.find(
    (analysis) => analysis?.analysis === "op",
  );
  const ac = analyses.find((analysis) => analysis?.analysis === "ac");
  if (!Array.isArray(operatingPoint?.probes) || !Array.isArray(ac?.probes))
    throw new Error(
      `${expectedTarget} returned incomplete extended-device analyses for ${corner}.`,
    );
  const scalar = (name) => {
    const probe = operatingPoint.probes.find(
      (candidate) => candidate?.name === name,
    );
    if (typeof probe?.value !== "number")
      throw new Error(`${expectedTarget} returned no ${name} for ${corner}.`);
    return probe.value;
  };
  const cap = ac.probes.find((candidate) => candidate?.name === "v(capout)");
  if (
    !Array.isArray(cap?.real) ||
    !Array.isArray(cap?.imag) ||
    typeof cap.real[0] !== "number" ||
    typeof cap.imag[0] !== "number"
  )
    throw new Error(
      `${expectedTarget} returned no MIM AC response for ${corner}.`,
    );
  const actual = {
    lvtNfetCurrentA: scalar("i(vdnl)"),
    lvtPfetSourceCurrentA: scalar("i(vspl)"),
    resistorOutputV: scalar("v(rout)"),
    resistorSupplyCurrentA: scalar("i(vrin)"),
    pnpEmitterCurrentA: scalar("i(vpe)"),
    pnpCollectorCurrentA: scalar("i(vpc)"),
    mimOutputReal: cap.real[0],
    mimOutputImag: cap.imag[0],
  };
  const tolerances = extendedQualification.tolerances;
  const checks = [
    ["lvtNfetCurrentA", tolerances.mosCurrentA],
    ["lvtPfetSourceCurrentA", tolerances.mosCurrentA],
    ["resistorOutputV", tolerances.resistorVoltageV],
    ["resistorSupplyCurrentA", tolerances.resistorCurrentA],
    ["pnpEmitterCurrentA", tolerances.pnpCurrentA],
    ["pnpCollectorCurrentA", tolerances.pnpCurrentA],
    ["mimOutputReal", tolerances.mimComplex],
    ["mimOutputImag", tolerances.mimComplex],
  ];
  for (const [name, tolerance] of checks) {
    if (Math.abs(actual[name] - expected[name]) > tolerance)
      throw new Error(
        `${expectedTarget} solved ${name} at ${corner} as ${actual[name]}, expected ${expected[name]} ± ${tolerance}.`,
      );
  }
  return { corner, ...actual };
}

export async function runHostedSky130ExtendedDeviceAcceptance({
  baseUrl,
  target,
  corner,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...hostedSky130ExtendedDeviceRequest(corner),
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} ${corner} extended-device qualification failed.`,
    );
  return validateHostedSky130ExtendedDeviceResult(payload, target, corner);
}

export async function runHostedSky130TransientAcceptance({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const compiled = await compileHostedSky130TransientProject();
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...compiled.request, executorTarget: target }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} TRAN qualification failed.`,
    );
  }
  return validateHostedSky130TransientResult(
    payload,
    target,
    compiled.request.inputRevision,
    compiled.vectors,
  );
}

export async function runHostedSky130NoiseAcceptance({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const compiled = await compileHostedSky130NoiseProject();
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...compiled.request, executorTarget: target }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} Noise qualification failed.`,
    );
  return validateHostedSky130NoiseResult(
    payload,
    target,
    compiled.request.inputRevision,
  );
}

export async function runPreviewResistorNoiseSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...RESISTOR_NOISE_REQUEST,
      inputRevision: `preview-resistor-noise-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} resistor Noise smoke failed.`,
    );
  return validateResistorNoiseResult(payload, target);
}

export async function runPreviewTransientSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...RC_TRAN_REQUEST,
      inputRevision: `preview-rc-tran-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} RC TRAN smoke failed.`,
    );
  }
  return validateRcTransientResult(payload, target);
}

export async function runPreviewDcSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...DIVIDER_DC_REQUEST,
      inputRevision: `preview-divider-dc-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} DC smoke failed.`,
    );
  }
  return validateDcDividerResult(payload, target);
}

export async function runPreviewSimulationSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...DIVIDER_REQUEST,
      inputRevision: `preview-smoke-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `[protocol:non-json] ${target} answered HTTP ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  if (!response.ok) {
    const error = object(payload, "simulation refusal");
    const code = String(error.error ?? `http-${response.status}`);
    const layer = REQUEST_ERRORS.has(code) ? "request" : "infrastructure";
    throw new Error(
      `[${layer}:${code}] ${target} answered HTTP ${response.status}` +
        `${error.reason ? ` (${String(error.reason)})` : ""}` +
        `${error.message ? `: ${String(error.message)}` : ""}`,
    );
  }
  return validatePreviewSimulationResult(payload, target);
}

export function validateExecutorParity(results) {
  if (results.length === 0) {
    throw new Error("expected at least one executor result, received none.");
  }
  const fingerprints = new Set(
    results.map((result) => result.environmentFingerprint),
  );
  if (fingerprints.size !== 1) {
    throw new Error(
      `[result:environment-mismatch] Preview executors do not share one environment: ${results
        .map((result) => `${result.target}=${result.environmentFingerprint}`)
        .join(", ")}`,
    );
  }
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    throw new Error(
      "usage: node scripts/preview-simulation-smoke.mjs https://preview.example",
    );
  }
  const results = [];
  for (const target of EXECUTORS) {
    const result = await runPreviewSimulationSmoke({ baseUrl, target });
    results.push(result);
    console.log(
      `${result.target}: v(mid)=${result.value}, ${result.simulatorVersion}, environment=${result.environmentFingerprint}`,
    );
  }
  validateExecutorParity(results);
  console.log("Preview executor parity: passed");

  for (const target of EXECUTORS) {
    const result = await runPreviewTransientSmoke({ baseUrl, target });
    console.log(`${result.target}: RC TRAN ${result.pointCount} points passed`);
  }

  for (const target of EXECUTORS) {
    const result = await runPreviewDcSmoke({ baseUrl, target });
    console.log(
      `${result.target}: divider DC ${result.pointCount} points passed`,
    );
  }

  for (const target of EXECUTORS) {
    const result = await runPreviewResistorNoiseSmoke({ baseUrl, target });
    console.log(
      `${result.target}: resistor Noise ${result.pointCount} points passed`,
    );
  }

  const qualifications = [];
  for (const target of EXECUTORS) {
    const result = await runHostedSky130Acceptance({ baseUrl, target });
    qualifications.push(result);
    console.log(
      `${result.target}: ${result.fixtureId} passed, environment=${result.environmentFingerprint}`,
    );
  }
  validateExecutorParity(qualifications);
  for (const target of EXECUTORS) {
    const result = await runHostedSky130TransientAcceptance({
      baseUrl,
      target,
    });
    console.log(
      `${result.target}: SKY130 OTA TRAN ${result.pointCount} points passed`,
    );
  }
  for (const target of EXECUTORS) {
    const result = await runHostedSky130NoiseAcceptance({ baseUrl, target });
    console.log(
      `${result.target}: SKY130 OTA Noise ${result.pointCount} points passed ` +
        `(onoise=${result.integratedOutputNoise}, inoise=${result.integratedInputNoise})`,
    );
  }
  for (const target of EXECUTORS) {
    for (const corner of profile.qualifiedScope.sections) {
      const result = await runHostedSky130CornerAcceptance({
        baseUrl,
        target,
        corner,
      });
      console.log(
        `${target}: SKY130 ${result.corner.toUpperCase()} corner passed ` +
          `(NFET=${result.nfetCurrentA}, PFET=${result.pfetSourceCurrentA})`,
      );
      const extended = await runHostedSky130ExtendedDeviceAcceptance({
        baseUrl,
        target,
        corner,
      });
      console.log(
        `${target}: SKY130 ${extended.corner.toUpperCase()} extended devices passed`,
      );
    }
  }
  console.log(`Hosted SKY130 Profile ${profile.id}: qualified`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
