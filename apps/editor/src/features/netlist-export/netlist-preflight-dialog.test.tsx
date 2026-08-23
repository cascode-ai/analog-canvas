import type { Diagnostic } from "@icm/derived";
import type { DesignNetlistAnalysisResult } from "@icm/netlist";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NetlistPreflightDialog } from "./netlist-preflight-dialog";

describe("NetlistPreflightDialog", () => {
  it("shows current electrical readiness separately from structural analysis", () => {
    const result: DesignNetlistAnalysisResult = {
      ir: null,
      diagnostics: [],
    };
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
        result={result}
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
  });
});
