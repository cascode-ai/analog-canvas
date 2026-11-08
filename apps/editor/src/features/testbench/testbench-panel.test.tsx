import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createEmptyProject,
  createSimulationFolder,
  type CircuitProject,
  type ProjectSimulationFolder,
} from "@icm/model";
import { TestbenchPanel, testbenchFiles } from "./testbench-panel";

function project(folders: ProjectSimulationFolder[] = []): CircuitProject {
  const base = createEmptyProject("project", "Project");
  return { ...base, simulationFolders: folders };
}

function render(target: CircuitProject) {
  return renderToStaticMarkup(
    <TestbenchPanel
      project={target}
      onRootChange={vi.fn()}
      onCommit={vi.fn(() => true)}
    />,
  );
}

describe("Testbench view", () => {
  it("offers to write or import a Testbench when the Cell has none", () => {
    const markup = render(project());
    expect(markup).toContain("No Testbench for");
    expect(markup).toContain(">New Testbench</button>");
    expect(markup).toContain(">Import files…</button>");
    expect(markup).toContain(">Import folder…</button>");
    // One Cell: no Cell select to choose from.
    expect(markup).not.toContain('aria-label="Testbench Cell"');
  });

  it("outlines the Specs the source declares and flags an invalid one", () => {
    const target = project();
    const cell = target.topDocumentId!;
    const folder = createSimulationFolder({
      id: "tb",
      name: "Gain",
      template: "testbench",
      documentId: cell,
      dut: { name: "ota", ports: ["in", "out"] },
    });
    folder.input.files[0]!.text =
      "* @spec gain >= 60 unit=dB\n* @spec pm > 1M\nXDUT in out ota\n";
    const markup = render({ ...target, simulationFolders: [folder] });
    expect(markup).toContain('aria-label="Specs"');
    expect(markup).toMatch(/gain<\/span>[^<]*<span[^>]*>&gt;= 60 dB/u);
    expect(markup).toMatch(/data-invalid="true"[\s\S]*pm/u);
    expect(markup).toContain("Line 2:");
    // A single file needs no file tabs.
    expect(markup).not.toContain('role="tablist"');
  });

  it("shows file tabs only for several authored files and hides valid metadata", () => {
    const target = project();
    const folder = createSimulationFolder({
      id: "run",
      name: "Run",
      profileId: "sky130",
      engine: "ngspice",
      documentId: target.topDocumentId!,
      dut: { name: "ota", ports: ["in", "out"] },
    });
    folder.input.files.push({ path: "report.py", text: "print(1)\n" });
    expect(testbenchFiles(folder)).toEqual([
      "run.cir",
      "report.py",
      "testbench.spice",
    ]);
    const markup = render({ ...target, simulationFolders: [folder] });
    expect(markup).toContain('role="tablist"');
    expect(markup).not.toContain(">experiment.json</button>");
  });
});
