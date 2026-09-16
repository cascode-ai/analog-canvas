import assert from "node:assert/strict";

// Testbench composition for the cross-Project acceptance command. Cell copying
// remains the existing project_cells/Edit Engine operation, not another importer.
export function nativeImportedTestbench(
  reference,
  importedRootDocumentId,
  testbenchId,
  folderId,
) {
  const testbench = structuredClone(
    reference.documents.find((d) => d.id === "document-ota-5t-testbench"),
  );
  const folder = structuredClone(
    reference.simulationFolders.find(
      (f) => f.id === "simulation-setup-ota-op-ac",
    ),
  );
  assert(testbench && folder, "Native OTA acceptance reference is incomplete");
  testbench.id = testbenchId;
  testbench.name = "Cross-Project OTA Testbench";
  testbench.netlist.name = "cross_project_ota_tb";
  const instance = testbench.instances.find((i) => i.id === "XDUT");
  assert.equal(instance?.netlist?.binding?.kind, "subcircuit");
  instance.netlist.binding.childDocumentId = importedRootDocumentId;
  folder.id = folderId;
  folder.name = "Cross-Project OTA OP";
  const binding = folder.input.circuitBindings.find(
    (b) => b.emission === "top-level",
  );
  assert(binding, "Acceptance requires a Canvas Testbench binding");
  binding.documentId = testbenchId;
  const entry = folder.input.files.find((f) => f.path === folder.input.entry);
  assert(entry, "Acceptance has no native entry");
  entry.text = [
    "Cross-Project OTA OP",
    "ground 0",
    'include "models/library.inc" section=tt',
    `include "${binding.path}"`,
    "control",
    "abort always",
    'options rawfile="ascii" strictsave=2 temp=27',
    "save v(vout)",
    "analysis bias op",
    "endc",
    "",
  ].join("\n");
  // Keep the existing native config/Profile/dependency; no structured outputs,
  // frontend formulas, legacy control program or simulator fallback.
  return { testbench, folder };
}
