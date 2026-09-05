import { createEmptyProject } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BrowserSimulationSession } from "./browser-simulation-session";
import { SpiceSimulationSurface } from "./spice-simulation-surface";

describe("SpiceSimulationSurface workspace", () => {
  it("opens as a task bar plus an on-demand setup surface over the canvas", () => {
    const project = createEmptyProject("simulation-workspace", "Amplifier");
    const markup = renderToStaticMarkup(
      <SpiceSimulationSurface
        open
        project={project}
        activeDocumentId={project.topDocumentId}
        session={{} as BrowserSimulationSession}
        onClose={() => undefined}
        onSaveSetup={() => true}
        onOpenCell={() => undefined}
        onNewTestbench={() => undefined}
      />,
    );

    expect(markup).toContain('class="simulation-taskbar"');
    expect(markup).toContain('data-testid="simulation-cell-flow"');
    expect(markup).toContain("Derived Symbol");
    expect(markup).toContain("Create Testbench");
    expect(markup).toContain('aria-label="Simulation setup"');
    expect(markup).toContain('aria-pressed="true">Setup');
    expect(markup).toContain('aria-pressed="false">Results');
    expect(markup).not.toContain('class="simulation-results-dock"');
  });
});
