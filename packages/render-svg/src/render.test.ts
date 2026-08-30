import { createEmptyDocument, createRoutePath } from "@icm/model";
import {
  deriveDocumentContactEvidence,
  resolveDocumentRoutingGeometry,
} from "@icm/derived";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildSvgScene } from "./render.js";

const definition = {
  schemaVersion: 1 as const,
  id: "formula-block",
  name: "Formula block",
  viewBox: { x: -40, y: -20, width: 80, height: 40 },
  pins: [
    {
      name: "A",
      role: "input",
      at: { x: -40, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const, showName: true },
    },
    {
      name: "Y",
      role: "output",
      at: { x: 40, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const, showName: true },
    },
  ],
  primitives: [],
  variants: [],
  formulaPresentation: {
    defaultFormula: "z^-1/(1-z^-1)",
    supportsCoefficient: true as const,
    center: { x: 0, y: 0 },
    fontSize: 12,
    adaptiveFrame: {
      minBodyWidth: 120,
      minBodyHeight: 60,
      horizontalPadding: 16,
      verticalPadding: 12,
      leadLength: 20,
    },
  },
};

describe("render svg", () => {
  it("renders identically from one shared routing read model", () => {
    const doc = createEmptyDocument("shared", "Shared read model");
    doc.nets.push({ id: "net", terminals: [] });
    doc.junctions.push(
      { id: "J1", netId: "net", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net", position: { x: 40, y: 0 } },
    );
    doc.routes.push(
      createRoutePath({
        id: "route",
        netId: "net",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const resolver = new InMemorySymbolResolver([]);
    const routingGeometry = resolveDocumentRoutingGeometry(doc, resolver);
    const contactEvidence = deriveDocumentContactEvidence(
      doc,
      resolver,
      routingGeometry,
    );

    expect(
      buildSvgScene(doc, resolver, { routingGeometry, contactEvidence }),
    ).toEqual(buildSvgScene(doc, resolver));

    doc.revision += 1;
    expect(() => buildSvgScene(doc, resolver, { routingGeometry })).toThrow(
      "SVG renderer received stale routing geometry",
    );
  });

  it("renders signal-flow-frame, 12pt formula, fraction line, dynamic leads, and keeps pin names", () => {
    const doc = createEmptyDocument("main", "Main");
    doc.instances.push({
      id: "i1",
      symbolId: "formula-block",
      placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
      signalFlowParameters: {
        formula: "z^-1/(1-z^-1)",
        coefficient: "K",
        bodyWidth: 160,
        bodyHeight: 100,
      },
    });

    const scene = buildSvgScene(doc, new InMemorySymbolResolver([definition]));
    expect(scene.formalBody).toContain('data-role="signal-flow-frame"');
    expect(scene.formalBody).toContain('font-size="12"');
    expect(scene.formalBody).toContain('data-role="formula-fraction-bar"');
    expect(scene.formalBody).toContain('data-part="input-a-lead"');
    expect(scene.formalBody).toContain('data-part="output-y-lead"');
    expect(scene.formalBody).toContain('data-pin-name="A"');
    expect(scene.formalBody).toContain('data-pin-name="Y"');
  });
});
