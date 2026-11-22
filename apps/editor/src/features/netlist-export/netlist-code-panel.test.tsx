import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import { NetlistCodePanel, netlistIssueTarget } from "./netlist-code-panel";

describe("live netlist controls", () => {
  it("offers the RNL modes beside SPICE and SCS, and shows one read-only", () => {
    const markup = renderToStaticMarkup(
      <NetlistCodePanel
        project={createEmptyProject("project", "Project")}
        format="spice"
        rnl
        namingProfile="native"
        profiles={createDefaultNetlistExportPreferences().profiles}
        selectedProcess="abstract"
        onProcessChange={vi.fn()}
        onDeviceTargetChange={vi.fn()}
        onModeChange={vi.fn()}
        onApply={vi.fn()}
        onFocusInstance={vi.fn()}
        onReset={vi.fn()}
        onCopy={vi.fn()}
        configurationError={null}
      />,
    );
    for (const label of ["SPICE", "SCS", "SPICE+RNL", "Spectre+RNL"])
      expect(markup).toContain(`>${label}</option>`);
    expect(markup).toContain('value="spice+rnl" selected=""');
    // The runtime writes after the first paint; the editable code is gone.
    expect(markup).toContain('aria-label="RNL netlist"');
    expect(markup).toContain("Writing RNL…");
    expect(markup).not.toContain('aria-label="Netlist code"');
  });

  it("lists every blocking finding, each with the part it names", () => {
    const project = createEmptyProject("project", "Project");
    for (const [index, [id, symbolId]] of (
      [
        ["D1", "unit-delay"],
        ["I1", "integrator"],
      ] as const
    ).entries())
      project.documents[0]!.instances.push({
        id,
        reference: id,
        symbolId,
        placement: {
          position: { x: 100 + index * 200, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      });
    const markup = renderToStaticMarkup(
      <NetlistCodePanel
        project={project}
        format="spice"
        namingProfile="native"
        profiles={createDefaultNetlistExportPreferences().profiles}
        selectedProcess="abstract"
        onProcessChange={vi.fn()}
        onDeviceTargetChange={vi.fn()}
        onModeChange={vi.fn()}
        onApply={vi.fn()}
        onFocusInstance={vi.fn()}
        onNavigateDiagnostic={vi.fn()}
        onReset={vi.fn()}
        onCopy={vi.fn()}
        configurationError={null}
      />,
    );
    expect(markup).toContain('data-testid="netlist-issues"');
    expect(markup).toContain("2 issues");
    expect(markup.match(/data-testid="netlist-issue"/gu)).toHaveLength(2);
    expect(markup).toContain(
      "Symbol unit-delay has no reviewed netlist definition",
    );
    expect(markup).toContain(
      "Symbol integrator has no reviewed netlist definition",
    );
    expect(markup).toContain('<span class="netlist-issue-target">D1</span>');
    expect(markup).toContain('<span class="netlist-issue-target">I1</span>');
  });

  it("names a finding's part, pin and Cell", () => {
    const project = createEmptyProject("project", "Project");
    const child = createEmptyDocument("child", "Bias");
    child.instances.push({
      id: "M1",
      reference: "M7",
      symbolId: "nmos",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    project.documents.push(child);
    const locator = {
      documentId: "child",
      hierarchyPath: [],
      kind: "terminal" as const,
      objectId: "M1",
      endpoint: { kind: "terminal" as const, instanceId: "M1", pinName: "G" },
    };
    expect(netlistIssueTarget(project, locator, project.topDocumentId)).toBe(
      "M7.G in Bias",
    );
    expect(
      netlistIssueTarget(
        project,
        {
          documentId: "child",
          hierarchyPath: [],
          kind: "instance",
          objectId: "M1",
        },
        "child",
      ),
    ).toBe("M7");
    expect(
      netlistIssueTarget(
        project,
        { documentId: "child", hierarchyPath: [], kind: "net", objectId: "n" },
        "child",
      ),
    ).toBeNull();
  });
});
