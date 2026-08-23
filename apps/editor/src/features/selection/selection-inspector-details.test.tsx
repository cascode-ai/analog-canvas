import type {
  Diagnostic,
  ErcDiagnostic,
  HierarchyNetTrace,
  VisualDiagnostic,
} from "@icm/derived";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  NetTraceSection,
  ProjectDiagnosticsSection,
  SelectionInspectorDetails,
  summarizeVisualDiagnostics,
} from "./selection-inspector-details";

const structural: VisualDiagnostic = {
  code: "BROKEN_ROUTE",
  severity: "error",
  category: "structural",
  confidence: "high",
  gateEligible: true,
  message: "Route is broken",
  objectIds: ["route-1"],
};

const observation: VisualDiagnostic = {
  code: "CROWDED_LABEL",
  severity: "info",
  category: "observation",
  confidence: "medium",
  gateEligible: false,
  message: "Label is crowded",
  objectIds: ["label-1"],
};

const ercDiagnostic: ErcDiagnostic = {
  id: "erc:fixture",
  domain: "erc",
  code: "ERC_UNCONNECTED_PIN",
  severity: "warning",
  confidence: "high",
  gateEligible: false,
  message: "RCHILD.1 is unconnected",
  primary: {
    documentId: "document-child",
    hierarchyPath: [],
    kind: "terminal",
    objectId: "RCHILD:1",
    endpoint: { kind: "terminal", instanceId: "RCHILD", pinName: "1" },
  },
  related: [],
  parameters: {},
};

describe("selection inspector details", () => {
  it("partitions visual diagnostics and counts only gate failures", () => {
    expect(summarizeVisualDiagnostics([structural, observation])).toEqual({
      all: [structural, observation],
      structural: [structural],
      observations: [observation],
      blockingCount: 1,
    });
  });

  it("renders an explicitly historical import report without duplicating live visual findings", () => {
    const markup = renderToStaticMarkup(
      <SelectionInspectorDetails
        snapshot={{
          selected: "route-1",
          internalRouteCount: 1,
          revision: 4,
          sourceStatus: "generated",
          documentCount: 2,
          activeDocumentId: "document-main",
          activeInstanceCount: 3,
          projectInstanceCount: 5,
          netCount: 2,
          tool: "pointer",
          flightlineCount: 0,
          crossingCount: 1,
          annotationCount: 2,
          status: "Selected route-1",
        }}
        importReport={{
          entryPath: "circuit.spi",
          diagnostics: [
            {
              code: "SPICE_NOTE",
              severity: "info",
              stage: "import",
              message: "Imported",
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("SPICE Import Report");
    expect(markup).toContain("Historical messages captured while importing");
    expect(markup).toContain("circuit.spi");
    expect(markup).toContain("SPICE_NOTE");
    expect(markup).not.toContain("BROKEN_ROUTE");
    expect(markup).not.toContain("CROWDED_LABEL");
  });

  it("renders revision-stamped actionable findings and hides observations by default", () => {
    const visualDiagnostic: Diagnostic = {
      ...ercDiagnostic,
      id: "visual:fixture",
      domain: "visual",
      code: "VISUAL_SHORT_SEGMENT",
      message: "Segment is too short",
    };
    const markup = renderToStaticMarkup(
      <ProjectDiagnosticsSection
        snapshot={{
          source: "live",
          projectId: "project-fixture",
          documentRevisions: [{ documentId: "document-child", revision: 7 }],
          diagnostics: [ercDiagnostic, visualDiagnostic],
        }}
        documentLabel={(documentId) =>
          documentId === "document-child" ? "Bias Child Cell" : "Main Cell"
        }
        onSelectDiagnostic={() => undefined}
      />,
    );
    expect(markup).toContain('data-testid="project-diagnostics"');
    expect(markup).not.toContain('data-testid="diagnostic-domain-erc"');
    expect(markup).toContain('data-testid="diagnostic-severity-warning"');
    expect(markup).not.toContain('data-testid="diagnostic-severity-error"');
    expect(markup).toContain('data-document-id="document-child"');
    expect(markup).toContain("Cell: Bias Child Cell");
    expect(markup).toContain("ERC / ERC_UNCONNECTED_PIN");
    expect(markup).not.toContain("VISUAL / VISUAL_SHORT_SEGMENT");
    expect(markup).toContain('data-testid="diagnostic-observations-toggle"');
    expect(markup).toContain("Show non-blocking observations (1)");
    expect(markup).toContain("Issues (1)");
  });

  it("renders concrete, navigable hierarchy Net hops", () => {
    const trace: HierarchyNetTrace = {
      primary: {
        documentId: "document-top",
        hierarchyPath: [],
        netId: "net-top",
        visibleEndpoints: [],
        routes: [],
        junctions: [],
        virtualEdges: [],
        routingGuidance: [],
      },
      highlights: [
        {
          documentId: "document-top",
          hierarchyPath: [],
          netId: "net-top",
          visibleEndpoints: [],
          routes: [],
          junctions: [],
          virtualEdges: [],
          routingGuidance: [],
        },
        {
          documentId: "document-child",
          hierarchyPath: [
            {
              parentDocumentId: "document-top",
              instanceId: "XBIAS",
              childDocumentId: "document-child",
            },
          ],
          netId: "net-child",
          visibleEndpoints: [],
          routes: [],
          junctions: [],
          virtualEdges: [],
          routingGuidance: [],
        },
      ],
      hops: [
        {
          direction: "down",
          from: {
            documentId: "document-top",
            netId: "net-top",
            hierarchyPath: [],
          },
          to: {
            documentId: "document-child",
            netId: "net-child",
            hierarchyPath: [
              {
                parentDocumentId: "document-top",
                instanceId: "XBIAS",
                childDocumentId: "document-child",
              },
            ],
          },
          frame: {
            parentDocumentId: "document-top",
            instanceId: "XBIAS",
            parentPinName: "OUT",
            childDocumentId: "document-child",
            childTerminalName: "OUT",
            childNetId: "net-child",
          },
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <NetTraceSection
        trace={trace}
        documentLabel={(documentId) =>
          documentId === "document-child" ? "Bias Child Cell" : "Top Cell"
        }
        onNavigateHop={() => undefined}
      />,
    );
    expect(markup).toContain('data-testid="net-trace-hops"');
    expect(markup).toContain('data-testid="net-trace-hop-0"');
    expect(markup).toContain("Enter");
    expect(markup).toContain("XBIAS.OUT");
    expect(markup).toContain("Bias Child Cell / net-child");
  });

  it("renders a global Net trace hop without requiring a hierarchy frame", () => {
    const trace: HierarchyNetTrace = {
      primary: {
        documentId: "document-top",
        hierarchyPath: [],
        netId: "net-vdd-top",
        visibleEndpoints: [],
        routes: [],
        junctions: [],
        virtualEdges: [],
        routingGuidance: [],
      },
      highlights: [],
      hops: [
        {
          direction: "global",
          from: {
            documentId: "document-top",
            netId: "net-vdd-top",
            hierarchyPath: [],
          },
          to: {
            documentId: "document-child",
            netId: "net-vdd-child",
            hierarchyPath: [],
          },
          foldedName: "vdd",
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <NetTraceSection
        trace={trace}
        documentLabel={(documentId) => documentId}
        onNavigateHop={() => undefined}
      />,
    );

    expect(markup).toContain("Global");
    expect(markup).toContain("vdd");
    expect(markup).toContain("document-child / net-vdd-child");
  });
});
