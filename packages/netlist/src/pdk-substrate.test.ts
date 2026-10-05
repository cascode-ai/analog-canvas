import { describe, expect, it } from "vitest";
import { createEmptyProject, deriveStableId } from "@icm/model";

import { analyzeDesignNetlist } from "./extract.js";

const PNP = "sky130_fd_pr__pnp_05v5_W0p68L0p68";

/**
 * SKY130 vertical PNPs wired by `pins` ({reference: [C, B, E] Net names}).
 * A Net named 0 is the ground marker's; the rest are labelled.
 */
function pnpProject(pins: Record<string, readonly [string, string, string]>) {
  const project = createEmptyProject("pnp", "PNP", "main");
  const document = project.documents[0]!;
  project.externalSubcircuitDefinitions.push({
    id: "sky-pnp",
    name: PNP,
    terminals: ["C", "B", "E"].map((name, index) => ({
      id: `sky-pnp-terminal-${index}`,
      name,
      direction: "passive" as const,
    })),
    formalParameters: [],
    interfaceStatus: "declared",
  });
  const nets = new Map<string, { instanceId: string; pinName: string }[]>();
  for (const [reference, names] of Object.entries(pins)) {
    document.instances.push({
      id: reference,
      symbolId: "pnp",
      placement: null,
      reference,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "sky-pnp" },
        parameters: {},
      },
    });
    names.forEach((name, index) =>
      nets.set(name, [
        ...(nets.get(name) ?? []),
        { instanceId: reference, pinName: ["C", "B", "E"][index]! },
      ]),
    );
  }
  for (const [name, terminals] of nets) {
    const netId = `net-${name}`;
    if (name === "0") {
      document.instances.push({
        id: "GND",
        symbolId: "ground",
        placement: null,
      });
      terminals.push({ instanceId: "GND", pinName: "0" });
    } else {
      const labelId = deriveStableId("label", netId);
      document.annotations.push({
        id: labelId,
        kind: "net-label",
        binding: { kind: "net-name", netId },
        netId,
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      document.connectivityEvidence.push({
        id: deriveStableId("claim", netId),
        kind: "name-claim",
        netId,
        name,
        owner: { kind: "net-label", annotationId: labelId },
        scope: "local",
      });
    }
    document.nets.push({ id: netId, terminals });
  }
  return project;
}

const substrateFindings = (project: ReturnType<typeof pnpProject>) =>
  analyzeDesignNetlist(project, { format: "spice" })
    .diagnostics.filter((item) => item.code === "PDK_SUBSTRATE_TERMINAL")
    .map((item) => `${item.severity} ${item.message}`);

describe("a terminal tied to the p-substrate (#1314)", () => {
  it("warns for a SKY130 PNP mirror whose collectors are off ground", () => {
    // The textbook load of an NPN pair: Q3 diode-connected, Q4 mirroring
    // it, emitters at VDD. The PNP's collector is the substrate, so the
    // mirror cannot work, and a run showed vout at 0.93 V at balance.
    expect(
      substrateFindings(
        pnpProject({ Q3: ["mir", "mir", "vdd"], Q4: ["vout", "mir", "vdd"] }),
      ),
    ).toEqual([
      `warning Q3's collector is the p-substrate of ${PNP} and belongs on ground or the lowest supply; it is on mir. Use it as a diode, or with its collector grounded`,
      `warning Q4's collector is the p-substrate of ${PNP} and belongs on ground or the lowest supply; it is on vout. Use it as a diode, or with its collector grounded`,
    ]);
  });

  it("says nothing of a bandgap's grounded PNPs, or of collectors on VSS", () => {
    expect(
      substrateFindings(
        pnpProject({ Q1: ["0", "0", "e1"], Q2: ["0", "0", "e2"] }),
      ),
    ).toEqual([]);
    expect(substrateFindings(pnpProject({ Q1: ["VSS", "VSS", "e1"] }))).toEqual(
      [],
    );
  });
});
