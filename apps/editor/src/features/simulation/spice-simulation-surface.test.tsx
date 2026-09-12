import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserSimulationSession } from "./browser-simulation-session";
import { SpiceSimulationSurface } from "./spice-simulation-surface";

function render(saved: boolean, broken = false) {
  const project = createEmptyProject("code", "Code");
  if (saved) {
    const folder = createSimulationFolder({
      id: "s",
      name: "RC",
      profileId: "local",
      documentId: project.topDocumentId,
    });
    if (broken)
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
        "{";
    project.simulationFolders = [folder];
  }
  return renderToStaticMarkup(
    <SpiceSimulationSurface
      open
      maximized={false}
      project={project}
      activeDocumentId={project.topDocumentId}
      selectedFolderId={saved ? "s" : null}
      onSelectFolderId={() => {}}
      session={
        new BrowserSimulationSession({
          getProject: () => project,
          getProjectSessionId: () => "session",
        })
      }
      onToggleMaximized={() => {}}
      onMinimize={() => {}}
      onExit={() => {}}
      onSaveFolder={() => ({ status: "applied" })}
      onDeleteFolder={() => true}
      onHistoryBoundary={() => {}}
    />,
  );
}
describe("source workspace default cutover", () => {
  it("describes source application without claiming a cloud save", () => {
    const markup = render(true);
    expect(markup).toContain('aria-label="Save source"');
    expect(markup).toContain(
      'aria-description="Source applied to current project; not a cloud save"',
    );
    expect(markup).toContain('data-save-state="saved"');
    expect(markup).not.toContain('aria-label="Save project"');
  });
  it("offers creation without restoring the retired Settings form", () => {
    const markup = render(false);
    expect(markup).toContain("Set up");
    expect(markup).not.toContain("Create experiment");
    expect(markup).not.toContain('aria-label="Analyses settings"');
    expect(markup).not.toContain('aria-label="Setup settings"');
  });
  it("places Console and Results under Code with generated and authored tabs only", () => {
    const markup = render(true);
    expect(markup).toContain('aria-label="Simulation Code workspace"');
    expect(markup).toContain('aria-label="Open simulation files"');
    expect(markup).toContain("circuit.spice");
    expect(markup).toContain("run.cir");
    expect(markup).toContain("experiment.json");
    expect(markup).toContain('aria-label="Simulation folders"');
    expect(markup).not.toContain('aria-label="Simulation setup"');
    expect(markup).not.toContain("Prepare deck");
    expect(markup.indexOf('aria-label="Code output"')).toBeGreaterThan(
      markup.indexOf('aria-label="Open simulation files"'),
    );
    expect(markup).toContain("Maximize results");
  });
  it("retains the editor for invalid authored configuration rather than crashing or restoring a second form", () => {
    const markup = render(true, true);
    expect(markup).toContain('aria-label="Simulation Code workspace"');
    expect(markup).toContain("run.cir");
    expect(markup).not.toContain('aria-label="Measurements settings"');
  });
});
