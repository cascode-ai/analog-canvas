import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserSimulationSession } from "./browser-simulation-session";
import type { Run } from "@icm/simulation-service/contract";
import {
  preferredResultTab,
  SpiceSimulationSurface,
} from "./spice-simulation-surface";
import type { SimulationAgentGuidanceProps } from "./simulation-agent-guidance";

function render(
  saved: boolean,
  broken = false,
  agentGuidance?: SimulationAgentGuidanceProps,
) {
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
      agentGuidance={agentGuidance}
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
  it.each([false, true])(
    "keeps Agent guidance with saved folder=%s without side effects",
    (saved) => {
      let opened = false;
      const markup = render(saved, false, {
        status: "connected",
        onOpen: () => {
          opened = true;
        },
      });
      expect(markup).toContain("Agent connected");
      expect(markup).toContain("Tell your Agent your simulation goal");
      expect(opened).toBe(false);
      expect(markup.includes('aria-label="Agent simulation guide"')).toBe(
        !saved,
      );
      expect(markup.includes('class="simulation-agent-guidance"')).toBe(saved);
      expect(render(saved)).not.toContain("simulation-agent-guidance");
    },
  );
  it("retains the editor for invalid authored configuration rather than crashing or restoring a second form", () => {
    const markup = render(true, true);
    expect(markup).toContain("experiment.json");
    expect(markup).toContain('aria-label="Simulation Code workspace"');
    expect(markup).toContain("run.cir");
    expect(markup).not.toContain('aria-label="Measurements settings"');
  });
});

describe("the tab a run lands on", () => {
  it("shows a refused run's problem in Console, where its Sign in button is", () => {
    const run = (state: Run["state"], error?: Run["error"]) =>
      ({ id: "run", state, ...(error ? { error } : {}) }) as Run;
    expect(preferredResultTab(run("finished"))).toBe("specs");
    expect(
      preferredResultTab(
        run("finished", {
          code: "simulation-authentication-required",
          message: "Sign in to run simulations.",
          stage: "read",
          recovery: "reauthorize",
        }),
      ),
    ).toBe("console");
    expect(preferredResultTab(run("lost"))).toBe("console");
  });
});
