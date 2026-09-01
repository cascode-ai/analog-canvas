import { executeTransaction } from "@icm/edit-engine";
import { createEmptyProject, createRoutePath } from "@icm/model";
import { analyzeDesignNetlist, printSpiceNetlist } from "@icm/netlist";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("imported global cut", () => {
  it("exports the detached component as a distinct node", () => {
    const project = createEmptyProject("imported-global-cut", "Imported Cut");
    const document = project.documents[0]!;
    document.netlist!.name = "imported_cut";
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: null,
        reference: "R1",
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: null,
        reference: "R2",
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "2k" },
        },
      },
    );
    document.nets.push({
      id: "net-vdd",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.noConnects.push(
      {
        id: "nc-r1-2",
        endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
      },
      {
        id: "nc-r2-2",
        endpoint: { kind: "terminal", instanceId: "R2", pinName: "2" },
      },
    );
    document.connectivityEvidence.push(
      {
        id: "global-vdd",
        kind: "name-claim",
        netId: "net-vdd",
        name: "VDD",
        scope: "global",
        owner: {
          kind: "global-declaration",
          sourceNetId: "source-vdd",
        },
      },
      {
        id: "source-vdd",
        kind: "spice-source",
        netId: "net-vdd",
        sourceNetId: "source-vdd",
      },
      {
        id: "source-vdd-name",
        kind: "net-name-hint",
        netId: "net-vdd",
        sourceName: "VDD",
        origin: "spice-import",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "route-vdd",
        netId: "net-vdd",
        start: { kind: "terminal", instanceId: "R1", pinName: "1" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const cut = executeTransaction(
      document,
      {
        transactionId: "cut-imported-global",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [{ kind: "cut_connection", routeId: "route-vdd" }],
      },
      { symbolResolver: resolver },
    );
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    project.documents[0] = cut.document;

    const analysis = analyzeDesignNetlist(project);
    expect(analysis.ir).not.toBeNull();
    const cell = analysis.ir!.cells[0]!;
    expect(cell.nets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "VDD", scope: "global" }),
        expect.objectContaining({ name: "VDD__2", scope: "local" }),
      ]),
    );
    const spice = printSpiceNetlist(analysis.ir!);
    expect(spice).toContain(".global VDD");
    expect(spice).toContain("R1 VDD NC0001 1k");
    expect(spice).toContain("R2 VDD__2 NC0002 2k");
  });
});
