import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  NewTestbenchDialog,
  nextTestbenchCellName,
} from "./new-testbench-dialog";

describe("NewTestbenchDialog", () => {
  const dut = createEmptyDocument("document-main", "Main");
  const existing = createEmptyDocument("document-main-tb", "Main_tb");

  it("allocates a readable unused name for the selected DUT", () => {
    expect(nextTestbenchCellName([dut], dut.id)).toBe("Main_tb");
    expect(nextTestbenchCellName([dut, existing], dut.id)).toBe("Main_tb_2");
  });

  it("makes the Symbol View and hierarchy reference explicit", () => {
    const onCreate = vi.fn();
    const markup = renderToStaticMarkup(
      <NewTestbenchDialog
        documents={[dut]}
        initialDutDocumentId={dut.id}
        onCancel={() => undefined}
        onCreate={onCreate}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("New Testbench Cell");
    expect(markup).toContain("Auto-derived");
    expect(markup).toContain("not a copied symbol");
    expect(markup).toContain('value="Main_tb"');
    expect(markup).toContain("Place the DUT Symbol View");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows a reviewed Symbol View without changing Cell ownership", () => {
    const reviewed = structuredClone(dut);
    reviewed.presentation.cellSymbol = {
      minimumBodySize: { width: 100, height: 80 },
    };
    const markup = renderToStaticMarkup(
      <NewTestbenchDialog
        documents={[reviewed]}
        initialDutDocumentId={reviewed.id}
        onCancel={() => undefined}
        onCreate={() => undefined}
      />,
    );

    expect(markup).toContain("Reviewed");
    expect(markup).toContain("reference to this Cell");
  });
});
