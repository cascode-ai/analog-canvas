import { createEmptyProject, createSourceSimulationSetup } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserSimulationSession } from "./browser-simulation-session";
import { SpiceSimulationSurface } from "./spice-simulation-surface";

function render(saved: boolean, broken = false) {
  const project = createEmptyProject("code", "Code");
  if (saved) {
    const setup = createSourceSimulationSetup({
      id: "s",
      name: "RC",
      profileId: "local",
      documentId: project.topDocumentId,
    });
    if (broken)
      setup.input.files.find((f) => f.path === setup.input.configPath)!.text =
        "{";
    project.simulationSetups = [setup];
  }
  return renderToStaticMarkup(
    <SpiceSimulationSurface
      open
      maximized={false}
      project={project}
      activeDocumentId={project.topDocumentId}
      selectedSetupId={saved ? "s" : null}
      onSelectSetupId={() => {}}
      session={
        new BrowserSimulationSession({
          getProject: () => project,
          getProjectSessionId: () => "session",
        })
      }
      onToggleMaximized={() => {}}
      onMinimize={() => {}}
      onExit={() => {}}
      onSaveSetup={() => ({ status: "applied" })}
      onDeleteSetup={() => true}
      onHistoryBoundary={() => {}}
    />,
  );
}
describe("source workspace default cutover", () => {
  it("offers creation without restoring the retired Settings form", () => {
    const markup = render(false);
    expect(markup).toContain("Create experiment");
    expect(markup).not.toContain('aria-label="Analyses settings"');
    expect(markup).not.toContain('aria-label="Setup settings"');
  });
  it("places Console and Results under Code with generated and authored tabs only", () => {
    const markup = render(true);
    expect(markup).toContain('aria-label="Simulation Code workspace"');
    expect(markup).toContain('aria-label="Open simulation files"');
    expect(markup).toContain("circuit.spice");
    expect(markup).toContain("run.cir");
    expect(markup).not.toContain("experiment.json");
    expect(markup).not.toContain('aria-label="Simulation files"');
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
