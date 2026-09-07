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
        onSaveSetup={() => ({ status: "applied" })}
        onDeleteSetup={() => true}
      />,
    );

    expect(markup).toContain('class="simulation-taskbar"');
    expect(markup).not.toContain('data-testid="simulation-cell-flow"');
    expect(markup).toContain("No DUT instance in this Cell");
    expect(markup).toContain("Edit → New Testbench Cell");
    expect(markup).toContain('class="simulation-setup-menu"');
    expect(markup).toContain('aria-label="Simulation setup"');
    expect(markup).toContain("New setup");
    expect(markup).not.toContain("<label>Testbench Cell");
    expect(markup).toContain('aria-pressed="true">Settings');
    expect(markup).toContain('aria-pressed="false">Results');
    expect(markup.indexOf('aria-label="Minimize simulation"')).toBeLessThan(
      markup.indexOf('aria-label="Maximize simulation"'),
    );
    expect(markup.indexOf('aria-label="Maximize simulation"')).toBeLessThan(
      markup.indexOf('aria-label="Exit simulation"'),
    );
    expect(markup).toContain('class="simulation-minimize-glyph"');
    expect(markup).toContain('aria-label="Setup settings" open=""');
    expect(markup).not.toContain('aria-label="Environment settings"');
    expect(markup).toContain('aria-label="Analyses settings"');
    expect(markup).toContain('aria-label="Output probes settings"');
    expect(markup).toContain('aria-label="Output signals settings"');
    expect(markup).toContain('aria-label="Measurements settings"');
    expect(markup).not.toContain('aria-label="Analyses settings" open=""');
    expect(markup).not.toContain('aria-label="Output probes settings" open=""');
    expect(markup).not.toContain(
      'aria-label="Output signals settings" open=""',
    );
    expect(markup).toContain('class="simulation-environment-grid"');
    expect(markup).toContain('value="27"');
    expect(markup).toContain('<input type="hidden" name="profileId"');
    expect(markup).not.toContain("<datalist");
    expect(markup).toContain("sky130-core-continuous-ngspice46-v1");
    expect(markup).toContain("SKY130 1.8 V · ngspice 46");
    expect(markup).toContain("Process corner");
    for (const corner of ["TT", "FF", "SS", "FS", "SF"])
      expect(markup).toContain(`>${corner}</option>`);
    expect(markup).toContain('class="simulation-probe-control"');
    expect(markup).not.toContain('type="search"');
    expect(markup).not.toContain("Filter by Cell, instance, pin, or Net");
    expect(markup).toContain("Choose a Net");
    expect(markup).toContain("Pick on canvas");
    expect(markup).toContain("Pick current");
    expect(markup).toContain("Add current output");
    expect(markup).toContain('class="simulation-analysis-row"');
    expect(markup).toContain('class="simulation-analysis-options"');
    expect(markup).toContain("TRAN");
    expect(markup).toContain("DC");
    expect(markup).not.toContain("Voltage Outputs target Nets");
    expect(markup).not.toContain("Current Outputs target a measurable");
    expect(markup).not.toContain("<span>Preview</span>");
    expect(markup).not.toContain('class="simulation-results-dock"');
    expect(markup).not.toContain('aria-label="File preview"');
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
        onSaveSetup={() => ({ status: "applied" })}
        onDeleteSetup={() => true}
      />,
    );
    expect(markup).toContain("DC sweep source");
    expect(markup).toContain('aria-label="Simulation setup"');
    expect(markup).toContain("DC Sweep");
    expect(markup).toContain("AC Response");
    expect(markup.match(/aria-label="Delete /g)).toHaveLength(2);
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
        onSaveSetup={() => ({ status: "applied" })}
        onDeleteSetup={() => true}
      />,
    );

    expect(markup).toContain("Raw setup");
    expect(markup).toContain('class="spice-simulation-surface maximized"');
    expect(markup).toContain('aria-label="Restore simulation panel"');
    expect(markup).toContain("tb.cir");
    expect(markup).toContain("Switch to structured setup");
    expect(markup.match(/aria-label="Delete /g)).toHaveLength(1);
    expect(markup).not.toContain("Add voltage probe");
    expect(markup).not.toContain("authored file(s)");
    expect(markup).not.toContain("Profile: raw-profile");
  });

  it("edits a saved Noise analysis with stable density measurement targets", () => {
    const project = createEmptyProject("noise-simulation", "Noise");
    const root = project.documents[0]!;
    root.instances.push(
      {
        id: "source-v1",
        symbolId: "voltage-source",
        reference: "V1",
        placement: null,
        netlist: {
          binding: { kind: "primitive", deviceClass: "voltage-source" },
          parameters: { dc: "0", acMagnitude: "1" },
        },
      },
      {
        id: "resistor-r1",
        symbolId: "resistor",
        reference: "R1",
        placement: null,
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { resistance: "1k" },
        },
      },
    );
    root.nets.push({
      id: "net-out",
      terminals: [
        { instanceId: "source-v1", pinName: "P" },
        { instanceId: "resistor-r1", pinName: "1" },
      ],
    });
    project.simulationSetups.push({
      id: "setup-noise",
      name: "Noise",
      version: 2,
      input: {
        kind: "structured",
        rootDocumentId: root.id,
        analyses: [
          {
            kind: "noise",
            output: {
              positive: {
                documentId: root.id,
                occurrence: [],
                anchor: {
                  kind: "terminal",
                  instanceId: "source-v1",
                  pinName: "P",
                },
              },
            },
            inputSourceInstanceId: "source-v1",
            sweep: "dec",
            points: 20,
            startHz: 10,
            stopHz: 1e6,
          },
        ],
        outputs: [],
        measurements: [
          {
            id: "noise-at-1k",
            label: "Noise at 1 kHz",
            analysis: "noise",
            outputId: "noise-output-density",
            method: { kind: "sample-at", coordinate: 1e3 },
          },
        ],
        environment: { profileId: "sky130-core-continuous-ngspice46-v1" },
      },
    });

    const markup = renderToStaticMarkup(
      <SpiceSimulationSurface
        open
        maximized={false}
        project={project}
        activeDocumentId={root.id}
        selectedSetupId="setup-noise"
        onSelectSetupId={() => undefined}
        session={{} as BrowserSimulationSession}
        onToggleMaximized={() => undefined}
        onMinimize={() => undefined}
        onExit={() => undefined}
        onSaveSetup={() => ({ status: "applied" })}
        onDeleteSetup={() => true}
      />,
    );

    expect(markup).toContain('type="checkbox" name="noise" checked=""');
    expect(markup).toContain('aria-label="Noise output positive"');
    expect(markup).toContain('name="noiseInputSourceInstanceId"');
    expect(markup).toContain('name="noiseStartHz"');
    expect(markup).toContain('value="10"');
    expect(markup).toContain("Output noise density");
    expect(markup).toContain("Input-referred noise density");
    expect(markup).toContain("Noise at 1 kHz");
  });
});
