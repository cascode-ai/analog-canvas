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
    expect(markup).not.toContain('data-testid="simulation-cell-flow"');
    expect(markup).toContain("This Cell has no DUT instance");
    expect(markup).toContain("Edit → New Testbench Cell");
    expect(markup).toContain('aria-label="Simulation setup"');
    expect(markup).toContain('aria-pressed="true">Settings');
    expect(markup).toContain('aria-pressed="false">Results');
    expect(markup).toContain('<select name="profileId"');
    expect(markup).not.toContain("<datalist");
    expect(markup).toContain("sky130-core-continuous-ngspice46-v1");
    expect(markup).toContain('class="simulation-probe-control"');
    expect(markup).toContain("Choose a Net");
    expect(markup).toContain("Pick on canvas");
    expect(markup).not.toContain("Pick voltage on canvas");
    expect(markup).toContain("Add current output");
    expect(markup).toContain(
      'class="simulation-setup-group simulation-analysis-row"',
    );
    expect(markup).toContain(
      'class="simulation-setup-group simulation-inline-fields columns-2"',
    );
    expect(markup).toContain("TRAN");
    expect(markup).not.toContain("Voltage Outputs target Nets");
    expect(markup).not.toContain("Current Outputs target a measurable");
    expect(markup).not.toContain("<span>Preview</span>");
    expect(markup).not.toContain('class="simulation-results-dock"');
  });

  it("keeps a saved raw setup distinct from the structured editor", () => {
    const project = createEmptyProject("raw-simulation", "Raw");
    project.simulation = {
      version: 1,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: ".end\n" }],
        dependencies: [],
        environment: { profileId: "raw-profile" },
      },
    };
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

    expect(markup).toContain("Raw setup");
    expect(markup).toContain("tb.cir");
    expect(markup).toContain("Switch to structured setup");
    expect(markup).not.toContain("Add voltage probe");
  });
});
