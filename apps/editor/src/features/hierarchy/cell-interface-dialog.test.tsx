import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CellInterfaceEditor } from "./cell-interface-dialog";

describe("CellInterfaceEditor", () => {
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
        callerCount={2}
        onSetPortDirection={vi.fn()}
        onMovePort={vi.fn()}
        onSetFormalParameters={vi.fn()}
      />,
    );

    expect(markup.match(/class="cell-interface-row"/gu)).toHaveLength(2);
    expect(markup).toContain("Vout");
    expect(markup).toContain("2 markers");
    expect(markup).toContain('aria-label="Formal port Vout direction"');
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
        callerCount={0}
        onSetPortDirection={vi.fn()}
        onMovePort={vi.fn()}
        onSetFormalParameters={vi.fn()}
      />,
    );

    expect(markup.match(/class="cell-interface-row"/gu)).toHaveLength(1);
    expect(markup).toContain("Direction conflict");
    expect(markup).toContain(
      '<option value="" disabled="" selected="">Mixed</option>',
    );
  });
});
