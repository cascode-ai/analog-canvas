import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import { NetlistCodePanel, netlistIssueTarget } from "./netlist-code-panel";

describe("live netlist controls", () => {
  it("offers independent format, process and compact device mapping controls", () => {
    const markup = renderToStaticMarkup(
      <NetlistCodePanel
        project={createEmptyProject("project", "Project")}
        format="spectre"
        namingProfile="native"
        profiles={createDefaultNetlistExportPreferences().profiles}
        selectedProcess="abstract"
        onProcessChange={vi.fn()}
        onDeviceTargetChange={vi.fn()}
        onFormatChange={vi.fn()}
        onApply={vi.fn()}
        onFocusInstance={vi.fn()}
        onReset={vi.fn()}
        configurationError={null}
      />,
    );

    expect(markup).toContain('aria-label="Netlist format"');
    expect(markup).toContain('aria-label="Netlist process"');
    expect(markup).toContain('value="spectre" selected=""');
    expect(markup).not.toContain('data-testid="copy-netlist-panel"');
    expect(markup).not.toContain('aria-label="Port names:');
    expect(markup).not.toContain(">ABC</code>");
    expect(markup).not.toContain('aria-label="Copy netlist"');
    expect(markup).toContain("<svg");
    expect(markup).not.toContain(">Copy</button>");
    expect(markup).toContain('aria-label="NMOS netlist target"');
    expect(markup).toContain('aria-label="L netlist target"');
    expect(markup.match(/<select/g)).toHaveLength(7);
    expect(markup).not.toContain("<input");
    expect(markup).toContain(">Default</button>");
    expect(markup).toMatch(
      /aria-label="Netlist output options"[\s\S]*>Default<\/button><\/div>/u,
    );
    expect(markup).toContain('class="netlist-code-viewport"');
    expect(markup).not.toContain("<h2>Netlist</h2>");
  });

  it("lists every blocking finding, each with the part it names", () => {
    const project = createEmptyProject("project", "Project");
    for (const [index, [id, symbolId]] of (
      [
        ["D1", "delay-cell"],
        ["S1", "ideal-switch"],
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
        onFormatChange={vi.fn()}
        onApply={vi.fn()}
        onFocusInstance={vi.fn()}
        onNavigateDiagnostic={vi.fn()}
        onReset={vi.fn()}
        configurationError={null}
      />,
    );
    expect(markup).toContain('data-testid="netlist-issues"');
    expect(markup).toContain("2 issues");
    expect(markup.match(/data-testid="netlist-issue"/gu)).toHaveLength(2);
    expect(markup).toContain(
      "Symbol delay-cell has no reviewed netlist definition",
    );
    expect(markup).toContain(
      "Symbol ideal-switch is drawing-only and has no netlist form",
    );
    expect(markup).toContain('<span class="netlist-issue-target">D1</span>');
    expect(markup).toContain('<span class="netlist-issue-target">S1</span>');
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
