// Replay the actual Project exported by user-components.spec.ts against a qualified executor.
// Build workspace packages first, then pass an HTTPS origin and the exported Project file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { createSimulationFolder } from "../packages/model/dist/index.js";
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
const project = parseProject(readFileSync(process.argv[3], "utf8"));
assert.equal(project.modelSources.length, 1);
const owner = project.modelSources[0];
assert.equal(owner.revision, 1);
assert.equal(owner.draft, undefined);
const document = project.documents.find(
  (item) => item.id === project.topDocumentId,
);
for (const [reference, gain] of [
  ["X1", "20"],
  ["X2", "30"],
]) {
  const instance = document.instances.find(
    (item) => item.reference === reference,
  );
  assert.equal(instance.netlist.parameters.gain, gain);
  const definition = project.externalSubcircuitDefinitions.find(
    (item) => item.id === instance.netlist.binding.definitionId,
  );
  assert.equal(definition.implementation.sourceId, owner.id);
  assert.equal(definition.implementation.entry, "finite_gain");
}
const exported = createDesignNetlistExport(project, { format: "spice" });
assert.equal(exported.status, "ready", JSON.stringify(exported.diagnostics));
for (const name of ["finite_gain", "owned_helper"])
  assert.equal(
    exported.file.text.match(new RegExp(`\\.subckt ${name}\\b`, "gu")).length,
    1,
  );
const analysis = analyzeDesignNetlist(project, {
  format: "spice",
  rootAsTopLevel: true,
});
assert(analysis.ir, JSON.stringify(analysis.diagnostics));
const outputNode = analysis.ir.cells
  .find((item) => item.id === document.id)
  .instances.find((item) => item.id === "X2")
  .nodes.find((node) => node.pinName === "OUT").netName;
const folder = createSimulationFolder({
  id: "user-components-smoke",
  name: "User Component OP AC",
  engine: "ngspice",
  profileId: profile.id,
  documentId: document.id,
});
folder.input.files.find((file) => file.path === folder.input.entry).text = [
  "User Component OP AC",
  '.include "circuit.spice"',
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
const capabilityResponse = await fetch(new URL("/api/simulate", origin), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    operation: "capabilities",
    environment: { profileId: profile.id },
    executorTarget: "operator-host",
  }),
  signal: AbortSignal.timeout(10000),
});
assert(capabilityResponse.ok, `Capabilities HTTP ${capabilityResponse.status}`);
const capabilities = CapabilitiesSchema.parse(await capabilityResponse.json());
assert.equal(capabilities.configured, true);
const prepared = await prepareNgspiceExecutionInput(
  project,
  folder,
  capabilities,
);
assert.equal(prepared.ok, true, JSON.stringify(prepared));
const circuit = prepared.input.files.find(
  (file) => file.path === "circuit.spice",
);
assert(circuit.text.includes(owner.files[0].text));
assert(
  prepared.sourceMaps.some((map) =>
    map.segments.some(
      (segment) =>
        segment.origin.kind === "model-source" &&
        segment.origin.sourceId === owner.id &&
        segment.origin.revision === owner.revision,
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
assert.equal(
  result.outcome.status,
  "completed",
  JSON.stringify(result.diagnostics),
);
assert.equal(result.execution.target, "operator-host");
assert.equal(result.metadata.input.inputRevision, prepared.input.inputRevision);
const { simulator } = validatePinnedEnvironment(
  result.metadata.environment,
  "operator-host",
);
const op = result.data.analyses
  .find((item) => item.analysis === "op")
  .probes.find(
    (probe) => probe.name.toLowerCase() === `v(${outputNode.toLowerCase()})`,
  );
const ac = result.data.analyses.find((item) => item.analysis === "ac");
const output = ac.probes.find(
  (probe) => probe.name.toLowerCase() === `v(${outputNode.toLowerCase()})`,
);
// Two cascaded stages: H(j*2*pi*fp) = 20*30/(1+j)^2 = -j*300.
assert(op && output, JSON.stringify(result.data));
assert(Math.abs(op.value - 60) < 1e-7);
assert.equal(ac.frequencyHz[0], 1000);
assert(Math.abs(output.real[0]) < 1e-6);
assert(Math.abs(output.imag[0] + 300) < 1e-6);
console.log(
  JSON.stringify(
    {
      sourceRevision: owner.revision,
      inputRevision: prepared.input.inputRevision,
      digest: prepared.digest,
      dcOutputV: op.value,
      poleFrequencyHz: ac.frequencyHz[0],
      acReal: output.real[0],
      acImag: output.imag[0],
      simulatorVersion: simulator.version,
      environmentFingerprint: result.metadata.environment.fingerprint,
    },
    null,
    2,
  ),
);
