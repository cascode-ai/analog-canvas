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

  it("bridges a retained dotless degree-two branch corner", () => {
    const doc = createEmptyDocument("branch-corner", "Branch corner");
    doc.nets.push({ id: "net", terminals: [] });
    doc.junctions.push(
      { id: "left", netId: "net", position: { x: 0, y: 0 } },
      {
        id: "corner",
        netId: "net",
        position: { x: 40, y: 0 },
        role: "branch",
      },
      { id: "bottom", netId: "net", position: { x: 40, y: 40 } },
    );
    doc.routes.push(
      createRoutePath({
        id: "horizontal",
        netId: "net",
        start: { kind: "junction", junctionId: "left" },
        end: { kind: "junction", junctionId: "corner" },
        bends: [],
        modes: ["manual"],
      }),
      createRoutePath({
        id: "vertical",
        netId: "net",
        start: { kind: "junction", junctionId: "corner" },
        end: { kind: "junction", junctionId: "bottom" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const scene = buildSvgScene(doc, new InMemorySymbolResolver([]));

    expect(scene.formalBody).toContain('data-role="junction-miter-bridge"');
    expect(scene.formalBody).toContain('data-junction-id="corner"');
  });

  it("renders a Route override while an unstyled Route keeps the profile color", () => {
    const doc = createEmptyDocument("wire-color", "Wire color");
    doc.nets.push({ id: "net", terminals: [] });
    doc.junctions.push(
      { id: "J1", netId: "net", position: { x: 0, y: 0 } },
      { id: "J2", netId: "net", position: { x: 40, y: 0 } },
      { id: "J3", netId: "net", position: { x: 80, y: 0 } },
    );
    doc.routes.push(
      createRoutePath({
        id: "colored-wire",
        netId: "net",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
        styleOverride: { color: "#CC2244" },
      }),
      createRoutePath({
        id: "default-wire",
        netId: "net",
        start: { kind: "junction", junctionId: "J2" },
        end: { kind: "junction", junctionId: "J3" },
        bends: [],
        modes: ["manual"],
      }),
    );

    const scene = buildSvgScene(doc, new InMemorySymbolResolver([]));
    expect(scene.formalBody).toContain(
      'data-object-id="colored-wire" data-net-id="net" points="0,0 40,0" fill="none" stroke="#CC2244"',
    );
    expect(scene.formalBody).toContain(
      'data-object-id="default-wire" data-net-id="net" points="40,0 80,0" fill="none" stroke="#000"',
    );
  });

  it("renders a right-tapered transconductance frame, matching background, and subscript formula", () => {
    const transconductance = {
      ...definition,
      id: "transconductance",
      name: "Transconductance (+gₘ)",
      viewBox: { x: -44, y: -39, width: 88, height: 78 },
      formulaPresentation: {
        ...definition.formulaPresentation,
        defaultFormula: "+g_m",
        adaptiveFrame: {
          ...definition.formulaPresentation.adaptiveFrame,
          shape: "right-tapered-trapezoid" as const,
          minBodyWidth: 40,
          horizontalPadding: 4,
          minBodyHeight: 70,
        },
      },
    };
    const doc = createEmptyDocument("main", "Main");
    doc.instances.push({
      id: "gm1",
      symbolId: "transconductance",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      styleOverride: { background: "#ffeedd" },
      signalFlowParameters: { formula: "−gₘL" },
    });

    const scene = buildSvgScene(
      doc,
      new InMemorySymbolResolver([transconductance]),
    );
    expect(scene.formalBody).toContain(
      'data-role="instance-background" fill="#ffeedd" stroke="none" points="-20,-35 20,-17.5 20,17.5 -20,35"',
    );
    expect(scene.formalBody).toContain(
      'data-role="signal-flow-frame" data-part="body"',
    );
    expect(scene.formalBody).toContain(
      'points="-20,-35 20,-17.5 20,17.5 -20,35"',
    );
    expect(scene.formalBody).toContain('data-role="formula-subscript"');
    expect(scene.formalBody).toContain(">mL</tspan>");
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
