import { readFileSync } from "node:fs";

export const profile = JSON.parse(
  readFileSync(
    new URL(
      "../../containers/ngspice/hosted-sky130-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
export const qualification = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/simulation-acceptance/hosted-sky130-core-continuous-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
export const extendedQualification = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/simulation-acceptance/hosted-sky130-extended-devices-v1.json",
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

export const EXECUTORS = ["operator-host"];
export const SHA256 = /^[0-9a-f]{64}$/u;
export const REQUEST_ERRORS = new Set([
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
      "XQP pc pb pe sky130_fd_pr__pnp_05v5_W0p68L0p68",
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

async function qualificationProject() {
  const { parseProject } = await import("@icm/project-protocol");
  return parseProject(
    readFileSync(
      new URL(`../../${qualification.inputs.project}`, import.meta.url),
      "utf8",
    ),
  );
}

async function prepareQualification(project, setup, timeoutMs) {
  const { prepareSourceExecutionInput, CapabilitiesSchema } =
    await import("@icm/simulation-service");
  const { readSimulationExperimentConfig } = await import("@icm/model");
  const parsed = readSimulationExperimentConfig(setup);
  if (!parsed.ok) throw Error(parsed.message);
  if (
    parsed.config.environment.profileId !== qualification.profileId ||
    parsed.config.environment.corner !== qualification.modelLibrary.section
  )
    throw Error(
      `Qualification ${qualification.fixtureId} does not select its declared Profile/corner`,
    );
  const capabilities = CapabilitiesSchema.parse({
    configured: true,
    rawfileCollection: "declared-single-ascii",
    inputs: ["source"],
    analyses: profile.qualifiedScope.analyses,
    parsedAnalyses: profile.qualifiedScope.analyses,
    profiles: [
      {
        id: profile.id,
        corners: profile.qualifiedScope.sections,
        dependencies: [
          { id: profile.models.id, sha256: profile.models.contentSha256 },
        ],
      },
    ],
    modelLibrary: {
      path: profile.models.library.runtimePath,
      section: qualification.modelLibrary.section,
    },
    maxInputBytes: 1048576,
    maxTimeoutMs: 120000,
    cancel: true,
  });
  const compiled = await prepareSourceExecutionInput(
    project,
    setup,
    capabilities,
  );
  if (!compiled.ok)
    throw Error(
      `Qualification ${qualification.fixtureId} did not compile: ${JSON.stringify(compiled.error)}`,
    );
  return { ...compiled, request: { ...compiled.input, timeoutMs } };
}

function setProgram(setup, commands) {
  const entry = setup.input.files.find(
    (file) => file.path === setup.input.entry,
  );
  if (!entry) throw Error("Qualification entry is missing");
  // This qualification owns its native control template; it is not a general author-code rewrite.
  entry.text = [
    "* Qualified source experiment",
    ...setup.input.circuitBindings.map(
      (binding) => `.include "${binding.path}"`,
    ),
    ".control",
    "set filetype=ascii",
    "set appendwrite",
    ...commands,
    ".endc",
    ".end",
    "",
  ].join("\n");
}

export async function compileHostedSky130Project() {
  const project = await qualificationProject(),
    setup = project.simulationSetups[0];
  if (!setup) throw Error("Qualification Project has no saved experiment");
  return prepareQualification(project, setup, 110000);
}

export async function compileHostedSky130TransientProject() {
  const project = await qualificationProject(),
    setup = project.simulationSetups[0];
  const expected = qualification.expectedTran;
  const source = project.documents
    .flatMap((d) => d.instances)
    .find((i) => i.id === expected.source.instanceId);
  if (!setup || !source?.netlist)
    throw Error("Qualification source/setup is missing");
  source.symbolId = "pulse-voltage-source";
  source.netlist.parameters = { ...expected.source.parameters };
  const { stepSeconds, stopSeconds, startSeconds, maxStepSeconds } =
    expected.analysis;
  const args = [
    stepSeconds,
    stopSeconds,
    ...(startSeconds !== undefined || maxStepSeconds !== undefined
      ? [startSeconds ?? 0]
      : []),
    ...(maxStepSeconds !== undefined ? [maxStepSeconds] : []),
  ];
  setProgram(setup, [`tran ${args.join(" ")}`, "write out.raw"]);
  return prepareQualification(project, setup, 60000);
}

export async function compileHostedSky130NoiseProject() {
  const project = await qualificationProject(),
    setup = project.simulationSetups[0];
  if (!setup) throw Error("Qualification source/setup is missing");
  const { readSimulationExperimentConfig, replaceSimulationExperimentConfig } =
    await import("@icm/model");
  const parsed = readSimulationExperimentConfig(setup);
  if (!parsed.ok) throw Error(parsed.message);
  // Resolve the qualified Canvas output through the same acquisition compiler, not a guessed Net ID.
  const nominal = await prepareQualification(project, setup, 110000);
  const expected = qualification.expectedNoise.analysis;
  const output = nominal.outputs.find((o) => o.id === expected.outputProbeId);
  const acquisition =
    output?.expression.kind === "acquisition"
      ? output.expression.acquisitionId
      : undefined;
  const vector = nominal.vectors.find((v) => v.probeId === acquisition)?.vector;
  const root = project.documents.find(
    (d) =>
      d.id ===
      setup.input.circuitBindings.find((b) => b.emission === "top-level")
        ?.documentId,
  );
  const source = root?.instances.find(
    (i) => i.id === expected.inputSourceInstanceId,
  )?.reference;
  if (!vector || !source)
    throw Error("Qualification Noise acquisition is unresolved");
  parsed.config.outputs = [];
  parsed.config.measurements = [];
  parsed.config.deviceOperatingPoints = [];
  const noise = replaceSimulationExperimentConfig(setup, parsed.config);
  setProgram(noise, [
    `noise ${vector} ${source} ${expected.sweep} ${expected.points} ${expected.startHz} ${expected.stopHz}`,
    "write out.raw noise1.all noise2.all",
  ]);
  return prepareQualification(project, noise, 110000);
}
