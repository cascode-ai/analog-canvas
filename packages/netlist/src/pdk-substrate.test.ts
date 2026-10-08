import { describe, expect, it } from "vitest";
import { createEmptyProject, deriveStableId } from "@icm/model";

import { createDesignNetlistExport } from "./export.js";
import { analyzeDesignNetlist } from "./extract.js";

const PNP = "sky130_fd_pr__pnp_05v5_W0p68L0p68";
const NPN = "sky130_fd_pr__npn_05v5_W1p00L1p00";

/**
 * SKY130 BJTs wired by `pins` ({reference: Net names}): three names make a
 * vertical PNP ([C, B, E]), four an NPN ([C, B, E, S], S its hidden
 * substrate, as the PDK's own subcircuits take them). A Net named 0 is the
 * ground marker's; VCC, VEE and VNEG are drawn with supply markers, as a
 * positive and a negative rail are; the rest are labelled.
 */
function bjtProject(pins: Record<string, readonly string[]>) {
  const project = createEmptyProject("bjt", "BJT", "main");
  const document = project.documents[0]!;
  for (const [id, name, terminals] of [
    ["sky-pnp", PNP, ["C", "B", "E"]],
    ["sky-npn", NPN, ["C", "B", "E", "S"]],
  ] as const)
    project.externalSubcircuitDefinitions.push({
      id,
      name,
      terminals: terminals.map((terminal, index) => ({
        id: `${id}-terminal-${index}`,
        name: terminal,
        direction: "passive" as const,
      })),
      formalParameters: [],
      interfaceStatus: "declared",
    });
  const nets = new Map<string, { instanceId: string; pinName: string }[]>();
  for (const [reference, names] of Object.entries(pins)) {
    const npn = names.length === 4;
    document.instances.push({
      id: reference,
      symbolId: npn ? "npn" : "pnp",
      placement: null,
      reference,
      netlist: {
        binding: {
          kind: "external-subcircuit",
          definitionId: npn ? "sky-npn" : "sky-pnp",
        },
        parameters: {},
      },
    });
    names.forEach((name, index) =>
      nets.set(name, [
        ...(nets.get(name) ?? []),
        { instanceId: reference, pinName: ["C", "B", "E", "S"][index]! },
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
    } else if (name === "VCC" || name === "VEE" || name === "VNEG") {
      document.instances.push({
        id: name,
        symbolId: "vdd-port",
        placement: null,
      });
      terminals.push({ instanceId: name, pinName: "P" });
      document.connectivityEvidence.push({
        id: `${name}-claim`,
        kind: "name-claim",
        netId,
        name,
        scope: "global",
        powerDomain: "vdd",
        owner: { kind: "power-marker", objectId: name },
      });
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

const substrateFindings = (
  project: ReturnType<typeof bjtProject>,
  code = "PDK_SUBSTRATE_TERMINAL",
) =>
  analyzeDesignNetlist(project, { format: "spice" })
    .diagnostics.filter((item) => item.code === code)
    .map((item) => `${item.severity} ${item.message}`);

/** The exported X lines of the BJTs, in order. */
function bjtLines(project: ReturnType<typeof bjtProject>): string[] {
  const exported = createDesignNetlistExport(project, { format: "spice" });
  expect(exported.status, JSON.stringify(exported.diagnostics)).toBe("ready");
  return exported.status === "ready"
    ? exported.file.text.split("\n").filter((line) => /^XQ/u.test(line))
    : [];
}

describe("a terminal tied to the p-substrate (#1314)", () => {
  it("warns for a SKY130 PNP mirror whose collectors are off ground", () => {
    // The textbook load of an NPN pair: Q3 diode-connected, Q4 mirroring
    // it, emitters at VDD. The PNP's collector is the substrate, so the
    // mirror cannot work, and a run showed vout at 0.93 V at balance.
    expect(
      substrateFindings(
        bjtProject({ Q3: ["mir", "mir", "vdd"], Q4: ["vout", "mir", "vdd"] }),
      ),
    ).toEqual([
      `warning Q3's collector is the p-substrate of ${PNP} and belongs on ground or the lowest supply; it is on mir. Use it as a diode, or with its collector grounded`,
      `warning Q4's collector is the p-substrate of ${PNP} and belongs on ground or the lowest supply; it is on vout. Use it as a diode, or with its collector grounded`,
    ]);
  });

  it("says nothing of a bandgap's grounded PNPs, or of collectors on VSS", () => {
    expect(
      substrateFindings(
        bjtProject({ Q1: ["0", "0", "e1"], Q2: ["0", "0", "e2"] }),
      ),
    ).toEqual([]);
    expect(substrateFindings(bjtProject({ Q1: ["VSS", "VSS", "e1"] }))).toEqual(
      [],
    );
  });
});

describe("an NPN's hidden substrate beside a negative supply (#1530)", () => {
  const ABOVE = "PDK_SUBSTRATE_ABOVE_NEGATIVE_SUPPLY";

  it("names the substrates left on ground in a Cell that draws VEE", () => {
    // AnalogGenie 874: VCC and VEE rails; Q1's emitter on VEE, Q2 a
    // follower from VCC. Their substrates on ground forward-bias Q1's.
    const project = bjtProject({
      Q1: ["n1", "vi", "VEE", "0"],
      Q2: ["VCC", "n0", "vo", "0"],
      Q3: ["n0", "n2", "VCC"],
    });
    expect(substrateFindings(project, ABOVE)).toEqual([
      "warning Q1.S and Q2.S are p-substrate terminals on ground, while this Cell draws VEE, its negative supply. The substrate belongs on the lowest supply: an NPN collector below it forward-biases. Set their Substrate Net to VEE",
    ]);
    // The netlist stays as drawn; the PNP keeps the three nodes its PDK
    // subcircuit has, its substrate being its collector.
    expect(bjtLines(project)).toEqual([
      `XQ1 n1 vi VEE VSS ${NPN}`,
      `XQ2 VCC n0 vo VSS ${NPN}`,
      `XQ3 n0 n2 VCC ${PNP}`,
    ]);
  });

  it("says nothing of a substrate on VEE, or on ground with no negative supply", () => {
    const onVee = bjtProject({ Q1: ["n1", "vi", "VEE", "VEE"] });
    expect(substrateFindings(onVee, ABOVE)).toEqual([]);
    expect(bjtLines(onVee)).toEqual([`XQ1 n1 vi VEE VEE ${NPN}`]);
    const single = bjtProject({ Q1: ["VCC", "vi", "vo", "0"] });
    expect(substrateFindings(single, ABOVE)).toEqual([]);
    expect(bjtLines(single)).toEqual([`XQ1 VCC vi vo VSS ${NPN}`]);
  });

  it("takes a drawn VNEG as the lowest supply as well as the negative one", () => {
    // The Process binds a substrate placed after a VNEG rail to it; the
    // lowest-supply check reads the same name, so that binding is quiet.
    const onVneg = bjtProject({ Q1: ["n1", "vi", "VNEG", "VNEG"] });
    expect(substrateFindings(onVneg)).toEqual([]);
    expect(substrateFindings(onVneg, ABOVE)).toEqual([]);
    expect(bjtLines(onVneg)).toEqual([`XQ1 n1 vi VNEG VNEG ${NPN}`]);
    const onGround = bjtProject({
      Q1: ["n1", "vi", "VNEG", "VNEG"],
      Q2: ["n2", "vi", "VNEG", "0"],
    });
    expect(substrateFindings(onGround)).toEqual([]);
    expect(substrateFindings(onGround, ABOVE)).toEqual([
      "warning Q2.S is a p-substrate terminal on ground, while this Cell draws VNEG, its negative supply. The substrate belongs on the lowest supply: an NPN collector below it forward-biases. Set its Substrate Net to VNEG",
    ]);
  });
});
