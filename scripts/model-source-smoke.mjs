// Qualified OP/AC acceptance for the branch's real model Apply/export/preparation.
// Build workspace packages first. Pass an HTTPS executor origin explicitly.
import assert from "node:assert/strict";
import {
  createEmptyProject,
  createSimulationFolder,
} from "../packages/model/dist/index.js";
import {
  executeProjectTransaction,
  createExternalSubcircuitInstance,
} from "../packages/edit-engine/dist/index.js";
import {
  analyzeDesignNetlist,
  createDesignNetlistExport,
} from "../packages/netlist/dist/index.js";
import { prepareNgspiceExecutionInput } from "../packages/simulation-service/dist/prepare-ngspice.js";
import { CapabilitiesSchema } from "../packages/simulation-service/dist/contract.js";
import { profile } from "./lib/preview-simulation-qualification.mjs";
import { validatePinnedEnvironment } from "./lib/preview-simulation-validation-core.mjs";

const origin = new URL(process.argv[2]);
assert.equal(origin.protocol, "https:");
const language = process.argv[3] ?? "spice";
assert(["spice", "spectre"].includes(language));
let project = createEmptyProject(
  "model-smoke",
  "Owned native model acceptance",
);
const source = {
  id: "finite-source",
  revision: 0,
  language,
  entry: language === "spice" ? "finite.spice" : "finite.scs",
  files: [
    {
      path: language === "spice" ? "finite.spice" : "finite.scs",
      text:
        language === "spectre"
          ? [
              "// Native Spectre source; execution uses the verified SPICE projection.",
              "subckt finite_gain (IN OUT VSS)",
              "parameters gain=10 poleHz=1000",
              "E1 (DRIVE VSS IN VSS) vcvs gain=gain",
              "R1 (DRIVE OUT) resistor r=1k",
              "C1 (OUT VSS) capacitor c=1/(6.283185307179586*1k*poleHz)",
              "ends finite_gain",
              "",
            ].join("\n")
          : [
              "* Preserve this native behavior and pole expression.",
              ".subckt finite_gain IN OUT VSS params: gain=10 poleHz=1000",
              "B1 DRIVE VSS V={gain*v(IN,VSS)}",
              "R1 DRIVE OUT 1k",
              "C1 OUT VSS {1/(6.283185307179586*1k*poleHz)}",
              ".ends finite_gain",
              "",
            ].join("\n"),
    },
  ],
  dependencies: [],
};
function apply(next) {
  const result = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "smoke-apply",
    actor: { kind: "human", id: "acceptance" },
    edits: [
      {
        kind: "apply_model_source",
        source: next,
        definitions: [{ definitionId: "finite", entry: "finite_gain" }],
      },
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  project = result.project;
}
apply(source);
const document = project.documents[0];
document.instances.push(
  createExternalSubcircuitInstance(
    "X1",
    project.externalSubcircuitDefinitions[0],
    { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
  ),
);
document.instances.push({
  id: "GND",
  symbolId: "ground",
  placement: { position: { x: 200, y: 300 }, rotation: 0, mirror: "none" },
});
document.nets.push(
  { id: "input", terminals: [{ instanceId: "X1", pinName: "IN" }] },
  { id: "output", terminals: [{ instanceId: "X1", pinName: "OUT" }] },
  {
    id: "ground",
    terminals: [
      { instanceId: "X1", pinName: "VSS" },
      { instanceId: "GND", pinName: "0" },
    ],
  },
);
document.annotations.push({
  id: "ground-name",
  kind: "power-label",
  netId: "ground",
  binding: { kind: "net-name", netId: "ground" },
  anchor: { kind: "free", position: { x: 0, y: 0 } },
  alignment: "start",
  rotation: 0,
  locked: false,
});
document.connectivityEvidence.push({
  id: "ground-claim",
  kind: "name-claim",
  netId: "ground",
  name: "0",
  scope: "global",
  powerDomain: "ground",
  owner: { kind: "net-label", annotationId: "ground-name" },
});
const analysis = analyzeDesignNetlist(project, {
  format: "spice",
  rootAsTopLevel: true,
});
assert(
  analysis.ir && !analysis.diagnostics.some((d) => d.severity === "error"),
  JSON.stringify(analysis.diagnostics),
);
const call = analysis.ir.cells
  .find((c) => c.id === document.id)
  .instances.find((i) => i.id === "X1");
const inputNode = call.nodes.find((n) => n.pinName === "IN").netName;
const outputNode = call.nodes.find((n) => n.pinName === "OUT").netName;
const folder = createSimulationFolder({
  id: "smoke",
  name: "Native behavioral OP AC",
  engine: "ngspice",
  profileId: profile.id,
  documentId: document.id,
});
folder.input.files.find((f) => f.path === folder.input.entry).text = [
  "Native behavioral OP AC",
  '.include "circuit.spice"',
  `VINPUT ${inputNode} 0 dc 0.1 ac 1`,
  ".control",
  "set filetype=ascii",
  "set appendwrite",
  "op",
  `write out.raw v(${outputNode})`,
  "ac lin 1 1000 1000",
  `write out.raw v(${outputNode})`,
  ".endc",
  ".end",
  "",
].join("\n");
const caps = CapabilitiesSchema.parse({
  configured: true,
  rawfileCollection: "declared-single-ascii",
  inputs: ["source"],
  analyses: profile.qualifiedScope.analyses,
  parsedAnalyses: profile.qualifiedScope.analyses,
  profiles: [
    {
      id: profile.id,
      engine: "ngspice",
      corners: profile.qualifiedScope.sections,
      dependencies: [
        { id: profile.models.id, sha256: profile.models.contentSha256 },
      ],
    },
  ],
  maxInputBytes: 1048576,
  maxTimeoutMs: 120000,
  cancel: true,
});
const receipts = [];
for (const gain of [10, 40]) {
  if (gain === 40)
    apply({
      ...project.modelSources[0],
      files: [
        {
          path: source.entry,
          text: source.files[0].text.replace("gain=10", "gain=40"),
        },
      ],
    });
  const exported = createDesignNetlistExport(project, { format: "spice" });
  assert.equal(exported.status, "ready", JSON.stringify(exported.diagnostics));
  assert.equal(exported.file.text.match(/\.subckt finite_gain\b/gu).length, 1);
  assert(exported.file.text.includes(`gain=${gain}`));
  const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const generated = prepared.input.files.find(
    (f) => f.path === "circuit.spice",
  );
  if (language === "spice")
    assert(generated.text.includes(project.modelSources[0].files[0].text));
  else {
    assert(
      generated.text.includes(".subckt finite_gain IN OUT VSS params: gain="),
    );
    assert(generated.text.includes("E1 DRIVE VSS IN VSS"));
    assert.equal(project.modelSources[0].language, "spectre");
  }
  assert(
    prepared.sourceMaps.some((m) =>
      m.segments.some(
        (s) =>
          s.origin.kind === "model-source" && s.origin.sourceId === source.id,
      ),
    ),
  );
  const response = await fetch(new URL("/api/simulate", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...prepared.input,
      timeoutMs: 15000,
      executorTarget: "operator-host",
    }),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  assert(response.ok, JSON.stringify(result));
  assert.equal(result.execution.target, "operator-host");
  assert.equal(
    result.outcome.status,
    "completed",
    JSON.stringify(result.diagnostics),
  );
  assert.equal(
    result.metadata.input.inputRevision,
    prepared.input.inputRevision,
  );
  const { simulator } = validatePinnedEnvironment(
    result.metadata.environment,
    "operator-host",
  );
  const op = result.data.analyses
    .find((a) => a.analysis === "op")
    .probes.find((p) => p.name === `v(${outputNode})`);
  const ac = result.data.analyses.find((a) => a.analysis === "ac");
  const output = ac.probes.find((p) => p.name === `v(${outputNode})`);
  assert(Math.abs(op.value - 0.1 * gain) < 1e-8);
  assert.equal(ac.frequencyHz[0], 1000);
  // H(j*2*pi*fp) = gain/(1+j), hence Re=+gain/2, Im=-gain/2.
  assert(Math.abs(output.real[0] - gain / 2) < 1e-6);
  assert(Math.abs(output.imag[0] + gain / 2) < 1e-6);
  receipts.push({
    gain,
    dcOutputV: op.value,
    poleFrequencyHz: ac.frequencyHz[0],
    acReal: output.real[0],
    acImag: output.imag[0],
    sourceRevision: project.modelSources[0].revision,
    inputRevision: prepared.input.inputRevision,
    digest: prepared.digest,
    simulatorVersion: simulator.version,
    environmentFingerprint: result.metadata.environment.fingerprint,
  });
}
assert.notEqual(receipts[0].inputRevision, receipts[1].inputRevision);
console.log(
  JSON.stringify({ language, profile: profile.id, receipts }, null, 2),
);
