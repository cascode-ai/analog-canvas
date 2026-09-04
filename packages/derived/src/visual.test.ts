import { createEmptyDocument, createRoutePath } from "@icm/model";
import {
  InMemorySymbolResolver,
  builtInSymbols,
  type SymbolResolver,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  diagnoseVisualQuality,
  hasBlockingVisualDiagnostics,
} from "./visual.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("visual quality diagnostics", () => {
  it("reuses default diagnostics for one immutable revision", () => {
    const document = createEmptyDocument("cached", "Cached diagnostics");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    let resolveCalls = 0;
    const countingResolver: SymbolResolver = {
      resolve(symbolId, variantId) {
        resolveCalls += 1;
        return resolver.resolve(symbolId, variantId);
      },
    };

    const first = diagnoseVisualQuality(document, countingResolver);
    const callsAfterFirst = resolveCalls;
    const second = diagnoseVisualQuality(document, countingResolver);

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(resolveCalls).toBe(callsAfterFirst);
    expect(second).toBe(first);

    document.revision += 1;
    const revised = diagnoseVisualQuality(document, countingResolver);
    expect(resolveCalls).toBeGreaterThan(callsAfterFirst);
    expect(revised).not.toBe(first);
  });

  it("reports unplaced, overlap, and alignment defects deterministically", () => {
    const document = createEmptyDocument("doc", "Visual diagnostics");
    document.instances = [
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 110, y: 120 },
          rotation: 0,
          mirror: "none",
        },
      },
      { id: "R3", symbolId: "resistor", placement: null },
    ];
    document.constraints.push({
      id: "align-r",
      kind: "align-y",
      objectIds: ["R1", "R2"],
      locked: false,
    });
    const diagnostics = diagnoseVisualQuality(document, resolver);
    expect(diagnostics.map((item) => item.code)).toEqual([
      "VISUAL_CONSTRAINT_VIOLATION",
      "VISUAL_SYMBOL_OVERLAP",
      "VISUAL_UNPLACED_INSTANCE",
    ]);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "VISUAL_SYMBOL_OVERLAP",
          category: "observation",
          confidence: "low",
          gateEligible: false,
        }),
        expect.objectContaining({
          code: "VISUAL_UNPLACED_INSTANCE",
          category: "structural",
          confidence: "high",
          gateEligible: true,
        }),
      ]),
    );
  });

  it("treats unresolved symbols as blocking without moving user geometry", () => {
    const document = createEmptyDocument("doc", "Missing symbol");
    document.instances.push({
      id: "X1",
      symbolId: "missing",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const diagnostics = diagnoseVisualQuality(document, resolver);
    expect(hasBlockingVisualDiagnostics(diagnostics)).toBe(true);
    expect(document.instances[0]!.placement!.position).toEqual({ x: 0, y: 0 });
  });

  it("ignores empty instance-label suppressors in overlap diagnostics", () => {
    const document = createEmptyDocument("doc", "Suppressed labels");
    document.annotations = ["a", "b"].map((id) => ({
      id,
      kind: "instance-label",
      content: { runs: [{ kind: "line-break" as const }] },
      anchor: { kind: "free" as const, position: { x: 100, y: 100 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    }));
    expect(diagnoseVisualQuality(document, resolver)).toEqual([]);
  });

  it("uses the canonical MOS default variant when none is specified", () => {
    const document = createEmptyDocument("doc", "Visible MOS bounds");
    document.instances = [0, 40].map((x, index) => ({
      id: `M${index + 1}`,
      symbolId: "nmos",
      symbolVariantId: "textbook-3terminal",
      placement: {
        position: { x, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    }));
    expect(
      diagnoseVisualQuality(document, resolver).filter(
        (item) => item.code === "VISUAL_SYMBOL_OVERLAP",
      ),
    ).toEqual([]);

    document.instances = document.instances.map(
      ({ symbolVariantId: _symbolVariantId, ...instance }) => instance,
    );
    expect(
      diagnoseVisualQuality(document, resolver).filter(
        (item) => item.code === "VISUAL_SYMBOL_OVERLAP",
      ),
    ).toEqual([]);
  });

  it("includes ordinary Port assets in overlap diagnostics", () => {
    const document = createEmptyDocument("doc", "Port contact");
    document.instances.push(
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "P2",
        symbolId: "port-filled",
        placement: {
          position: { x: 120, y: 100 },
          rotation: 180,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-ui-2",

      terminals: [
        { instanceId: "P1", pinName: "P" },
        { instanceId: "P2", pinName: "P" },
      ],
    });

    expect(
      diagnoseVisualQuality(document, resolver).some(
        (item) => item.code === "VISUAL_SYMBOL_OVERLAP",
      ),
    ).toBe(true);
  });

  it("does not treat a one-grid DFF pin escape as wire-through-symbol", () => {
    const document = createEmptyDocument("doc", "DFF pin escape");
    document.instances.push({
      id: "U1",
      symbolId: "d-flip-flop",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "n-d",
      terminals: [{ instanceId: "U1", pinName: "D" }],
    });
    document.junctions.push({
      id: "j-d",
      netId: "n-d",
      position: { x: 50, y: 120 },
    });
    document.routes.push(
      createRoutePath({
        id: "route-d",
        netId: "n-d",
        start: { kind: "terminal", instanceId: "U1", pinName: "D" },
        end: { kind: "junction", junctionId: "j-d" },
        bends: [{ x: 50, y: 90 }],
        modes: ["manual", "manual"],
      }),
    );

    expect(
      diagnoseVisualQuality(document, resolver).filter(
        (item) => item.code === "VISUAL_WIRE_THROUGH_SYMBOL",
      ),
    ).toEqual([]);
  });
});

describe("terminal-on-foreign-route exclusions", () => {
  function documentWithRestingPin() {
    const document = createEmptyDocument("rest", "Resting pin");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 60, y: 40 }, rotation: 0, mirror: "none" },
    });
    return document;
  }
  const foreignHits = (document: Parameters<typeof diagnoseVisualQuality>[0]) =>
    diagnoseVisualQuality(document, resolver).filter(
      (item) => item.code === "VISUAL_TERMINAL_ON_FOREIGN_ROUTE",
    );

  it("stays quiet for a pin legally attached to the route it touches", () => {
    const document = documentWithRestingPin();
    document.nets.push({
      id: "n",
      terminals: [{ instanceId: "R1", pinName: "2" }],
    });
    document.junctions.push({
      id: "J1",
      netId: "n",
      position: { x: 60, y: 140 },
      role: "route-anchor",
    });
    document.routes.push(
      createRoutePath({
        id: "own-wire",
        netId: "n",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "junction", junctionId: "J1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    expect(foreignHits(document)).toEqual([]);
  });

  it("stays quiet for a NoConnect-marked pin resting on a foreign wire", () => {
    const document = documentWithRestingPin();
    document.noConnects.push({
      id: "nc1",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "2" },
    });
    document.nets.push({ id: "netA", terminals: [] });
    document.junctions.push(
      {
        id: "J1",
        netId: "netA",
        position: { x: 0, y: 60 },
        role: "route-anchor",
      },
      {
        id: "J2",
        netId: "netA",
        position: { x: 200, y: 60 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "wireA",
        netId: "netA",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    expect(foreignHits(document)).toEqual([]);
  });

  it("stays quiet for a pin resting on another route of its own Net", () => {
    const document = documentWithRestingPin();
    document.nets.push({
      id: "n",
      terminals: [{ instanceId: "R1", pinName: "2" }],
    });
    document.junctions.push(
      { id: "J1", netId: "n", position: { x: 0, y: 60 }, role: "route-anchor" },
      {
        id: "J2",
        netId: "n",
        position: { x: 200, y: 60 },
        role: "route-anchor",
      },
    );
    document.routes.push(
      createRoutePath({
        id: "same-net-wire",
        netId: "n",
        start: { kind: "junction", junctionId: "J1" },
        end: { kind: "junction", junctionId: "J2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    expect(foreignHits(document)).toEqual([]);
  });
});
