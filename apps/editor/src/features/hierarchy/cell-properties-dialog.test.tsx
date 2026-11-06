import { createEmptyProject, type CircuitProject } from "@icm/model";
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
    for (const moved of [
      "Set as Top",
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
  });

  it("surfaces a direction conflict once on the projected Port", () => {
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
    expect(markup).toContain("Direction conflict");
    expect(markup).toContain(
      '<option value="" disabled="" selected="">Mixed</option>',
    );
  });

  it("keeps imported parameters without defaults and offers adding one", () => {
    const project = createEmptyProject("project", "Project");
    const cell = project.documents[0]!;
    cell.netlist!.formalParameters = [{ name: "Imported" }];
    const markup = render(project, cell.id);
    expect(markup).toContain('aria-label="Parameter Imported name"');
    expect(markup).toContain('placeholder="No default"');
    expect(markup).toContain('title="0 internal uses; 0 instance overrides"');
    expect(markup).toContain('aria-label="Add parameter"');
  });
});
