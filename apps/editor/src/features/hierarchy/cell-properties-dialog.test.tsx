import { executeProjectTransaction, planSwapCellPorts } from "@icm/edit-engine";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { createDesignNetlistExport } from "@icm/netlist";
import { importSpiceSources } from "@icm/spice";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { hierarchyNavigationFixture } from "../../../../../netlists/hierarchy-navigation/fixture";
import { CellPropertiesDialog } from "./cell-properties-dialog";

const render = (project: CircuitProject, cellId: string) =>
  renderToStaticMarkup(
    <CellPropertiesDialog
      project={project}
      cellId={cellId}
      onClose={vi.fn()}
      onSetTop={vi.fn()}
      onRename={vi.fn()}
      onRenamePin={vi.fn()}
      onSetPinDirection={vi.fn()}
      onMovePin={vi.fn()}
      onEditParameter={vi.fn(() => ({ ok: true, message: "" }))}
      onSymbolSizeChange={vi.fn()}
      onPinSideChange={vi.fn()}
    />,
  );

describe("CellPropertiesDialog", () => {
  it("edits one shared definition on one sheet and leaves Cell actions to the tree", () => {
    const markup = render(hierarchyNavigationFixture(), "channel");
    expect(markup).toContain('aria-label="Cell name"');
    expect(markup).toContain("Shared by 2 uses");
    expect(markup).toContain('aria-label="Cell symbol"');
    // Each Pin is one row: name, direction and symbol side together.
    expect(markup.match(/aria-label="Port IN name"/gu)).toHaveLength(1);
    expect(markup).toContain('aria-label="Formal port IN direction"');
    expect(markup).toContain('aria-label="Cell symbol IN pin side"');
    expect(markup).toContain('aria-label="Parameter gain default"');
    // Top is a state of the definition, so the sheet can switch it.
    expect(markup).toContain(">Set as Top</button>");
    for (const moved of [
      "Move earlier",
      "New definition",
      "Import Cell",
      "Jump to caller",
      ">Place<",
      ">Open<",
      ">Delete<",
    ])
      expect(markup).not.toContain(moved);
  });

  it("lists the projected Ports that the generated symbol consumes", () => {
    const project = createEmptyProject("project", "Project");
    const cell = project.documents[0]!;
    cell.netlist!.terminals.push(
      {
        id: "terminal-out-a",
        name: "Vout",
        netId: "net-out",
        direction: "output",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-out-b",
        name: "vOUT",
        netId: "net-out",
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
      {
        id: "terminal-in",
        name: "Vin",
        netId: "net-in",
        direction: "input",
        interfaceInstanceIds: ["P3"],
      },
    );
    const markup = render(project, cell.id);
    expect(
      markup.match(/aria-label="Formal port [^"]+ direction"/gu),
    ).toHaveLength(2);
    expect(markup).toContain('aria-label="Formal port Vout direction"');
    expect(markup).toContain("2 markers");
    expect(markup).toContain("Default entry");
    expect(markup).not.toContain("Set as Top");
  });

  it("shows one Port of mixed directions as Mixed, with no conflict", () => {
    const project = createEmptyProject("project", "Project");
    const cell = project.documents[0]!;
    cell.netlist!.terminals.push(
      {
        id: "terminal-a",
        name: "IO",
        netId: "net-io",
        direction: "input",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "terminal-b",
        name: "io",
        netId: "net-io",
        direction: "output",
        interfaceInstanceIds: ["P2"],
      },
    );
    const markup = render(project, cell.id);
    expect(
      markup.match(/aria-label="Formal port [^"]+ direction"/gu),
    ).toHaveLength(1);
    expect(markup).not.toContain("Direction conflict");
    expect(markup).toContain(
      '<option value="" disabled="" selected="">Mixed</option>',
    );
  });

  it("lists the Pins in netlist order, with the pins the netlist adds (#2177)", async () => {
    const imported = await importSpiceSources(
      [
        {
          path: "cells.spi",
          bytes: new TextEncoder().encode(
            [
              ".subckt rc_stage IN OUT VSS",
              "R1 IN OUT 1k",
              "C1 OUT VSS 1n",
              ".ends rc_stage",
              ".subckt amp IN OUT",
              "R1 IN OUT 1k",
              "C1 OUT 0 1p",
              ".ends amp",
              "X1 a b 0 rc_stage",
              "X2 b c amp",
              ".end",
            ].join("\n"),
          ),
        },
      ],
      "cells.spi",
    );
    let project = imported.project!;
    const cellId = (name: string) =>
      project.documents.find((item) => item.name === name)!.id;
    // Each row as "order name moves": u/d a live up/down button, x a
    // disabled one, - none.
    const rows = (name: string) =>
      render(project, cellId(name))
        .split(/<div class="cell-props-row cell-pin-row[^"]*" role="row">/u)
        .slice(2)
        .map((row) => {
          const order = /class="cell-pin-order">(\d+)</u.exec(row)?.[1];
          const added = /class="cell-pin-added-name">(\w+)</u.exec(row)?.[1];
          if (added) return `${order} ${added} added`;
          const pin = /aria-label="Port (\w+) name"/u.exec(row)?.[1];
          const move = (way: "up" | "down") => {
            const button = new RegExp(
              `<button[^>]*aria-label="Move ${pin} ${way}"[^>]*>`,
              "u",
            ).exec(row)?.[0];
            if (button === undefined) return "-";
            return button.includes("disabled") ? "x" : way[0];
          };
          return `${order} ${pin} ${move("up")}${move("down")}`;
        });
    const netlist = () => {
      const result = createDesignNetlistExport(project);
      return result.status === "ready" ? result.file.text : result.status;
    };
    // A Cell read from a file keeps the order the file declares its Pins
    // in, VSS among them: each moves, and the netlist writes it as it reads.
    expect(rows("rc_stage")).toEqual(["1 IN xd", "2 OUT ud", "3 VSS ux"]);
    expect(netlist()).toContain(".subckt rc_stage IN OUT VSS\n");
    expect(render(project, cellId("rc_stage"))).not.toContain("supplies lead");
    // Ground's pin, which the netlist adds, shows where it is written.
    expect(rows("amp")).toEqual(["1 VSS added", "2 IN xd", "3 OUT ux"]);

    // Moving OUT up swaps it with IN: the definition and its call change
    // alike, and the table still matches.
    const swap = (from: CircuitProject, id: string) =>
      executeProjectTransaction(from, {
        transactionId: id,
        projectId: from.id,
        expectedStructureRevision: from.structureRevision,
        actor: { kind: "human", id: "test" },
        edits: planSwapCellPorts(
          from,
          cellId("rc_stage"),
          from.documents
            .find((item) => item.name === "rc_stage")!
            .netlist!.terminals.find((terminal) => terminal.name === "OUT")!.id,
          from.documents
            .find((item) => item.name === "rc_stage")!
            .netlist!.terminals.find((terminal) => terminal.name === "IN")!.id,
        ),
      });
    const moved = swap(project, "move-out-up");
    expect(moved.ok).toBe(true);
    project = moved.project;
    expect(rows("rc_stage")).toEqual(["1 OUT xd", "2 IN ud", "3 VSS ux"]);
    expect(netlist()).toContain(".subckt rc_stage OUT IN VSS\n");
    expect(netlist()).toMatch(/^X1 b a VSS rc_stage$/mu);

    // A Cell the editor draws puts a Pin named VSS, a supply, first, as
    // the netlist writes it, its place fixed; the signals move among
    // themselves.
    delete project.documents.find((item) => item.name === "rc_stage")!
      .importReference;
    expect(rows("rc_stage")).toEqual(["1 VSS --", "2 OUT xd", "3 IN ux"]);
    expect(netlist()).toContain(".subckt rc_stage VSS OUT IN\n");
    expect(netlist()).toMatch(/^X1 VSS b a rc_stage$/mu);
    expect(render(project, cellId("rc_stage"))).toContain(
      "Top to bottom is the netlist order; supplies lead",
    );
  });

  it("keeps imported parameters without defaults and offers adding one", () => {
    const project = createEmptyProject("project", "Project");
    const cell = project.documents[0]!;
    cell.netlist!.formalParameters = [{ name: "Imported" }];
    const markup = render(project, cell.id);
    expect(markup).toContain('aria-label="Parameter Imported name"');
    expect(markup).toContain('placeholder="No default"');
    // Unused, it can be removed; only its × icon explains itself on hover.
    const remove =
      /<button[^>]*aria-label="Remove parameter Imported"[^>]*>/u.exec(
        markup,
      )?.[0];
    expect(remove).toContain('title="Remove this unused parameter"');
    expect(remove).not.toContain("disabled");
    expect(markup).not.toContain("internal uses");
    expect(markup).toContain('aria-label="Add parameter"');
  });
});
