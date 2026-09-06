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
        maximized={false}
        project={project}
        activeDocumentId={project.topDocumentId}
        selectedSetupId={null}
        onSelectSetupId={() => undefined}
        session={{} as BrowserSimulationSession}
        onToggleMaximized={() => undefined}
        onMinimize={() => undefined}
        onExit={() => undefined}
        onSaveSetup={() => true}
        onDeleteSetup={() => true}
        onOpenCell={() => undefined}
      />,
    );

    expect(markup).toContain('class="simulation-taskbar"');
    expect(markup).not.toContain('data-testid="simulation-cell-flow"');
    expect(markup).toContain("No DUT instance in this Cell");
    expect(markup).toContain("Edit → New Testbench Cell");
    expect(markup).toContain('aria-label="Simulation setup"');
    expect(markup).toContain('aria-pressed="true">Settings');
    expect(markup).toContain('aria-pressed="false">Results');
    expect(markup).toContain('aria-label="Maximize simulation"');
    expect(markup).toContain('<select name="profileId"');
    expect(markup).not.toContain("<datalist");
    expect(markup).toContain("sky130-core-continuous-ngspice46-v1");
    expect(markup).toContain('class="simulation-probe-control"');
    expect(markup).not.toContain('type="search"');
    expect(markup).not.toContain("Filter by Cell, instance, pin, or Net");
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
    expect(markup).toContain("DC");
    expect(markup).not.toContain("Voltage Outputs target Nets");
    expect(markup).not.toContain("Current Outputs target a measurable");
    expect(markup).not.toContain("<span>Preview</span>");
    expect(markup).not.toContain('class="simulation-results-dock"');
  });

  it("edits a saved DC sweep with a root independent source", () => {
    const project = createEmptyProject("dc-simulation", "DC Sweep");
    const root = project.documents[0]!;
    root.instances.push({
      id: "source-v1",
      symbolId: "voltage-source",
      reference: "V1",
      placement: null,
      netlist: {
        binding: { kind: "primitive", deviceClass: "voltage-source" },
        parameters: { dc: "0" },
      },
    });
    project.simulationSetups.push({
      id: "setup-dc",
      name: "DC Sweep",
      version: 2,
      input: {
        kind: "structured",
        rootDocumentId: root.id,
        analyses: [
          {
            kind: "dc",
            sourceInstanceId: "source-v1",
            startValue: 0,
            stopValue: 1.8,
            stepValue: 0.1,
          },
        ],
        outputs: [],
        environment: { profileId: "sky130-core-continuous-ngspice46-v1" },
      },
    });
    project.simulationSetups.push({
      id: "setup-ac",
      name: "AC Response",
      version: 2,
      input: {
        kind: "structured",
        rootDocumentId: root.id,
        analyses: [
          {
            kind: "ac",
            sweep: "dec",
            points: 10,
            startHz: 1,
            stopHz: 1e6,
          },
        ],
        outputs: [],
        environment: { profileId: "sky130-core-continuous-ngspice46-v1" },
      },
    });
    const markup = renderToStaticMarkup(
      <SpiceSimulationSurface
        open
        maximized={false}
        project={project}
        activeDocumentId={root.id}
        selectedSetupId="setup-dc"
        onSelectSetupId={() => undefined}
        session={{} as BrowserSimulationSession}
        onToggleMaximized={() => undefined}
        onMinimize={() => undefined}
        onExit={() => undefined}
        onSaveSetup={() => true}
        onDeleteSetup={() => true}
        onOpenCell={() => undefined}
      />,
    );
    expect(markup).toContain("DC sweep source");
    expect(markup).toContain('aria-label="Simulation setup"');
    expect(markup).toContain("DC Sweep");
    expect(markup).toContain("AC Response");
    expect(markup.match(/Delete setup/g)).toHaveLength(1);
    expect(markup).toContain('name="setupName"');
    expect(markup).toContain("V1 · Voltage");
    expect(markup).toContain('name="dcStartValue"');
    expect(markup).toContain('name="dcStopValue"');
    expect(markup).toContain('name="dcStepValue"');
  });

  it("keeps a saved raw setup distinct from the structured editor", () => {
    const project = createEmptyProject("raw-simulation", "Raw");
    project.simulationSetups.push({
      id: "setup-raw",
      name: "Raw",
      version: 2,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: ".end\n" }],
        dependencies: [],
        environment: { profileId: "raw-profile" },
      },
    });
    const markup = renderToStaticMarkup(
      <SpiceSimulationSurface
        open
        maximized
        project={project}
        activeDocumentId={project.topDocumentId}
        selectedSetupId="setup-raw"
        onSelectSetupId={() => undefined}
        session={{} as BrowserSimulationSession}
        onToggleMaximized={() => undefined}
        onMinimize={() => undefined}
        onExit={() => undefined}
        onSaveSetup={() => true}
        onDeleteSetup={() => true}
        onOpenCell={() => undefined}
      />,
    );

    expect(markup).toContain("Raw setup");
    expect(markup).toContain('class="spice-simulation-surface maximized"');
    expect(markup).toContain('aria-label="Restore simulation panel"');
    expect(markup).toContain("tb.cir");
    expect(markup).toContain("Switch to structured setup");
    expect(markup.match(/Delete setup/g)).toHaveLength(1);
    expect(markup).not.toContain("Add voltage probe");
    expect(markup).not.toContain("authored file(s)");
    expect(markup).not.toContain("Profile: raw-profile");
  });
});
