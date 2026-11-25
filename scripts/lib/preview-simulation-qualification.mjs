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
/**
 * The high-Vt 1.8 V PFET the HD standard cells are built from (#1596), at
 * every corner. Observed on the candidate image, whose measured environment
 * is the pinned Profile's: its evidence names that executor.
 */
export const hvtPfetQualification = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/simulation-acceptance/hosted-sky130-hvt-pfet-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
/**
 * The 5 V gate-oxide MOS pair Gallery model sources call, at every corner:
 * saturated OP currents and a 1 MHz AC transconductance.
 */
export const mos5vQualification = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/simulation-acceptance/hosted-sky130-5v-mos-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
/**
 * The 3.4 um vertical PNP Gallery model sources call (#1614), at every corner:
 * forward-active OP currents and a 1 MHz AC collector current (transconductance).
 */
export const largePnpQualification = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/simulation-acceptance/hosted-sky130-pnp-w3p40-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
/**
 * The four-terminal 5 V NPN Gallery model sources call, substrate tied low,
 * at every corner: forward-active OP collector and base currents and a 1 MHz
 * AC collector current (≈gm).
 */
export const npnQualification = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/simulation-acceptance/hosted-sky130-npn-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
/**
 * The SKY130 5 V junction diodes Gallery drawings place, at every corner: the
 * junction's own current forward and reverse, and the 1 MHz AC current of a
 * reverse-biased junction (its capacitance).
 */
export const diodeQualification = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/simulation-acceptance/hosted-sky130-diodes-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
/**
 * The SKY130 2 kOhm/sq high-resistance poly resistor (`res_xhigh_po`) at every
 * corner: nominal-width (w=1, l=10) and narrow-crowding (w=0.35, l=10) DC
 * currents plus 100 MHz AC differential conductance and substrate capacitance.
 */
export const resXhighPoQualification = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/simulation-acceptance/hosted-sky130-res-xhigh-po-v1.json",
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
  ...(hvtPfetQualification.devices ?? []),
  ...(mos5vQualification.devices ?? []),
  ...(largePnpQualification.devices ?? []),
  ...(npnQualification.devices ?? []),
  ...(diodeQualification.devices ?? []),
  ...(resXhighPoQualification.devices ?? []),
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

