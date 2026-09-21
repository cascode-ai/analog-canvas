import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FileCommandMenu } from "./file-command-menu";
import { CLOUD_PROJECT_LIMIT } from "./cloud-projects";

describe("FileCommandMenu", () => {
  it("presents one Cloud Save protocol and explicit local interchange", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu
        projectStoreLabel="Cloud Projects"
        projectStoreItemLabel="Cloud Project"
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
        checkAndSave={{ enabled: true, execute: vi.fn() }}
        projectInputRef={createRef<HTMLInputElement>()}
        onNewProject={vi.fn()}
        onSave={vi.fn()}
        onRefreshCloudProjects={vi.fn()}
        onOpenCloudProject={vi.fn()}
        onDeleteCloudProject={vi.fn()}
        onImportProject={vi.fn()}
        onImportSpice={vi.fn()}
        onExportProject={vi.fn()}
        onExportSvg={vi.fn()}
        onExportRaster={vi.fn()}
        onRevert={vi.fn()}
        onOpenRecovery={vi.fn()}
      />,
    );

    expect(markup).not.toContain("Save as Cloud Copy");
    expect(markup).toContain(`Cloud Projects (1/${CLOUD_PROJECT_LIMIT})`);
    expect(markup).toContain("Saved Circuit");
    expect(markup).toContain('class="cloud-project-time"');
    expect(markup).toContain("cloud-project-cloud-1");
    expect(markup).toContain(">Import<");
    expect(markup).toContain("Project File…");
    expect(markup).toContain("SPICE / SCS…");
    expect(markup).toContain("Cadence SPICE (`!` globals)…");
    expect(markup).toContain('data-testid="cadence-spice-files"');
    expect(markup).toContain(">Export<");
    expect(markup).toContain("Drawing as SVG");
    expect(markup).toContain("Recover Unsaved Work…");
    expect(markup).not.toContain("Refresh app");
    expect(markup).not.toContain("Copy SPICE netlist");
    expect(markup).not.toContain("Copy Spectre netlist");
    expect(markup).not.toContain("Download Backup");
    expect(markup).not.toContain("Previous Project");
    expect(markup).not.toContain("cloud snapshot");
  });

  it("identifies the isolated Preview Project store", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu
        projectStoreLabel="Preview Projects"
        projectStoreItemLabel="Preview Project"
        cloudProjects={[]}
        activeCloudProjectId={null}
        canRevert={false}
        hasRecoverySessions={false}
        checkAndSave={{ enabled: true, execute: vi.fn() }}
        projectInputRef={createRef<HTMLInputElement>()}
        onNewProject={vi.fn()}
        onSave={vi.fn()}
        onRefreshCloudProjects={vi.fn()}
        onOpenCloudProject={vi.fn()}
        onDeleteCloudProject={vi.fn()}
        onImportProject={vi.fn()}
        onImportSpice={vi.fn()}
        onExportProject={vi.fn()}
        onExportSvg={vi.fn()}
        onExportRaster={vi.fn()}
        onRevert={vi.fn()}
        onOpenRecovery={vi.fn()}
      />,
    );

    expect(markup).toContain(`Preview Projects (0/${CLOUD_PROJECT_LIMIT})`);
  });
});
