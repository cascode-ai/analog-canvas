// A circuit with a testbench for the Gallery's simulation checks (#1545):
// the hosted check's tests and the local check's share it.

import {
  createEmptyProject,
  createSimulationFolder,
  deriveStableId,
  type SchematicDocument,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import ngspiceProfile from "../containers/ngspice/hosted-sky130-profile.json";

function claimNet(
  document: SchematicDocument,
  netId: string,
  name: string,
  powerDomain?: "ground",
): void {
  const labelId = deriveStableId("divider-label", document.id, netId);
  document.annotations.push({
    id: labelId,
    kind: powerDomain ? "power-label" : "net-label",
    binding: { kind: "net-name", netId },
    netId,
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.connectivityEvidence.push({
    id: deriveStableId("divider-name", document.id, netId),
    kind: "name-claim",
    netId,
    name,
    owner: { kind: "net-label", annotationId: labelId },
    scope: powerDomain ? "global" : "local",
    ...(powerDomain ? { powerDomain } : {}),
  });
}

/**
 * A drawn divider, V1 → R1 → MID → R2 → ground, with the testbench its Cell
 * runs as: a DC sweep, the midpoint measured, and `spec` as its Spec.
 */
export function dividerProjectText(name: string, spec: string): string {
  const project = createEmptyProject("divider", name, "tb");
  const tb = project.documents[0]!;
  const part = (
    id: string,
    reference: string,
    deviceClass: "resistor" | "voltage-source",
    parameters: Record<string, string>,
  ) => ({
    id,
    symbolId: deviceClass,
    placement: null,
    reference,
    netlist: {
      binding: { kind: "primitive" as const, deviceClass },
      parameters,
    },
  });
  tb.instances.push(
    part("inst-v1", "V1", "voltage-source", { dc: "1" }),
    part("inst-r1", "R1", "resistor", { value: "1k" }),
    part("inst-r2", "R2", "resistor", { value: "1k" }),
    { id: "inst-gnd", symbolId: "ground", placement: null },
  );
  tb.nets.push(
    {
      id: "net-in",
      terminals: [
        { instanceId: "inst-v1", pinName: "+" },
        { instanceId: "inst-r1", pinName: "1" },
      ],
    },
    {
      id: "net-mid",
      terminals: [
        { instanceId: "inst-r1", pinName: "2" },
        { instanceId: "inst-r2", pinName: "1" },
      ],
    },
    {
      id: "net-gnd",
      terminals: [
        { instanceId: "inst-v1", pinName: "-" },
        { instanceId: "inst-r2", pinName: "2" },
        { instanceId: "inst-gnd", pinName: "0" },
      ],
    },
  );
  claimNet(tb, "net-in", "IN");
  claimNet(tb, "net-mid", "MID");
  claimNet(tb, "net-gnd", "0", "ground");
  const folder = createSimulationFolder({
    id: "divider-dc",
    name: "Divider DC",
    profileId: ngspiceProfile.id,
    engine: "ngspice",
    documentId: "tb",
  });
  folder.input.files = folder.input.files.map((file) =>
    file.path === folder.input.entry
      ? {
          ...file,
          text: [
            "Divider DC",
            `* @spec ${spec}`,
            '.include "circuit.spice"',
            ".control",
            "dc V1 0 1 0.5",
            "meas dc vmid find v(mid) at=1",
            ".endc",
            ".end",
            "",
          ].join("\n"),
        }
      : file,
  );
  project.simulationFolders = [folder];
  return serializeProject(project);
}
