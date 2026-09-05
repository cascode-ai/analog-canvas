import { createEmptyProject } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { BrowserSimulationSession } from "./browser-simulation-session";
import { SpiceSimulationSurface } from "./spice-simulation-surface";

describe("SpiceSimulationSurface workspace", () => {
  it("opens as a docked setup workspace without blocking a plain Cell", () => {
    const project = createEmptyProject("simulation-workspace", "Amplifier");
    const markup = renderToStaticMarkup(
      <SpiceSimulationSurface
        open
        project={project}
        activeDocumentId={project.topDocumentId}
        session={{} as BrowserSimulationSession}
        onMinimize={() => undefined}
        onExit={() => undefined}
        onSaveSetup={() => true}
        onOpenCell={() => undefined}
      />,
    );

    expect(markup).toContain('class="simulation-taskbar"');
    expect(markup).toContain('data-testid="simulation-cell-flow"');
    expect(markup).toContain("This Cell has no DUT instance");
    expect(markup).toContain("Edit → New Testbench Cell");
    expect(markup).toContain('aria-label="Simulation setup"');
    expect(markup).toContain('aria-pressed="true">Setup');
    expect(markup).toContain('aria-pressed="false">Results');
    expect(markup).not.toContain('class="simulation-results-dock"');
  });
});
