import { createEmptyProject } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import { describe, expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";
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

  it("lists a Pin named VSS where the export puts it, before the signals (#2177)", async () => {
    const deck =
      ".subckt rc_stage IN OUT VSS\nR1 IN OUT 1k\nC1 OUT VSS 1n\n.ends rc_stage\nX1 a b 0 rc_stage\n.end\n";
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
    ).toEqual(["VSS (supply)", "IN", "OUT"]);
    // The netlist writes that same order, definition and call alike.
    const text = createDesignNetlistExport(project);
    expect(text.status === "ready" && text.file.text).toContain(
      ".subckt rc_stage VSS IN OUT\n",
    );
    expect(text.status === "ready" && text.file.text).toMatch(
      /^X1 VSS a b rc_stage$/mu,
    );
  });
});
