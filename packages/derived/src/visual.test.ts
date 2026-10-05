import {
  createEmptyDocument,
  createRoutePath,
  type Point,
  type RouteEndpoint,
} from "@icm/model";
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
  it.each([true, false])(
    "counts only rendered annotations in overlap diagnostics (visible=%s)",
    (visible) => {
      const document = createEmptyDocument("labels", "Labels");
      document.annotations = ["a", "b"].map((id) => ({
        id,
        kind: "instance-label",
        content: { runs: [{ kind: "text", value: "M1" }] },
        anchor: { kind: "free", position: { x: 100, y: 100 } },
        alignment: "middle",
        rotation: 0,
        locked: false,
        visible: id === "a" || visible,
      }));
      const overlaps = diagnoseVisualQuality(document, resolver).filter(
        (d) => d.code === "VISUAL_LABEL_OVERLAP",
      );
      expect(overlaps).toHaveLength(visible ? 1 : 0);
    },
  );
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

  it.each(["manual", "locked", "trunk"] as const)(
    "accepts arbitrary wire angles for %s routes without diagnostics",
    (mode) => {
      const document = createEmptyDocument("doc", "Wire angle diagnostics");
      document.nets.push(
        { id: "n1", terminals: [] },
        { id: "n2", terminals: [] },
      );
      document.junctions.push(
        { id: "j1", netId: "n1", position: { x: 0, y: 0 } },
        { id: "j2", netId: "n1", position: { x: 30, y: 30 } },
        { id: "j3", netId: "n2", position: { x: 0, y: 60 } },
        { id: "j4", netId: "n2", position: { x: 40, y: 80 } },
      );
      document.routes.push(
        createRoutePath({
          id: "intentional-45",
          netId: "n1",
          start: { kind: "junction", junctionId: "j1" },
          end: { kind: "junction", junctionId: "j2" },
          bends: [],
          modes: ["manual"],
        }),
        createRoutePath({
          id: "free-angled",
          netId: "n2",
          start: { kind: "junction", junctionId: "j3" },
          end: { kind: "junction", junctionId: "j4" },
          bends: [],
          modes: [mode],
        }),
      );

      expect(diagnoseVisualQuality(document, resolver)).toEqual([]);
    },
  );

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
          position: { x: 100, y: 100 },
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

    // The old stems reached one cell farther from each placement origin.
    // This spacing is now clear and must not retain their old overlap bounds.
    document.instances[1]!.placement!.position.x = 120;
    document.revision += 1;
    expect(
      diagnoseVisualQuality(document, resolver).some(
        (item) => item.code === "VISUAL_SYMBOL_OVERLAP",
      ),
    ).toBe(false);
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

  it("reports a wire leaving an op-amp's input back across its own triangle (#1301)", () => {
    // IN+ lands at (-40,10) on an op-amp at the origin; its triangle spans
    // x -30..22.
    const wired = (end: { x: number; y: number }) => {
      const document = createEmptyDocument("doc", "Own body");
      document.instances.push({
        id: "X1",
        symbolId: "opamp",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      });
      document.nets.push({
        id: "n",
        terminals: [{ instanceId: "X1", pinName: "IN+" }],
      });
      document.junctions.push({ id: "end", netId: "n", position: end });
      document.routes.push(
        createRoutePath({
          id: "w",
          netId: "n",
          start: { kind: "terminal", instanceId: "X1", pinName: "IN+" },
          end: { kind: "junction", junctionId: "end" },
          bends: [],
          modes: ["manual"],
        }),
      );
      return diagnoseVisualQuality(document, resolver).filter(
        (item) => item.code === "VISUAL_WIRE_THROUGH_SYMBOL",
      );
    };
    expect(wired({ x: -100, y: 10 })).toEqual([]);
    // Information, not a warning: drawings often run a bias line on through
    // the transistor its gate is on.
    expect(wired({ x: 60, y: 10 })).toMatchObject([
      { objectIds: ["w", "X1"], severity: "info" },
    ]);
  });

  it("reports a wire leaving a pin backward or from the side of a lone ground, not a bend at a lead's end", () => {
    // R1 stands at the origin, pin 1 at (0,-20) pointing up; GND at (100,0)
    // has its one pin at (100,-10), pointing up; PMOS M1 at (200,0) has its
    // source at (210,-20), pointing up, on the edge of its drawing.
    type End = { instanceId: string; pinName: string } | Point;
    const findings = (...wires: (readonly [End, End])[]) => {
      const document = createEmptyDocument("doc", "Departures");
      document.instances.push(
        {
          id: "R1",
          symbolId: "resistor",
          placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        },
        {
          id: "GND",
          symbolId: "ground",
          placement: {
            position: { x: 100, y: 0 },
            rotation: 0,
            mirror: "none",
          },
        },
        {
          id: "M1",
          symbolId: "pmos",
          placement: {
            position: { x: 200, y: 0 },
            rotation: 0,
            mirror: "none",
          },
        },
      );
      const terminals = new Map<
        string,
        { instanceId: string; pinName: string }
      >();
      const endpoint = (end: End, id: string): RouteEndpoint => {
        if ("instanceId" in end) {
          terminals.set(`${end.instanceId}.${end.pinName}`, end);
          return { kind: "terminal", ...end };
        }
        document.junctions.push({ id, netId: "n", position: end });
        return { kind: "junction", junctionId: id };
      };
      wires.forEach(([from, to], index) =>
        document.routes.push(
          createRoutePath({
            id: `w${index}`,
            netId: "n",
            start: endpoint(from, `j${index}a`),
            end: endpoint(to, `j${index}b`),
            bends: [],
            modes: ["manual"],
          }),
        ),
      );
      document.nets.push({ id: "n", terminals: [...terminals.values()] });
      return diagnoseVisualQuality(document, resolver)
        .filter(
          (item) =>
            item.code === "VISUAL_TERMINAL_DEPARTURE" ||
            item.code === "VISUAL_WIRE_THROUGH_SYMBOL",
        )
        .map((item) => item.message);
    };
    const r1 = { instanceId: "R1", pinName: "1" };
    const ground = { instanceId: "GND", pinName: "0" };

    // A bend at the end of a part's lead is drafting.
    expect(findings([r1, { x: 40, y: -20 }])).toEqual([]);
    // Back across the part is named once, as such; back along a lead on the
    // drawing's edge is a backward departure.
    expect(findings([r1, { x: 0, y: 40 }])).toEqual([
      "Route w0 runs back across its own part R1",
    ]);
    expect(
      findings([
        { instanceId: "M1", pinName: "S" },
        { x: 210, y: -10 },
      ]),
    ).toEqual(["Route w0 leaves M1.S backward, against the pin's direction"]);
    // A ground hanging off the side of a wire, at either end of its Route.
    expect(findings([ground, { x: 140, y: -10 }])).toEqual([
      "Route w0 leaves GND.0 from the side",
    ]);
    expect(findings([{ x: 140, y: -10 }, ground])).toEqual([
      "Route w0 leaves GND.0 from the side",
    ]);
    // Under a rail that runs on past it, the ground is a tap.
    expect(
      findings([ground, { x: 140, y: -10 }], [ground, { x: 60, y: -10 }]),
    ).toEqual([]);
  });

  it("reports a wire through a MOS, not one grazing its edge from a pin or toward its gate", () => {
    // An NMOS at the origin: D (10,-20), G (-20,0), S (10,20).
    const document = createEmptyDocument("doc", "MOS edges");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const wire = (
      id: string,
      start: Parameters<typeof createRoutePath>[0]["start"],
      bends: { x: number; y: number }[],
      end: { x: number; y: number },
    ) => {
      document.nets.push({
        id: `n-${id}`,
        terminals:
          start.kind === "terminal"
            ? [{ instanceId: start.instanceId, pinName: start.pinName }]
            : [],
      });
      const junctions = [
        ...(start.kind === "junction" ? [start.junctionId] : []),
        `${id}-end`,
      ];
      for (const junctionId of junctions)
        document.junctions.push({
          id: junctionId,
          netId: `n-${id}`,
          position: junctionId === `${id}-end` ? end : { x: -60, y: 0 },
        });
      document.routes.push(
        createRoutePath({
          id,
          netId: `n-${id}`,
          start,
          end: { kind: "junction", junctionId: `${id}-end` },
          bends,
          modes: [...bends, end].map(() => "manual" as const),
        }),
      );
    };
    // From the source, a jog along the part's bottom edge, then away.
    wire(
      "source",
      { kind: "terminal", instanceId: "M1", pinName: "S" },
      [{ x: 0, y: 20 }],
      { x: 0, y: 100 },
    );
    // Along the drain's level to the corner over the gate, then up.
    wire(
      "corner",
      { kind: "terminal", instanceId: "M1", pinName: "G" },
      [{ x: -20, y: -20 }],
      { x: -100, y: -20 },
    );
    // A copy each time: findings are cached per Document object.
    const through = () =>
      diagnoseVisualQuality(structuredClone(document), resolver)
        .filter((item) => item.code === "VISUAL_WIRE_THROUGH_SYMBOL")
        .map((item) => item.objectIds[0]);
    expect(through()).toEqual([]);
    // Straight across the channel is still through the part.
    wire("across", { kind: "junction", junctionId: "across-start" }, [], {
      x: 40,
      y: 0,
    });
    expect(through()).toEqual(["across"]);
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
