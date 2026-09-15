import { readFileSync } from "node:fs";
import { CircuitProjectSchema, createSimulationFolder } from "@icm/model";
import {
  nativeAcquisitionEdit,
  nativeDeviceOpAcquisitions,
  nativeSimulationDevices,
  nativeVoltageAcquisition,
  type NativeModelLibrarySymbols,
} from "@icm/netlist";
import { currentFiveTransistorOtaCircuitSource } from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";

/** The original shipped hierarchical circuit, unchanged. Source authoring uses
 * public helpers; the captured library identity is converter-checked, not a
 * claim that this Profile is electrically or operationally qualified. */
export function nativeSky130OtaFixture() {
  const project = CircuitProjectSchema.parse(
    currentFiveTransistorOtaCircuitSource(),
  );
  const { library }: { library: NativeModelLibrarySymbols } = JSON.parse(
    readFileSync(
      new URL(
        "../../../netlists/vacask-sky130/model-symbols-tt.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const folder = createSimulationFolder({
    id: "folder-1",
    name: "OTA",
    profileId: "test",
    documentId: project.topDocumentId,
  });
  const entry = folder.input.files.find((f) => f.path === folder.input.entry)!;
  entry.text = entry.text
    .replace(
      'include "circuit.spice"',
      'include "models/library.inc"\ninclude "circuit.spice"',
    )
    // Reviewed SKY130 wrapper parameters are plain micrometres. The native
    // candidate uses the same explicit scale as its numerical reference decks;
    // this is authored environment setup, not a mutation of Canvas dimensions.
    .replace("options rawfile=", "options scale=1e-6 rawfile=")
    .replace(
      "analysis op op",
      'analysis bias op\nanalysis response ac from=1 to=1e6 mode="dec" points=10',
    );
  folder.input.dependencies = [
    {
      id: library.dependencyId,
      sha256: library.sha256,
      mountPath: "models/library.inc",
    },
  ];
  project.simulationFolders = [folder];
  const voltage = nativeVoltageAcquisition(project, folder.input, {
    kind: "voltage",
    documentId: project.topDocumentId,
    circuit: { bindingId: folder.input.circuitBindings[0]!.id, callPath: [] },
    anchor: { kind: "terminal", instanceId: "XDUT", pinName: "vout" },
    occurrence: [],
  });
  if (!voltage.ok) throw Error(voltage.message);
  const m1 = nativeSimulationDevices(project, folder.input, [library]).find(
    (d) =>
      d.documentId === "document-ota-5t" &&
      d.instanceId === "M1" &&
      JSON.stringify(d.occurrence) === JSON.stringify(["XDUT"]),
  );
  if (!m1) throw Error("The shipped OTA lost its M1 occurrence");
  const acquisitions = nativeDeviceOpAcquisitions(m1);
  const edit = nativeAcquisitionEdit(
    entry.text,
    entry.text.indexOf("analysis bias"),
    [voltage.save, ...acquisitions.map((a) => a.save)],
    true,
  );
  if (!edit.ok) throw Error(edit.error.message);
  entry.text = edit.text;
  const profile = {
    id: "test",
    corners: [],
    dependencies: [{ id: library.dependencyId, sha256: library.sha256 }],
    modelSymbols: [library],
  };
  return { project, folder, profile, library, voltage, m1, acquisitions };
}
