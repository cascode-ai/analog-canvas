import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FileCommandMenu } from "./file-command-menu";

describe("FileCommandMenu", () => {
  it("projects file capabilities without owning Project state", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu
        workspaceSlots={[
          {
            id: "slot-1",
            name: "Saved Circuit",
            savedAt: "now",
            schemaVersion: 1,
          },
        ]}
        previousProjectName="Earlier"
        canRevert
        hasRecoverySessions
        projectInputRef={createRef<HTMLInputElement>()}
        onNewProject={vi.fn()}
        onSaveProject={vi.fn()}
        onCheckAndSave={vi.fn()}
        onOpenShelfSlot={vi.fn()}
        onRefresh={vi.fn()}
        onOpenProject={vi.fn()}
        onImportSpice={vi.fn()}
        onExportSvg={vi.fn()}
        onExportRaster={vi.fn()}
        onExportNetlist={vi.fn()}
        onRestorePrevious={vi.fn()}
        onRevert={vi.fn()}
        onOpenRecovery={vi.fn()}
      />,
    );

    expect(markup).toContain("Save Project As…");
    expect(markup).toContain("Check and Save");
    expect(markup).not.toContain("Your shelf");
    expect(markup).not.toContain("Saved Circuit");
    expect(markup).not.toContain("shelf-slot-slot-1");
    expect(markup).toContain("Import SPICE");
    expect(markup).toContain("Export Spectre netlist");
    expect(markup).toContain("Recover recent work…");
  });
});
