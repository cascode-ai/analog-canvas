import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { importSpiceSources } from "../packages/spice/dist/index.js";
import {
  parseProject,
  serializeProject,
} from "../packages/project-protocol/dist/index.js";
import {
  createSimulationFolder,
  createRoutePath,
  CircuitProjectSchema,
} from "../packages/model/dist/index.js";
import { executeTransaction } from "../packages/edit-engine/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";
import { renderDocumentSvg } from "../packages/render-svg/dist/index.js";
import { createFormalExportSource } from "../packages/exporters/dist/index.js";
import { exportFormalArtifacts } from "../packages/exporters/dist/node.js";
import { buildAgentSessionSnapshot } from "../packages/agent-adapter/dist/index.js";
import {
  compileSourceSimulation,
  nativeSimulationDevices,
  nativeDeviceOpVectors,
} from "../packages/netlist/dist/index.js";

const output = resolve(process.argv[2] ?? "output/native-simulation-examples");
const otaInput = process.argv[3] ?? "netlists/native-ota/source.icproj.json";
const profile = JSON.parse(
  await readFile("containers/ngspice/hosted-sky130-profile.json", "utf8"),
);
await mkdir(output, { recursive: true });
const manifest = [];
let sequence = 0;
const pt = (x, y) => ({ x, y });
const terminal = (instanceId, pinName) => ({
  kind: "terminal",
  instanceId,
  pinName,
});
function tx(project, doc, edits) {
  const result = executeTransaction(
    doc,
    {
      transactionId: `example-${++sequence}`,
      documentId: doc.id,
      expectedRevision: doc.revision,
      actor: { kind: "agent", id: "native-examples" },
      edits,
    },
    { symbolResolver: createProjectSymbolResolver(project, builtInSymbols) },
  );
  assert(
    result.ok,
    JSON.stringify({ error: result.error, diagnostics: result.diagnostics }),
  );
  project.documents[project.documents.findIndex((d) => d.id === doc.id)] =
    result.document;
  return result.document;
}
function label(instance, x, y, kind = "instance-label") {
  return {
    kind: "upsert_schematic_annotation",
    annotation: {
      id: `${kind}-${instance.id}`,
      kind,
      binding: {
        kind:
          kind === "instance-label" ? "instance-reference" : "instance-value",
        instanceId: instance.id,
      },
      anchor: { kind: "free", position: pt(x, y) },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
  };
}
function note(id, text, x, y) {
  return {
    kind: "upsert_drafting_object",
    object: {
      id,
      kind: "text",
      content: { runs: [{ kind: "text", value: text }] },
      anchor: { kind: "free", position: pt(x, y) },
      alignment: "start",
      rotation: 0,
      locked: false,
      zIndex: 0,
    },
  };
}
async function imported(slug, name, text, placements, wires, descriptions) {
  const input = await importSpiceSources(
    [{ path: "circuit.spi", bytes: new TextEncoder().encode(text) }],
    "circuit.spi",
  );
  assert(
    input.project && !input.diagnostics.some((d) => d.severity === "error"),
    JSON.stringify(input.diagnostics),
  );
  const project = input.project;
  project.id = `project-${slug}`;
  project.name = name;
  let doc = project.documents[0];
  doc.id = `cell-${slug}`;
  doc.name = name;
  doc.netlist.name = slug.replaceAll("-", "_");
  doc.sourceBinding.cellName = doc.netlist.name;
  project.topDocumentId = doc.id;
  const edit = [];
  for (const instance of doc.instances) {
    const [x, y, rotation = 0] = placements[instance.id];
    edit.push({
      kind: "place_instance",
      instanceId: instance.id,
      placement: { position: pt(x, y), rotation, mirror: "none" },
    });
    const mos = instance.symbolId === "nmos" || instance.symbolId === "pmos";
    edit.push(
      label(
        instance,
        mos ? x + 70 : x + (rotation ? -20 : 25),
        y + (rotation ? -55 : mos ? -35 : -15),
      ),
    );
    edit.push(
      label(
        instance,
        mos ? x + 90 : x + (rotation ? -20 : 25),
        y + (rotation ? -25 : 15),
        "instance-value",
      ),
    );
  }
  // Each supply return has its own real ground marker; no invisible connectivity substitute.
  const grounds = wires.filter((w) => w[1] === "ground");
  for (const [from, , [x, y], id] of grounds) {
    edit.push({
      kind: "add_instance",
      instance: {
        id,
        symbolId: "ground",
        placement: { position: pt(x, y), rotation: 0, mirror: "none" },
      },
    });
  }
  descriptions.forEach((text, i) =>
    edit.push(note(`description-${i}`, text, 20, 20 + i * 25)),
  );
  doc = tx(project, doc, edit);
  for (const [a, b, bendsOrPos, id] of wires) {
    const from = terminal(...a),
      to = b === "ground" ? terminal(id, "0") : terminal(...b);
    const net = doc.nets.find((n) =>
      n.terminals.some((t) => t.instanceId === a[0] && t.pinName === a[1]),
    );
    assert(net, JSON.stringify(a));
    if (b === "ground")
      doc = tx(project, doc, [{ kind: "connect_endpoints", from, to }]);
    const bends = b === "ground" ? [] : (bendsOrPos ?? []).map((p) => pt(...p));
    doc = tx(project, doc, [
      {
        kind: "set_route_path",
        route: createRoutePath({
          id: `wire-${++sequence}`,
          netId: net.id,
          start: from,
          end: to,
          bends,
          modes: Array(bends.length + 1).fill("manual"),
        }),
      },
    ]);
  }
  const netLabels = [];
  for (const name of ["in", "out"]) {
    const netId = doc.connectivityEvidence.find(
      (e) => e.kind === "net-name-hint" && e.sourceName === name,
    )?.netId;
    if (!netId) continue;
    const [x, y] =
      name === "in"
        ? (placements.VIN ?? placements.V1)
        : (placements.CL ?? placements[slug === "rc-highpass" ? "R1" : "C1"]);
    netLabels.push({
      kind: "upsert_schematic_annotation",
      annotation: {
        id: `net-${name}`,
        kind: "net-label",
        netId,
        binding: { kind: "net-name", netId },
        anchor: {
          kind: "free",
          position: pt(name === "in" ? x - 50 : x + 20, y - 65),
        },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
    });
    netLabels.push({
      kind: "upsert_connectivity_evidence",
      evidence: {
        id: `name-${name}`,
        kind: "name-claim",
        netId,
        name,
        scope: "local",
        owner: { kind: "net-label", annotationId: `net-${name}` },
      },
    });
  }
  doc = tx(project, doc, netLabels);
  return project;
}
function source(project, docId, id, parameters) {
  const doc = project.documents.find((d) => d.id === docId);
  tx(project, doc, [
    {
      kind: "patch_instance_netlist_parameters",
      instanceId: id,
      set: parameters,
    },
  ]);
}
const pulse = {
  dc: "0",
  acMagnitude: "1",
  waveform: "pulse",
  low: "0",
  high: "1",
  delay: "100u",
  rise: "100n",
  fall: "100n",
  width: "2m",
  period: "4m",
};
function experiment(project, id, name, commands, options = {}) {
  const folder = createSimulationFolder({
    id,
    name,
    profileId: profile.id,
    documentId: options.docId ?? project.topDocumentId,
    ...(options.dut ? { dut: options.dut } : {}),
  });
  if (options.model)
    folder.input.dependencies = [
      {
        id: profile.models.id,
        sha256: profile.models.contentSha256,
        mountPath: "icm-models.lib",
      },
    ];
  const model = options.model
    ? `.lib "icm-models.lib" ${options.corner ?? "tt"}\n`
    : "";
  const head = `* ${name}\n* Native Code owns all electrical intent. Run without legacy settings.\n.temp 27\n${model}.include "circuit.spice"\n${options.dut ? '.include "testbench.spice"\n' : ""}${options.pre ?? ""}`;
  if (options.tb)
    folder.input.files.find((f) => f.path === "testbench.spice").text =
      options.tb;
  folder.input.files.find((f) => f.path === "run.cir").text =
    head +
    ".control\nset filetype=ascii\nset appendwrite\n" +
    commands.join("\n") +
    "\n.endc\n.end\n";
  project.simulationFolders.push(folder);
  return folder;
}
async function deliver(project, slug, description) {
  project = CircuitProjectSchema.parse(project);
  for (const folder of project.simulationFolders) {
    assert.equal(
      JSON.parse(
        folder.input.files.find((f) => f.path === folder.input.configPath).text,
      ).version,
      2,
    );
    const compiled = compileSourceSimulation(project, folder);
    assert(
      compiled.ok,
      JSON.stringify({
        folder: folder.name,
        diagnostics: compiled.diagnostics,
      }),
    );
  }
  const file = join(output, `${slug}.icproj.json`);
  await writeFile(file, serializeProject(project));
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  for (const doc of project.documents) {
    await writeFile(
      join(output, `${slug}-${doc.id}.svg`),
      renderDocumentSvg(doc, resolver),
    );
    const artifacts = await exportFormalArtifacts(
      createFormalExportSource(doc, resolver, { title: doc.name }),
      2,
    );
    await writeFile(join(output, `${slug}-${doc.id}.png`), artifacts.png.bytes);
    const snap = buildAgentSessionSnapshot({
      project,
      document: doc,
      resolver,
    });
    await writeFile(
      join(output, `${slug}-${doc.id}-inspection.json`),
      JSON.stringify(snap, null, 2),
    );
    console.log(doc.name, JSON.stringify(snap.document.diagnostics));
  }
  for (const folder of project.simulationFolders) {
    const dir = join(output, "source", slug, folder.id);
    await mkdir(dir, { recursive: true });
    for (const f of folder.input.files)
      await writeFile(join(dir, f.path), f.text);
  }
  manifest.push({
    slug,
    file,
    name: project.name,
    description,
    projectId: project.id,
    folders: project.simulationFolders.map((f) => ({ id: f.id, name: f.name })),
    documents: project.documents.map((d) => ({ id: d.id, name: d.name })),
  });
}

const rcText = await readFile("netlists/native-rc-filters/circuit.spi", "utf8");
const rc = await imported(
  "rc-lowpass",
  "RC Filters — Low-pass & High-pass",
  rcText,
  { V1: [100, 260], R1: [260, 160, 270], C1: [420, 260] },
  [
    [["V1", "+"], ["R1", "1"], [[100, 160]]],
    [["R1", "2"], ["C1", "1"], [[420, 160]]],
    [["V1", "-"], "ground", [100, 310], "GND1"],
    [["C1", "2"], "ground", [420, 310], "GND2"],
  ],
  [
    "RC low-pass: R = 10 kohm, C = 10 nF",
    "Expected fc = 1591.55 Hz; tau = 100 us.",
  ],
);
const hp = await imported(
  "rc-highpass",
  "RC High-pass",
  rcText.replace("R1 in out 10k\nC1 out 0 10n", "C1 in out 10n\nR1 out 0 10k"),
  { V1: [100, 260], C1: [260, 160, 270], R1: [420, 260] },
  [
    [["V1", "+"], ["C1", "1"], [[100, 160]]],
    [["C1", "2"], ["R1", "1"], [[420, 160]]],
    [["V1", "-"], "ground", [100, 310], "GND1"],
    [["R1", "2"], "ground", [420, 310], "GND2"],
  ],
  [
    "RC high-pass: complementary first-order response",
    "Expected fc = 1591.55 Hz; step response decays to zero.",
  ],
);
rc.documents.push(hp.documents[0]);
for (const doc of rc.documents) {
  source(rc, doc.id, "V1", pulse);
  const high = doc.id.includes("highpass"),
    prefix = high ? "hp" : "lp";
  experiment(
    rc,
    `rc-${prefix}-ac`,
    `${high ? "03" : "01"} ${high ? "High" : "Low"}-pass | AC`,
    [
      "save v(in) v(out) i(v1)",
      "ac dec 80 10 1Meg",
      "let gain_db = db(v(out)/v(in))",
      "let phase_deg = 180/PI*cph(v(out)/v(in))",
      "meas ac gain_at_fc FIND gain_db AT=1591.549431",
      "write out.raw v(in) v(out) gain_db phase_deg",
    ],
    { docId: doc.id },
  );
  experiment(
    rc,
    `rc-${prefix}-tran`,
    `${high ? "04" : "02"} ${high ? "High" : "Low"}-pass | Step`,
    [
      "save v(in) v(out) i(v1)",
      "tran 1u 1m 0 1u",
      "meas tran at_one_tau FIND v(out) AT=200.05u",
      "meas tran final_value FIND v(out) AT=1m",
      "write out.raw",
    ],
    { docId: doc.id },
  );
}
await deliver(
  rc,
  "01-rc-filters",
  "Complementary RC filters, independent frequency/time-domain expectations.",
);

const rlc = await imported(
  "rlc-filter",
  "RLC Filter — Damping Laboratory",
  await readFile("netlists/native-rlc-filter/circuit.spi", "utf8"),
  { V1: [100, 300], R1: [240, 180, 270], L1: [400, 180, 270], C1: [540, 300] },
  [
    [["V1", "+"], ["R1", "1"], [[100, 180]]],
    [["R1", "2"], ["L1", "1"], []],
    [["L1", "2"], ["C1", "1"], [[540, 180]]],
    [["V1", "-"], "ground", [100, 350], "GND1"],
    [["C1", "2"], "ground", [540, 350], "GND2"],
  ],
  [
    "RLC low-pass: L = 10 mH, C = 100 nF",
    "f0 = 5032.92 Hz; critical R = 632.456 ohm.",
    "Each experiment explicitly alters R1 for its damping case.",
  ],
);
source(rlc, rlc.topDocumentId, "V1", pulse);
for (const [index, label, resistance] of [
  [1, "Underdamped", 200],
  [2, "Critical", 632.455532],
  [3, "Overdamped", 1000],
])
  experiment(rlc, `rlc-${index}`, `0${index} ${label} | AC + Step`, [
    `alter R1 ${resistance}`,
    "save v(in) v(out) i(l1)",
    "ac dec 100 100 1Meg",
    "let gain_db = db(v(out))",
    "meas ac peak_gain_db MAX gain_db",
    "write out.raw",
    "tran 0.5u 1m 0 0.5u",
    "meas tran peak_output MAX v(out)",
    "meas tran final_value FIND v(out) AT=1m",
    "write out.raw",
  ]);
await deliver(
  rlc,
  "02-rlc-filter",
  "Same Canvas circuit, three explicit native damping experiments; select all folders for Batch.",
);

const cs = await imported(
  "common-source",
  "SKY130 Common-source Amplifier",
  await readFile("netlists/native-common-source/circuit.spi", "utf8"),
  {
    VDD: [100, 190],
    VIN: [100, 400],
    RD: [350, 190],
    XM1: [340, 400],
    CL: [540, 400],
  },
  [
    [
      ["VDD", "+"],
      ["RD", "1"],
      [
        [100, 110],
        [350, 110],
      ],
    ],
    [["RD", "2"], ["XM1", "D"], []],
    [
      ["VIN", "+"],
      ["XM1", "G"],
      [
        [100, 340],
        [260, 340],
        [260, 400],
      ],
    ],
    [
      ["XM1", "D"],
      ["CL", "1"],
      [
        [350, 300],
        [540, 300],
      ],
    ],
    [["VDD", "-"], "ground", [100, 240], "GND1"],
    [["VIN", "-"], "ground", [100, 450], "GND2"],
    [["XM1", "S"], "ground", [350, 470], "GND3"],
    [
      ["XM1", "B"],
      ["XM1", "S"],
      [
        [400, 400],
        [400, 440],
        [350, 440],
      ],
    ],
    [["CL", "2"], "ground", [540, 450], "GND4"],
  ],
  [
    "SKY130 NMOS resistor-loaded common-source amplifier",
    "VDD = 1.8 V; Vbias = 0.7 V; RD = 10 kohm; CL = 1 pF",
    "Small/large signals use native alter commands, not hidden JSON overrides.",
  ],
);
source(cs, cs.topDocumentId, "VIN", {
  dc: "0.7",
  acMagnitude: "1",
  waveform: "sin",
  offset: "0.7",
  amplitude: "10m",
  frequency: "10k",
});
const bias = experiment(
  cs,
  "cs-op",
  "01 Bias | Native Device OP",
  ["op", "write out.raw"],
  { model: true },
);
const vectors = nativeSimulationDevices(cs, bias.input).flatMap(
  nativeDeviceOpVectors,
);
bias.input.files.find((f) => f.path === "run.cir").text = bias.input.files
  .find((f) => f.path === "run.cir")
  .text.replace(
    "\nop\n",
    `\nsave v(in) v(out) i(vdd) ${vectors.join(" ")}\nop\n`,
  );
experiment(
  cs,
  "cs-dc",
  "02 DC transfer",
  ["save v(in) v(out) i(vdd)", "dc VIN 0.3 1.2 0.005", "write out.raw"],
  { model: true },
);
experiment(
  cs,
  "cs-ac",
  "03 AC gain and bandwidth",
  [
    "save v(in) v(out)",
    "ac dec 80 10 1G",
    "let gain_db = db(v(out)/v(in))",
    "let phase_deg = 180/PI*cph(v(out)/v(in))",
    "meas ac gain_db_1khz FIND gain_db AT=1k",
    "write out.raw",
  ],
  { model: true },
);
experiment(
  cs,
  "cs-tran",
  "04 Small and large signal | Native loop",
  [
    "save v(in) v(out)",
    "foreach amplitude 0.01 0.2",
    "alter @VIN[sin] = [ 0.7 $amplitude 10k ]",
    "tran 0.2u 400u 0 0.2u",
    "meas tran output_pp PP v(out) FROM=200u TO=400u",
    "write out.raw",
    "end",
  ],
  { model: true },
);
await deliver(
  cs,
  "03-common-source",
  "DC, small-signal gain, native device values, and two transient amplitudes in one control loop.",
);

const ota = parseProject(await readFile(otaInput, "utf8"));
ota.id = "project-native-ota-laboratory";
ota.name = "SKY130 OTA — Open & Closed Loop";
ota.simulationFolders = [];
const tb = "document-ota-5t-testbench";
ota.topDocumentId = tb;
for (const [name, x, y] of [
  ["vinp", 450, 285],
  ["vinn", 450, 340],
  ["vdd", 580, 150],
  ["ibias", 570, 245],
]) {
  const doc = ota.documents.find((d) => d.id === tb);
  const netId = doc.nets.find((n) =>
    n.terminals.some((t) => t.instanceId === "XDUT" && t.pinName === name),
  )?.id;
  assert(netId, `OTA testbench pin ${name} must resolve to a real Net`);
  const annotationId = `native-net-${name}`;
  tx(ota, doc, [
    {
      kind: "upsert_schematic_annotation",
      annotation: {
        id: annotationId,
        kind: "net-label",
        netId,
        binding: { kind: "net-name", netId },
        anchor: { kind: "free", position: pt(x, y) },
        alignment: "start",
        rotation: 0,
        locked: false,
      },
    },
    {
      kind: "upsert_connectivity_evidence",
      evidence: {
        id: `native-name-${name}`,
        kind: "name-claim",
        netId,
        name,
        scope: "local",
        owner: { kind: "net-label", annotationId },
      },
    },
  ]);
}
tx(
  ota,
  ota.documents.find((d) => d.id === tb),
  [
    note(
      "native-guide-1",
      "Native OTA laboratory: bias, DC, AC corners, transient, noise and feedback.",
      280,
      30,
    ),
    note(
      "native-guide-2",
      "Five-transistor core plus bias transistor XM6. Open-loop pulse is not settling time.",
      280,
      55,
    ),
  ],
);
const op = experiment(
  ota,
  "ota-op",
  "01 Bias | Native Device OP",
  ["op", "write out.raw"],
  { docId: tb, model: true },
);
const otaVectors = nativeSimulationDevices(ota, op.input).flatMap(
  nativeDeviceOpVectors,
);
op.input.files.find((f) => f.path === "run.cir").text = op.input.files
  .find((f) => f.path === "run.cir")
  .text.replace(
    "\nop\n",
    `\nsave v(vout) v(ibias) v(xdut.tail) v(xdut.nleft) i(vdd) ${otaVectors.join(" ")}\nop\nlet supply_current = -i(vdd)\nprint supply_current\n`,
  );
experiment(
  ota,
  "ota-dc",
  "02 DC transfer",
  [
    "save v(vinp) v(vout) v(xdut.tail)",
    "dc VINP 0.86 0.94 0.001",
    "write out.raw",
  ],
  { docId: tb, model: true },
);
for (const [i, corner] of ["tt", "ff", "ss"].entries())
  experiment(
    ota,
    `ota-ac-${corner}`,
    `0${i + 3} Open-loop AC | ${corner.toUpperCase()}`,
    [
      "save v(vinp) v(vout)",
      "ac dec 60 1 1G",
      "let gain_db = db(v(vout)/v(vinp))",
      "let phase_deg = 180/PI*cph(v(vout)/v(vinp))",
      "meas ac dc_gain_db FIND gain_db AT=1",
      "meas ac unity_gain_hz WHEN gain_db=0 FALL=1",
      "write out.raw",
    ],
    { docId: tb, model: true, corner },
  );
experiment(
  ota,
  "ota-tran",
  "06 Open-loop input pulse",
  [
    "save v(vinp) v(vout)",
    "tran 2n 6u 0 2n",
    "meas tran output_max MAX v(vout)",
    "meas tran output_min MIN v(vout)",
    "write out.raw",
  ],
  { docId: tb, model: true },
);
experiment(
  ota,
  "ota-noise",
  "07 Input and output noise",
  ["noise v(vout) VINP dec 30 1 1G", "write out.raw noise1.all noise2.all"],
  { docId: tb, model: true },
);
const closedTb =
  "* Unity follower: vout feeds VINN; only the DUT is generated from Canvas.\nVDD vdd 0 1.8\nVINP vinp 0 DC 0.9 AC 1 PULSE(0.9 0.91 1u 1n 1n 2u 5u)\nIBIAS vdd ibias 15u\nXDUT 0 ibias vdd vout vinp vout ota_5t\nCL vout 0 1p\n";
experiment(
  ota,
  "ota-closed",
  "08 Unity feedback | AC + Step",
  [
    "save v(vinp) v(vout) i(vdd)",
    "ac dec 60 1 1G",
    "let gain_db = db(v(vout))",
    "meas ac closed_gain_db FIND gain_db AT=1",
    "write out.raw",
    "tran 1n 6u 0 1n",
    "meas tran output_at_2us FIND v(vout) AT=2u",
    "meas tran output_peak MAX v(vout) FROM=1u TO=3u",
    "write out.raw",
  ],
  {
    docId: "document-ota-5t",
    dut: {
      name: "ota_5t",
      ports: ["0", "ibias", "vdd", "vinn", "vinp", "vout"],
    },
    tb: closedTb,
    model: true,
  },
);
await deliver(
  ota,
  "04-sky130-ota",
  "Preserved user OTA drawing with native experiments and an explicit text-authored unity-feedback TB.",
);
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify({ profileId: profile.id, projects: manifest }, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    manifest.map((p) => ({ file: p.file, experiments: p.folders.length })),
    null,
    2,
  ),
);
