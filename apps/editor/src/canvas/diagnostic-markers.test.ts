import { buildProjectConnectivityIndex } from "@icm/derived";
import type { Diagnostic, VisualDiagnostic } from "@icm/derived";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildDiagnosticMarkers } from "./diagnostic-markers";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture() {
  const project = createEmptyProject("markers", "Markers", "doc-markers");
  const document = project.documents[0]!;
  document.nets.push({ id: "n1", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "n1", position: { x: 100, y: 40 }, role: "branch" },
    { id: "J2", netId: "n1", position: { x: 200, y: 40 }, role: "branch" },
  );
  const connectivityIndex = buildProjectConnectivityIndex(project, resolver);
  return { document, connectivityIndex };
}

function ercWarningAt(junctionId: string, documentId: string): Diagnostic {
  return {
    id: `erc:${junctionId}`,
    domain: "erc",
    code: "ERC_UNCONNECTED_PIN",
    severity: "warning",
    confidence: "high",
    gateEligible: false,
    message: `${junctionId} finding`,
    primary: {
      documentId,
      hierarchyPath: [],
      kind: "junction",
      objectId: junctionId,
      endpoint: { kind: "junction", junctionId },
    },
    related: [],
    parameters: {},
  };
}

const visualErrorAtJ1: VisualDiagnostic = {
  code: "VISUAL_AMBIGUOUS_JUNCTION",
  severity: "error",
  category: "structural",
  confidence: "high",
  gateEligible: true,
  message: "Junction J1 lies on unrelated route R9",
  objectIds: ["J1", "R9"],
  point: { x: 100, y: 40 },
};

const visualWarningNoPoint: VisualDiagnostic = {
  code: "VISUAL_ROUTE_OVERLAP",
  severity: "warning",
  category: "observation",
  confidence: "medium",
  gateEligible: false,
  message: "2 Routes share collinear geometry on Net n1",
  objectIds: ["R1", "R2"],
};

describe("buildDiagnosticMarkers", () => {
  it("keeps actionable error markers on outside review mode", () => {
    const { document, connectivityIndex } = fixture();
    const markers = buildDiagnosticMarkers({
      document,
      resolver,
      connectivityIndex,
      electricalDiagnostics: [],
      visualDiagnostics: [visualErrorAtJ1],
      reviewOpen: false,
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      severity: "error",
      point: { x: 100, y: 40 },
      count: 1,
    });
    expect(markers[0]!.diagnostic.code).toBe("VISUAL_AMBIGUOUS_JUNCTION");
  });

  it("shows warnings only while the issues review is open", () => {
    const { document, connectivityIndex } = fixture();
    const inputs = {
      document,
      resolver,
      connectivityIndex,
      electricalDiagnostics: [ercWarningAt("J2", document.id)],
      visualDiagnostics: [],
    };
    expect(
      buildDiagnosticMarkers({ ...inputs, reviewOpen: false }),
    ).toHaveLength(0);
    const open = buildDiagnosticMarkers({ ...inputs, reviewOpen: true });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      severity: "warning",
      point: { x: 200, y: 40 },
    });
  });

  it("clusters findings at one point under the highest severity", () => {
    const { document, connectivityIndex } = fixture();
    const markers = buildDiagnosticMarkers({
      document,
      resolver,
      connectivityIndex,
      electricalDiagnostics: [ercWarningAt("J1", document.id)],
      visualDiagnostics: [visualErrorAtJ1],
      reviewOpen: true,
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ severity: "error", count: 2 });
  });

  it("renders nothing for findings without a place on this document", () => {
    const { document, connectivityIndex } = fixture();
    const markers = buildDiagnosticMarkers({
      document,
      resolver,
      connectivityIndex,
      electricalDiagnostics: [ercWarningAt("J1", "some-other-document")],
      visualDiagnostics: [visualWarningNoPoint],
      reviewOpen: true,
    });
    expect(markers).toHaveLength(0);
  });
});
