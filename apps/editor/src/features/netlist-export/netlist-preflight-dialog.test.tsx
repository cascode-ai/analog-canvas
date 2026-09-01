import type { Diagnostic } from "@icm/derived";
import { createEmptyProject } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NetlistPreflightDialog } from "./netlist-preflight-dialog";

describe("NetlistPreflightDialog", () => {
  it("shows current electrical readiness separately from structural analysis", () => {
    const project = createEmptyProject("project", "Project", "main");
    project.documents[0]!.netlist = undefined;
    const electrical: Diagnostic = {
      id: "erc:unconnected:main:M1:D",
      domain: "erc",
      code: "ERC_UNCONNECTED_PIN",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: "Pin M1.D is the only endpoint on its Net",
      primary: {
        documentId: "main",
        hierarchyPath: [],
        kind: "terminal",
        objectId: "M1:D",
      },
      related: [],
      parameters: { instanceId: "M1", pinName: "D" },
    };

    const markup = renderToStaticMarkup(
      <NetlistPreflightDialog
        open
        project={project}
        electricalDiagnostics={[electrical]}
        onClose={() => undefined}
        onNavigate={() => undefined}
        onNavigateElectrical={() => undefined}
        onExport={() => undefined}
      />,
    );

    expect(markup).toContain("Electrical readiness (1)");
    expect(markup).toContain("ERC_UNCONNECTED_PIN");
    expect(markup).toContain("same current-revision connectivity assessment");
    expect(markup).toContain('aria-label="Readiness"');
    expect(markup).toContain('aria-label="Netlist diagnostics"');
    expect(markup).toContain('data-has-preview="false"');
    expect(markup).toContain('data-has-diagnostics="true"');
  });

  it("offers an explicit non-persisted Cadence bang export profile", () => {
    const project = createEmptyProject("project", "Project", "main");
    const markup = renderToStaticMarkup(
      <NetlistPreflightDialog
        open
        project={project}
        electricalDiagnostics={[]}
        onClose={() => undefined}
        onNavigate={() => undefined}
        onNavigateElectrical={() => undefined}
        onExport={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Netlist naming profile"');
    expect(markup).toContain('value="cadence-bang"');
    expect(markup).toContain("Cadence `!` globals");
  });
});