for (const fixture of [
  hvtPfetQualification,
  mos5vQualification,
  largePnpQualification,
  npnQualification,
  diodeQualification,
  resXhighPoQualification,
]) {
  const corners = Object.keys(fixture.expectedCorners ?? {});
  if (
    fixture.profileId !== profile.id ||
    fixture.modelLibrary?.directive !== profile.models.library.directive ||
    fixture.analyses.some(
      (analysis) => !profile.qualifiedScope.analyses.includes(analysis),
    ) ||
    corners.length === 0 ||
    profile.qualifiedScope.sections.some(
      (corner) => !corners.includes(corner),
    ) ||
    corners.some((corner) => !profile.qualifiedScope.sections.includes(corner))
  )
    throw new Error(
      `Qualification ${fixture.fixtureId} does not cover Profile ${profile.id}'s model selection.`,
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

export function hostedSky130HvtPfetRequest(corner) {
  return {
    netlist: [
      ".subckt hvt_pfet g s d",
      // The geometry of the HD cells' pull-up devices.
      "XMPH d g s s sky130_fd_pr__pfet_01v8_hvt L=0.15 W=1",
      ".ends hvt_pfet",
    ].join("\n"),
    testbench: [
      "* High-Vt PFET qualification",
      "VGPH gph 0 0",
      "VSPH sph 0 1.8",
      "VDPH dph 0 0",
      "XDUT gph sph dph hvt_pfet",
      ".control",
      "set filetype=ascii",
      "op",
      "write out.raw i(vsph)",
      ".endc",
      ".end",
    ].join("\n"),
    timeoutMs: 110_000,
    inputRevision: `preview-sky130-hvt-pfet-${corner}`,
    environment: { profileId: profile.id, corner },
  };
}

export function hostedSky130Mos5vRequest(corner) {
  return {
    netlist: [
      ".subckt mos_5v gn dn gp sp dp",
      "XMN5 dn gn 0 0 sky130_fd_pr__nfet_g5v0d10v5 L=0.5 W=3",
      "XMP5 dp gp sp sp sky130_fd_pr__pfet_g5v0d10v5 L=0.5 W=3",
      ".ends mos_5v",
    ].join("\n"),
    testbench: [
      "* 5 V MOS qualification",
      "VGN5 gn 0 DC 2.5 AC 1",
      "VDN5 dn 0 2.5",
      "VGP5 gp 0 DC 2.5 AC 1",
      "VSP5 sp 0 5",
      "VDP5 dp 0 2.5",
      "XDUT gn dn gp sp dp mos_5v",
      ".control",
      "set filetype=ascii",
      "op",
      "write out.raw i(vdn5) i(vsp5)",
      "set appendwrite",
      "ac lin 1 1meg 1meg",
      "write out.raw i(vdn5) i(vsp5)",
      ".endc",
      ".end",
    ].join("\n"),
    timeoutMs: 110_000,
    inputRevision: `preview-sky130-5v-mos-${corner}`,
    environment: { profileId: profile.id, corner },
  };
}

export function hostedSky130LargePnpRequest(corner) {
  return {
    netlist: [
      ".subckt pnp_w3p40 pc pb pe",
      "XQP3 pc pb pe sky130_fd_pr__pnp_05v5_W3p40L3p40",
      ".ends pnp_w3p40",
    ].join("\n"),
    testbench: [
      "* 3.4 um PNP qualification",
      "VPE3 pe 0 1.8",
      "VPB3 pb 0 DC 1.1 AC 1",
      "VPC3 pc 0 0",
      "XDUT pc pb pe pnp_w3p40",
      ".control",
      "set filetype=ascii",
      "op",
      "write out.raw i(vpe3) i(vpc3)",
      "set appendwrite",
      "ac lin 1 1meg 1meg",
      "write out.raw i(vpc3)",
      ".endc",
      ".end",
    ].join("\n"),
    timeoutMs: 110_000,
    inputRevision: `preview-sky130-pnp-w3p40-${corner}`,
    environment: { profileId: profile.id, corner },
  };
}

export function hostedSky130NpnRequest(corner) {
  return {
    netlist: [
      ".subckt npn_5v c b e s",
      "XQ1 c b e s sky130_fd_pr__npn_05v5_W1p00L1p00",
      ".ends npn_5v",
    ].join("\n"),
    testbench: [
      "* 5 V NPN qualification",
      "VCQ c 0 2",
      "VBQ b 0 DC 0.8 AC 1",
      "VEQ e 0 0",
      "VSQ s 0 0",
      "XDUT c b e s npn_5v",
      ".control",
      "set filetype=ascii",
      "op",
      "write out.raw i(vcq) i(vbq)",
      "set appendwrite",
      "ac lin 1 1meg 1meg",
      "write out.raw i(vcq)",
      ".endc",
      ".end",
    ].join("\n"),
    timeoutMs: 110_000,
    inputRevision: `preview-sky130-npn-${corner}`,
    environment: { profileId: profile.id, corner },
  };
}

/** The junction-current vectors the diode request writes, by diode and bias. */
export const DIODE_JUNCTIONS = [
  ["pw2nd", "n", "sky130_fd_pr__diode_pw2nd_05v5"],
  ["pd2nw", "p", "sky130_fd_pr__diode_pd2nw_05v5"],
].flatMap(([name, letter, master]) =>
  [
    ["Forward0p5", "f1", "0.5"],
    ["Forward0p6", "f2", "0.6"],
    ["Forward0p7", "f3", "0.7"],
    ["Reverse3p3", "r", "DC -3.3 AC 1"],
  ].map(([bias, node, source]) => ({
    key: `${name}${bias}A`,
    vector: `id${letter}${node}`,
    node: `${letter}${node}`,
    source,
    master,
  })),
);

export function hostedSky130DiodeRequest(corner) {
  // Each wrapper's series resistance (981 pΩ, over the area) is so small
  // that a terminal current reads only to about eps·V/RS, 2^-17 A at
  // 100 µm², and a leakage as 0: the junction's own current is compared.
  const nodes = DIODE_JUNCTIONS.map((junction) => junction.node).join(" ");
  return {
    netlist: [
      `.subckt diodes ${nodes}`,
      ...DIODE_JUNCTIONS.map(
        ({ node, master }) =>
          `XD${node.toUpperCase()} ${node} 0 ${master} area=100 perim=40`,
      ),
      ".ends diodes",
    ].join("\n"),
    testbench: [
      "* SKY130 diode qualification",
      ...DIODE_JUNCTIONS.map(
        ({ node, source }) => `V${node.toUpperCase()} ${node} 0 ${source}`,
      ),
      `XDUT ${nodes} diodes`,
      ".control",
      "set filetype=ascii",
      "op",
      ...DIODE_JUNCTIONS.map(
        ({ vector, node, master }) =>
          `let ${vector} = @d.xdut.xd${node}.d${master}[id]`,
      ),
      `write out.raw ${DIODE_JUNCTIONS.map((junction) => junction.vector).join(" ")}`,
      "set appendwrite",
      "ac lin 1 1meg 1meg",
      "write out.raw i(vnr) i(vpr)",
      ".endc",
      ".end",
    ].join("\n"),
    timeoutMs: 110_000,
    inputRevision: `preview-sky130-diodes-${corner}`,
    environment: { profileId: profile.id, corner },
  };
}

export function hostedSky130ResXhighPoRequest(corner) {
  return {
    netlist: [
      ".subckt res_xhigh rin rout nrin nrout sub",
      "XR1 rin rout sub sky130_fd_pr__res_xhigh_po w=1 l=10 mult=1",
      "XR2 nrin nrout sub sky130_fd_pr__res_xhigh_po w=0.35 l=10 mult=1",
      ".ends res_xhigh",
    ].join("\n"),
    testbench: [
      "* SKY130 res_xhigh_po qualification",
      "VRIN rin 0 DC 1 AC 1",
      "VROUT rout 0 0",
      "VNRIN nrin 0 1",
      "VNROUT nrout 0 0",
      "VSUB sub 0 0",
      "XDUT rin rout nrin nrout sub res_xhigh",
      ".control",
      "set filetype=ascii",
      "op",
      "write out.raw i(vrin) i(vrout) i(vnrin)",
      "set appendwrite",
      "ac lin 1 100meg 100meg",
      "write out.raw i(vrin) i(vrout)",
      ".endc",
      ".end",
    ].join("\n"),
    timeoutMs: 110_000,
    inputRevision: `preview-sky130-res-xhigh-po-${corner}`,
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

async function prepareQualification(project, folder, timeoutMs) {
  const { prepareSourceExecutionInput, CapabilitiesSchema } =
    await import("@icm/simulation-service");
  const { readSimulationExperimentConfig } = await import("@icm/model");
  const parsed = readSimulationExperimentConfig(folder);
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
    folder,
    capabilities,
  );
  if (!compiled.ok)
    throw Error(
      `Qualification ${qualification.fixtureId} did not compile: ${JSON.stringify(compiled.error)}`,
    );
  return { ...compiled, request: { ...compiled.input, timeoutMs } };
}

function setProgram(folder, commands) {
  const entry = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  );
  if (!entry) throw Error("Qualification entry is missing");
  // This qualification owns its native control template; it is not a general author-code rewrite.
  entry.text = [
    "* Qualified source experiment",
    ...folder.input.circuitBindings.map(
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
    folder = project.simulationFolders[0];
  if (!folder) throw Error("Qualification Project has no saved experiment");
  return prepareQualification(project, folder, 110000);
}

export async function compileHostedSky130TransientProject() {
  const project = await qualificationProject(),
    folder = project.simulationFolders[0];
  const expected = qualification.expectedTran;
  const source = project.documents
    .flatMap((d) => d.instances)
    .find((i) => i.id === expected.source.instanceId);
  if (!folder || !source?.netlist)
    throw Error("Qualification source/folder is missing");
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
  setProgram(folder, [`tran ${args.join(" ")}`, "write out.raw"]);
  return prepareQualification(project, folder, 60000);
}

export async function compileHostedSky130NoiseProject() {
  const project = await qualificationProject(),
    folder = project.simulationFolders[0];
  if (!folder) throw Error("Qualification source/folder is missing");
  const { readSimulationExperimentConfig, replaceSimulationExperimentConfig } =
    await import("@icm/model");
  const parsed = readSimulationExperimentConfig(folder);
  if (!parsed.ok) throw Error(parsed.message);
  // Resolve the qualified Canvas output through the same acquisition compiler, not a guessed Net ID.
  const nominal = await prepareQualification(project, folder, 110000);
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
      folder.input.circuitBindings.find((b) => b.emission === "top-level")
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
  const noise = replaceSimulationExperimentConfig(folder, parsed.config);
  setProgram(noise, [
    `noise ${vector} ${source} ${expected.sweep} ${expected.points} ${expected.startHz} ${expected.stopHz}`,
    "write out.raw noise1.all noise2.all",
  ]);
  return prepareQualification(project, noise, 110000);
}
