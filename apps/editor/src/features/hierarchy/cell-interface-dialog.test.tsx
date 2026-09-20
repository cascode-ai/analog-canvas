import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CellInterfaceEditor } from "./cell-interface-dialog";
import { CellParametersEditor } from "./cell-parameters-editor";

describe("CellInterfaceEditor", () => {
  it("hides an empty parameter table but retains imported declarations without defaults", () => {
    const project = createEmptyProject("project", "Project");
    const cell = project.documents[0]!;
    const render = () =>
      renderToStaticMarkup(
        <CellParametersEditor
          cell={cell}
          project={project}
          onEdit={() => ({ ok: true, message: "" })}
        />,
      );
    expect(render()).toBe("");
    cell.netlist!.formalParameters = [{ name: "Imported" }];
    const markup = render();
    expect(markup).toContain('aria-label="Parameter Imported name"');
    expect(markup).toContain('placeholder="No default"');
    expect(markup).toContain('title="0 internal uses; 0 instance overrides"');
    expect(markup).not.toContain('role="columnheader">Usage');
    expect(markup).not.toContain("Apply parameters");
  });
  it("lists the same projected Ports that the generated Symbol consumes", () => {
    const cell = createEmptyDocument("cell", "Cell");
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

    const markup = renderToStaticMarkup(
      <CellInterfaceEditor
        cell={cell}
        project={createEmptyProject("project", "Project")}
        callerCount={2}
        onFormatPortLabels={vi.fn()}
        onSetPortDirection={vi.fn()}
        onMovePort={vi.fn()}
        onEditParameter={vi.fn(() => ({ ok: true, message: "" }))}
      />,
    );

    expect(markup.match(/class="cell-interface-row"/gu)).toHaveLength(2);
    expect(markup).toContain("Vout");
    expect(markup).toContain("2 markers");
    expect(markup).toContain('aria-label="Formal port Vout direction"');
    expect(markup).toContain("Format all Port labels");
    expect(markup).not.toContain("Formal terminal");
  });

  it("surfaces a direction conflict once on the projected Port", () => {
    const cell = createEmptyDocument("cell", "Cell");
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

    const markup = renderToStaticMarkup(
      <CellInterfaceEditor
        cell={cell}
        project={createEmptyProject("project", "Project")}
        callerCount={0}
        onFormatPortLabels={vi.fn()}
        onSetPortDirection={vi.fn()}
        onMovePort={vi.fn()}
        onEditParameter={vi.fn(() => ({ ok: true, message: "" }))}
      />,
    );

    expect(markup.match(/class="cell-interface-row"/gu)).toHaveLength(1);
    expect(markup).toContain("Direction conflict");
    expect(markup).toContain(
      '<option value="" disabled="" selected="">Mixed</option>',
    );
  });
});
