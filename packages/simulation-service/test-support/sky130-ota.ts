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
export function nativeSky130OtaFixture(fullAnalysis = false) {
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
    .replace(
      "analysis op op",
      fullAnalysis
        ? [
            "options reltol=1e-8 abstol=1e-15 vntol=1e-10",
            "analysis bias op",
            "// Native waveform sources need explicit DC mode for a dc parameter sweep.",
            'alter instance("VINP") type="dc"',
            'sweep input instance="VINP" parameter="dc" from=0.88 to=0.92 step=0.005',
            "analysis transfer op",
            'alter instance("VINP") dc=0.9',
            'analysis response ac from=1 to=1e9 mode="dec" points=10',
            'analysis spectrum noise out="vout" in="VINP" from=1 to=1e9 mode="dec" points=20',
            'alter instance("VINP") type="pulse"',
            "// A 1 pA current floor avoids roundoff-driven NR rejection at the 1 ns edge.",
            "// Keep the strict relative/voltage tolerances; this is authored fixture policy.",
            "options abstol=1e-12",
            "analysis pulse tran stop=4u step=20n maxstep=20n",
          ].join("\n")
        : 'analysis bias op\nanalysis response ac from=1 to=1e6 mode="dec" points=10',
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
    // The candidate's wrapper interface is plain micrometres. Declare this in
    // its loading policy; do not patch the experiment or Canvas dimensions.
    modelLibrary: { dependencyId: library.dependencyId, defaultScale: 1e-6 },
  };
  return { project, folder, profile, library, voltage, m1, acquisitions };
}
