import {
  createEmptyDocument,
  createEmptyProject,
  freezeSnapshot,
  hierarchicalSymbolId,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { importSpiceSources } from "@icm/spice";
import { describe, expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";
import { createDraftNetlistPreview } from "./draft-preview.js";
import {
  designNetlistCellPorts,
  designNetlistNetName,
} from "./net-export-name.js";

/** R1–R2 and R3–R4 are drawn apart but both named OUT; R1–R3 is unnamed. */
function namedApart() {
  const project = createEmptyProject("project", "Project");
  const document = project.documents[0]!;
  document.instances = ["R1", "R2", "R3", "R4"].map((id, index) => ({
    id,
    reference: id,
    symbolId: "resistor",
    placement: {
      position: { x: 100 + index * 100, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters: { value: "1k" },
    },
  }));
  const terminals = (...pins: string[]) =>
    pins.map((pin) => {
      const [instanceId, pinName] = pin.split(".");
      return { instanceId: instanceId!, pinName: pinName! };
    });
  document.nets = [
    { id: "net-a", terminals: terminals("R1.1", "R2.1") },
    { id: "net-b", terminals: terminals("R3.1", "R4.1") },
    { id: "net-c", terminals: terminals("R1.2", "R3.2") },
    { id: "net-d", terminals: terminals("R2.2", "R4.2") },
  ];
  document.connectivityEvidence.push(
    ...["net-a", "net-b"].map((netId, index) => ({
      id: `claim-${netId}`,
      kind: "name-claim" as const,
      netId,
      name: "OUT",
      owner: { kind: "net-label" as const, annotationId: `label-${index}` },
      scope: "local" as const,
    })),
  );
  return { project, documentId: document.id };
}

describe("the name a netlist writes a Net under (2026-10-14)", () => {
  it("is the name on that Net's cards, generated or drawn", () => {
    const { project, documentId } = namedApart();
    const result = createDesignNetlistExport(project);
    if (result.status !== "ready") throw new Error("export blocked");
    const name = (netId: string) =>
      designNetlistNetName(project, documentId, netId);
    expect(name("net-a")).toBe("OUT");
    expect(name("net-b")).toBe("OUT");
    const unnamed = name("net-c");
    expect(unnamed).toMatch(/^net\d+$/u);
    expect(result.file.text).toMatch(
      new RegExp(`^R1 OUT ${unnamed} 1k$`, "mu"),
    );
    expect(name("missing")).toBeNull();
  });
});

describe("designNetlistCellPorts", () => {
  it("reads distinct formal row IDs when cached analysis returns a defensive copy", () => {
    const project = freezeSnapshot(stageWithCallers(true));
    const ports = designNetlistCellPorts(project, "stage");
    expect(ports?.map(({ portId }) => portId)).toEqual([
      "port-IN",
      "port-SENSE",
      "port-OUT",
    ]);
    expect(designNetlistCellPorts(project, "stage")).toEqual(ports);
  });

  it("lists a Cell's Pins as the netlist writes them, ground's added pin included (#2177)", async () => {
    const deck =
      ".subckt amp IN OUT\nR1 IN OUT 1k\nC1 OUT 0 1p\n.ends amp\nX1 a b amp\n.end\n";
    const imported = await importSpiceSources(
      [{ path: "amp.spi", bytes: new TextEncoder().encode(deck) }],
      "amp.spi",
    );
    const project = imported.project!;
    const cell = project.documents.find((item) => item.name === "amp")!;
    const ports = designNetlistCellPorts(project, cell.id)!;
    expect(ports.map((port) => port.name)).toEqual(["VSS", "IN", "OUT"]);
    expect(ports.map((port) => port.supply)).toEqual([true, false, false]);
    // The Cell's own Pins answer by their Net; ground's pin is the export's.
    expect(ports.slice(1).map((port) => port.id)).toEqual(
      cell.netlist!.terminals.map((terminal) => terminal.netId),
    );
    const text = createDesignNetlistExport(project);
    expect(text.status === "ready" && text.file.text).toContain(
      ".subckt amp VSS IN OUT\n",
    );
    expect(designNetlistCellPorts(project, "missing")).toBeNull();
  });

  it("lists the Pins of a Cell read from a file in the file's order, supplies among them", async () => {
    // A Cell keeps the order the file declares its ports in, VSS last here
    // and vdd before vss after the signals, so it writes again as it was
    // read and every positional call with it (#2177 lists what it writes).
    const deck =
      ".subckt rc_stage IN OUT VSS\nR1 IN OUT 1k\nC1 OUT VSS 1n\n.ends rc_stage\n" +
      ".subckt core vp vn vdd vss\nR1 vp vdd 1k\nR2 vn vss 1k\n.ends core\n" +
      "X1 a b 0 rc_stage\nX2 a b c d core\n.end\n";
    const imported = await importSpiceSources(
      [{ path: "rc.spi", bytes: new TextEncoder().encode(deck) }],
      "rc.spi",
    );
    const project = imported.project!;
    const cell = project.documents.find((item) => item.name === "rc_stage")!;
    expect(cell.netlist!.terminals.map((terminal) => terminal.name)).toEqual([
      "IN",
      "OUT",
      "VSS",
    ]);
    const ports = designNetlistCellPorts(project, cell.id)!;
    expect(
      ports.map((port) => `${port.name}${port.supply ? " (supply)" : ""}`),
    ).toEqual(["IN", "OUT", "VSS"]);
    const core = project.documents.find((item) => item.name === "core")!;
    expect(
      designNetlistCellPorts(project, core.id)!.map((port) => port.name),
    ).toEqual(["vp", "vn", "vdd", "vss"]);
    // The netlist writes that same order, definition and call alike.
    const text = createDesignNetlistExport(project);
    const written = text.status === "ready" ? text.file.text : "";
    expect(written).toContain(".subckt rc_stage IN OUT VSS\n");
    expect(written).toMatch(/^X1 a b VSS rc_stage$/mu);
    expect(written).toContain(".subckt core vp vn vdd vss\n");
    expect(written).toMatch(/^X2 a b c d core$/mu);
  });
});

function stageWithCallers(tied: boolean) {
  const project = createEmptyProject("project", "Project");
  const parent = project.documents[0]!;
  const child = createEmptyDocument("stage", "stage");
  project.documents.push(child);
  for (const [document, names] of [
    [child, ["IN", "SENSE", "OUT"]],
    [parent, ["A_IN", "A_SENSE", "A_OUT", "B_IN", "B_SENSE", "B_OUT"]],
  ] as const) {
    for (const name of names) {
      const pinId = `pin-${name}`;
      const netId =
        tied && document === child && name === "SENSE"
          ? "net-IN"
          : `net-${name}`;
      document.instances.push({ id: pinId, symbolId: "port", placement: null });
      const endpoint = { instanceId: pinId, pinName: "P" };
      const net = document.nets.find(({ id }) => id === netId);
      if (net) net.terminals.push(endpoint);
      else document.nets.push({ id: netId, terminals: [endpoint] });
      document.netlist!.terminals.push({
        id: `port-${name}`,
        name,
        netId,
        direction: "passive",
        interfaceInstanceIds: [pinId],
      });
    }
  }
  for (const [index, prefix] of ["A", "B"].entries()) {
    const id = `X${index + 1}`;
    parent.instances.push({
      id,
      reference: id,
      symbolId: hierarchicalSymbolId(child.name),
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    });
    for (const pinName of ["IN", "SENSE", "OUT"])
      parent.nets
        .find((net) => net.id === `net-${prefix}_${pinName}`)!
        .terminals.push({ instanceId: id, pinName });
  }
  return project;
}

it.each(["spice", "spectre"] as const)(
  "keeps both callers in declaration order even when a %s draft ties distinct ports",
  (format) => {
    const tied = stageWithCallers(true);
    const separate = stageWithCallers(false);
    const declaration =
      format === "spice"
        ? ".subckt stage IN SENSE OUT"
        : "subckt stage (IN SENSE OUT)";
    const call = (reference: string, prefix: string) => {
      const nodes = `${prefix}_IN ${prefix}_SENSE ${prefix}_OUT`;
      return format === "spice"
        ? `${reference} ${nodes} stage`
        : `${reference} (${nodes}) stage`;
    };
    for (const groundPin of ["global", "pin", "as-read"] as const) {
      const preview = createDraftNetlistPreview(tied, { format, groundPin });
      expect(preview?.text.split("\n")).toEqual(
        expect.arrayContaining([declaration, call("X1", "A"), call("X2", "B")]),
      );
      const strict = createDesignNetlistExport(tied, { format, groundPin });
      expect(strict.status).toBe("blocked");
      expect(strict.diagnostics.map(({ code }) => code)).toContain(
        "MULTIPLE_PORTS_SHARE_NET",
      );
      const ready = createDesignNetlistExport(separate, { format, groundPin });
      expect(ready.status === "ready" && ready.file.text.split("\n")).toEqual(
        expect.arrayContaining([declaration, call("X1", "A"), call("X2", "B")]),
      );
    }
  },
);

it.each(["spice", "spectre"] as const)(
  "keeps %s scalar and bus positions distinct when their owners use the same member ID",
  (format) => {
    const project = stageWithCallers(false);
    const [parent, child] = project.documents;
    const [control, bus, out] = child!.netlist!.terminals;
    const expression = "DATA<1:0>";
    const members = [
      { id: control!.id, name: "DATA<1>", netId: bus!.netId },
      { id: "data-low", name: "DATA<0>", netId: out!.netId },
    ];
    child!.netlist!.terminals = [
      control!,
      { ...bus!, name: expression, signal: { expression, members } },
    ];
    child!.instances = child!.instances.filter(({ id }) => id !== "pin-OUT");
    for (const member of members) {
      child!.nets.find(({ id }) => id === member.netId)!.terminals = [
        { instanceId: "pin-SENSE", pinName: "P", memberId: member.id },
      ];
    }
    for (const net of parent!.nets) {
      for (const endpoint of net.terminals) {
        const member =
          endpoint.pinName === "SENSE"
            ? members[0]
            : endpoint.pinName === "OUT"
              ? members[1]
              : undefined;
        if (member) {
          endpoint.pinName = expression;
          endpoint.memberId = member.id;
        }
      }
    }
    const restored = parseProject(serializeProject(project));
    const result = createDesignNetlistExport(restored, { format });
    if (result.status !== "ready")
      throw new Error(JSON.stringify(result.diagnostics));
    const nodes = "A_IN A_SENSE A_OUT";
    const declaration =
      format === "spice"
        ? ".subckt stage IN DATA_1_ DATA_0_"
        : "subckt stage (IN DATA\\<1\\> DATA\\<0\\>)";
    expect(result.file.text.split("\n")).toEqual(
      expect.arrayContaining([
        declaration,
        format === "spice" ? `X1 ${nodes} stage` : `X1 (${nodes}) stage`,
      ]),
    );
  },
);
