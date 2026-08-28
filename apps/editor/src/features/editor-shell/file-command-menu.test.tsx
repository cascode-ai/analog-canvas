import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FileCommandMenu } from "./file-command-menu";

describe("FileCommandMenu", () => {
  it("presents one Cloud Save protocol and explicit local interchange", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu
        cloudProjects={[
          {
            id: "cloud-1",
            name: "Saved Circuit",
            updatedAt: "2026-08-28T10:00:00.000Z",
            revision: 3,
            schemaVersion: 28,
          },
        ]}
        activeCloudProjectId={null}
        canRevert
        hasRecoverySessions
        projectInputRef={createRef<HTMLInputElement>()}
        onNewProject={vi.fn()}
        onSave={vi.fn()}
        onSaveAsCopy={vi.fn()}
        onRefreshCloudProjects={vi.fn()}
        onOpenCloudProject={vi.fn()}
        onDeleteCloudProject={vi.fn()}
        onRefresh={vi.fn()}
        onImportProject={vi.fn()}
        onImportSpice={vi.fn()}
        onExportProject={vi.fn()}
        onExportSvg={vi.fn()}
        onExportRaster={vi.fn()}
        onExportNetlist={vi.fn()}
        onRevert={vi.fn()}
        onOpenRecovery={vi.fn()}
      />,
    );

    expect(markup).toContain("Save as Cloud Copy…");
    expect(markup).toContain(
      'disabled="" title="Save this Project to Cloud before creating a copy"',
    );
    expect(markup).toContain("Cloud Projects (1/3)");
    expect(markup).toContain("Saved Circuit");
    expect(markup).toContain("cloud-project-cloud-1");
    expect(markup).toContain("Import Project File…");
    expect(markup).toContain("Export Project File…");
    expect(markup).not.toContain("Download Backup");
    expect(markup).not.toContain("Previous Project");
    expect(markup).not.toContain("cloud snapshot");
  });
});
