import {
  createEmptyDocument,
  createRoutePath,
  resolveClosedSymbolPath,
  transformPoint,
  type Point,
  type RouteEndpoint,
  type DraftingObject,
  type SymbolDefinition,
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

const implicitPin: SymbolDefinition["pins"][number] = {
  name: "P",
  role: "passive",
  at: { x: 0, y: 0 },
  direction: "east",
  presentation: { visibility: "implicit" },
};

function filledRectangle(
  id: string,
  center: Point,
  width: number,
  height: number,
  layer: "background" | "foreground",
): DraftingObject {
  return {
    id,
    kind: "rectangle",
    center,
    width,
    height,
    layer,
    zIndex: 0,
    locked: false,
    anchor: { kind: "free", position: center },
    lineStyle: "solid",
    rotation: 0,
    styleOverride: { fillColor: "#c8d0de" },
  };
}

describe("visual quality diagnostics", () => {
  it.each([
    {
      name: "separate lobes",
      data: "M0 0H20V20H0Z M80 0H100V20H80Z",
      from: { x: -10, y: 10 },
      to: { x: 110, y: 10 },
      covered: true,
      rotation: 0 as const,
      mirror: "none" as const,
    },
    {
      name: "rotated lobes",
      data: "M0 0H20V20H0Z M80 0H100V20H80Z",
      from: { x: -10, y: 10 },
      to: { x: 110, y: 10 },
      covered: true,
      rotation: 90 as const,
      mirror: "horizontal" as const,
    },
    {
      name: "along a closed path's lower border",
      data: "M0 0H20V20H0Z",
      from: { x: -10, y: 20 },
      to: { x: 30, y: 20 },
      covered: true,
      rotation: 0 as const,
      mirror: "none" as const,
    },
    {
      name: "along an even-odd cancelled border",
      data: "M0 0H20V20H0Z M0 0H20V20H0Z M80 0H100V20H80Z",
      from: { x: -10, y: 20 },
      to: { x: 30, y: 20 },
      covered: false,
      rotation: 0 as const,
      mirror: "none" as const,
    },
    {
      name: "along an oblique closed path border",
      data: "M1 5L3 15L3 28L1 18Z",
      from: { x: 0, y: 0 },
      to: { x: 10, y: 50 },
      covered: true,
      rotation: 0 as const,
      mirror: "none" as const,
    },
    {
      name: "inside an unpainted hole",
      data: "M0 0H100V100H0Z M20 20H80V80H20Z",
      from: { x: 30, y: 50 },
      to: { x: 70, y: 50 },
      covered: false,
      rotation: 90 as const,
      mirror: "horizontal" as const,
    },
    {
      name: "off-center curved lobe",
      data: "M0 8Q8 -8 16 8Q8 24 0 8Z M80 8Q88 -8 96 8Q88 24 80 8Z",
      from: { x: -10, y: 6 },
      to: { x: 110, y: 6 },
      covered: true,
      rotation: 0 as const,
      mirror: "none" as const,
    },
    {
      name: "diagonal through separate curved lobes",
      data: "M0 8A8 6 20 0 1 16 8A8 6 20 0 1 0 8Z M84 82Q92 66 100 82Q92 98 84 82Z",
      from: { x: -10, y: -10 },
      to: { x: 110, y: 110 },
      covered: true,
      rotation: 0 as const,
      mirror: "none" as const,
    },
  ])(
    "observes routes through marked paths ($name)",
    ({ data, from, to, covered, rotation, mirror }) => {
      const symbol: SymbolDefinition = {
        schemaVersion: 1,
        id: "path-body",
        name: "Path body",
        viewBox: { x: 0, y: 0, width: 100, height: 100 },
        primitives: [{ kind: "path", data, fillableBody: true }],
        pins: [implicitPin],
        variants: [],
      };
      const document = createEmptyDocument("path-cover", "Path cover");
      const placement = { position: { x: 200, y: 200 }, rotation, mirror };
      document.instances = [
        {
          id: "path",
          symbolId: symbol.id,
          placement,
          bodyFill: { kind: "background" },
        },
      ];
      document.nets = [{ id: "net", terminals: [] }];
      document.junctions = [
        {
          id: "start",
          netId: "net",
          position: transformPoint(from, placement.position, placement),
        },
        {
          id: "end",
          netId: "net",
          position: transformPoint(to, placement.position, placement),
        },
      ];
      document.routes = [
        createRoutePath({
          id: "route",
          netId: "net",
          start: { kind: "junction", junctionId: "start" },
          end: { kind: "junction", junctionId: "end" },
          bends: [],
          modes: ["manual"],
        }),
      ];
      const diagnostics = diagnoseVisualQuality(
        document,
        new InMemorySymbolResolver([symbol]),
      );
      expect(
        diagnostics
          .filter(({ code }) => code === "VISUAL_DRAWING_OCCLUSION")
          .map(({ objectIds }) => objectIds),
      ).toEqual(covered ? [["route", "path"]] : []);
    },
  );

  it("uses finite scan coordinates for an accepted extreme cubic", () => {
    const path = resolveClosedSymbolPath(
      "M0 0 C1.6e308 0 0 1.6e308 1.0e307 1.0e307 V0Z",
    );
    expect(path.ok).toBe(true);
    if (!path.ok) return;
    const witness = path.geometry.segmentWitness(
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    );
    if (witness) {
      expect(witness.x + witness.y).toBeCloseTo(10);
      expect(path.geometry.contains(witness)).toBe(true);
    }
  });

  it("uses the active variant's adaptive artwork when detecting occlusion", () => {
    const document = createEmptyDocument(
      "adaptive-coverage",
      "Adaptive coverage",
    );
    const rear: SymbolDefinition = {
      schemaVersion: 1,
      id: "framed",
      name: "Frame with separate body",
      viewBox: { x: -30, y: -20, width: 100, height: 40 },
      formulaPresentation: {
        defaultFormula: "F",
        supportsCoefficient: false,
        center: { x: 0, y: 0 },
        fontSize: 8,
        adaptiveFrame: {
          minBodyWidth: 60,
          minBodyHeight: 40,
          horizontalPadding: 10,
          verticalPadding: 10,
          leadLength: 10,
        },
      },
      primitives: [
        {
          kind: "rectangle",
          part: "body",
          bounds: { x: -30, y: -20, width: 60, height: 40 },
          fillableBody: true,
        },
        {
          kind: "rectangle",
          part: "extra",
          bounds: { x: 40, y: 12, width: 20, height: 12 },
          fillableBody: true,
        },
      ],
      pins: [implicitPin],
      variants: [
        { id: "no-frame", hiddenPinNames: [], hiddenPrimitiveParts: ["body"] },
      ],
    };
    document.instances = [
      {
        id: "rear",
        symbolId: rear.id,
        symbolVariantId: "no-frame",
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    document.drafting = {
      objects: [
        filledRectangle("visible-edge", { x: 250, y: 212 }, 8, 8, "foreground"),
        filledRectangle("hidden-frame", { x: 210, y: 180 }, 8, 8, "foreground"),
      ],
    };
    const diagnostics = diagnoseVisualQuality(
      document,
      new InMemorySymbolResolver([rear]),
    );
    expect(
      diagnostics
        .filter(({ code }) => code === "VISUAL_DRAWING_OCCLUSION")
        .map(({ objectIds }) => objectIds),
    ).toEqual([["rear", "visible-edge"]]);
  });

  it("includes an adaptive symbol's horizontal leads in occlusion findings", () => {
    const document = createEmptyDocument("adaptive-lead", "Adaptive lead");
    document.instances = [
      {
        id: "integrator",
        symbolId: "integrator",
        placement: {
          position: { x: 200, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    document.drafting = {
      objects: [
        filledRectangle("lead-cover", { x: 175, y: 200 }, 2, 2, "foreground"),
      ],
    };
    expect(
      diagnoseVisualQuality(document, resolver)
        .filter(({ code }) => code === "VISUAL_DRAWING_OCCLUSION")
        .map(({ objectIds }) => objectIds),
    ).toEqual([["integrator", "lead-cover"]]);
  });

  it("observes the actual world position of upright part ink", () => {
    const document = createEmptyDocument("upright", "Upright mark");
    document.instances = [
      {
        id: "rear",
        symbolId: "upright",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 90,
          mirror: "none",
        },
      },
    ];
    document.drafting = {
      objects: [
        filledRectangle("painted", { x: 107, y: 100 }, 2, 2, "foreground"),
        filledRectangle("unpainted", { x: 100, y: 107 }, 2, 2, "foreground"),
      ],
    };
    const symbols = new InMemorySymbolResolver([
      {
        schemaVersion: 1,
        id: "upright",
        name: "Upright mark",
        pins: [implicitPin],
        viewBox: { x: -10, y: -2, width: 20, height: 4 },
        variants: [],
        primitives: [
          {
            kind: "line",
            part: "upright-test",
            from: { x: -10, y: 0 },
            to: { x: 10, y: 0 },
          },
        ],
      },
    ]);
    expect(
      diagnoseVisualQuality(document, symbols)
        .filter(({ code }) => code === "VISUAL_DRAWING_OCCLUSION")
        .map(({ objectIds }) => objectIds),
    ).toEqual([["rear", "painted"]]);
  });

  it("reports filled shapes over a rear fill and a narrow interval of a long wire", () => {
    const document = createEmptyDocument("covered-ink", "Covered ink");
    document.drafting = {
      objects: [
        filledRectangle("rear-fill", { x: 100, y: 80 }, 200, 100, "background"),
        filledRectangle("front-fill", { x: 40, y: 60 }, 20, 20, "foreground"),
      ],
    };
    document.nets = [{ id: "net", terminals: [] }];
    document.junctions = [
      { id: "start", netId: "net", position: { x: 0, y: 60 } },
      { id: "end", netId: "net", position: { x: 400, y: 60 } },
    ];
    document.routes = [
      createRoutePath({
        id: "wire",
        netId: "net",
        start: { kind: "junction", junctionId: "start" },
        end: { kind: "junction", junctionId: "end" },
        bends: [],
        modes: ["manual"],
      }),
    ];
    expect(
      diagnoseVisualQuality(document, resolver)
        .filter(({ code }) => code === "VISUAL_DRAWING_OCCLUSION")
        .map(({ objectIds }) => objectIds),
    ).toEqual([
      ["rear-fill", "front-fill"],
      ["wire", "front-fill"],
    ]);
  });

  it("finds narrow crossing strokes and only treats a filled rear interior as ink", () => {
    const document = createEmptyDocument("covered-strokes", "Covered strokes");
    const rear = filledRectangle(
      "rear-fill",
      { x: 200, y: 200 },
      200,
      20,
      "background",
    );
    const cover = filledRectangle(
      "crossing-fill",
      { x: 140, y: 150 },
      20,
      200,
      "foreground",
    );
    const interiorCover = filledRectangle(
      "interior-only",
      { x: 140, y: 200 },
      10,
      10,
      "foreground",
    );
    const { styleOverride: _fill, ...rearOutline } = rear;
    const findings = (objects: DraftingObject[]) =>
      diagnoseVisualQuality({ ...document, drafting: { objects } }, resolver)
        .filter(({ code }) => code === "VISUAL_DRAWING_OCCLUSION")
        .map(({ objectIds }) => objectIds);
    expect(findings([rear, cover])).toEqual([["rear-fill", "crossing-fill"]]);
    expect(findings([rearOutline, cover])).toEqual([
      ["rear-fill", "crossing-fill"],
    ]);
    expect(findings([rearOutline, interiorCover])).toEqual([]);
  });

  it("names an opaque middle symbol behind a foremost transparent one", () => {
    const document = createEmptyDocument("stack", "Opaque middle");
    document.instances = [
      ...["ADC1", "ADC2", "ADC3"].map((id, index) => ({
        id,
        symbolId: "adc",
        placement: {
          position: { x: 100 + index * 20, y: 80 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
        ...(id === "ADC2" ? { bodyFill: { kind: "background" as const } } : {}),
      })),
    ];
    const occlusion = diagnoseVisualQuality(document, resolver).filter(
      ({ code }) => code === "VISUAL_DRAWING_OCCLUSION",
    );
    expect(occlusion).toMatchObject([
      { objectIds: ["ADC1", "ADC2"], gateEligible: false },
    ]);
  });

  it("does not treat an unpainted symbol polygon as covered ink", () => {
    const document = createEmptyDocument("inkless", "Inkless symbol");
    document.instances = [
      {
        id: "unpainted",
        symbolId: "unpainted-symbol",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    const center = { x: 100, y: 100 };
    document.drafting = {
      objects: [
        {
          id: "front-fill",
          kind: "rectangle",
          center,
          width: 40,
          height: 20,
          layer: "foreground",
          zIndex: 0,
          locked: false,
          anchor: { kind: "free", position: center },
          lineStyle: "solid",
          rotation: 0,
          styleOverride: { fillColor: "#c8d0de" },
        },
      ],
    };
    const symbols = new InMemorySymbolResolver([
      ...builtInSymbols,
      {
        schemaVersion: 1,
        id: "unpainted-symbol",
        name: "Unpainted symbol",
        viewBox: { x: -5, y: -5, width: 10, height: 10 },
        primitives: [
          {
            kind: "polygon",
            points: [
              { x: -5, y: -5 },
              { x: 5, y: -5 },
              { x: 0, y: 5 },
            ],
            fill: "none",
            stroke: "none",
          },
        ],
        pins: [
          {
            name: "P",
            role: "passive",
            at: { x: 0, y: 0 },
            direction: "east",
            presentation: { visibility: "implicit" },
          },
        ],
        variants: [],
      },
    ]);
    expect(
      diagnoseVisualQuality(document, symbols).filter(
        ({ code }) => code === "VISUAL_DRAWING_OCCLUSION",
      ),
    ).toEqual([]);
  });

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

  it.each(["manual"] as const)(
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
    // P2's lead runs back over P1's.
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
          position: { x: 96, y: 100 },
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

  it("does not report parts that meet pin to pin as overlapping (#1418)", () => {
    const part = (
      id: string,
      symbolId: string,
      x: number,
      y: number,
      rotation: 0 | 180 = 0,
      mirror: "none" | "horizontal" = "none",
    ) => ({
      id,
      symbolId,
      placement: { position: { x, y }, rotation, mirror },
    });
    const overlaps = (
      ...instances: ReturnType<typeof part>[]
    ): readonly (readonly string[])[] => {
      const document = createEmptyDocument("doc", "Pin to pin");
      document.instances = instances;
      return diagnoseVisualQuality(document, resolver)
        .filter((item) => item.code === "VISUAL_SYMBOL_OVERLAP")
        .map((item) => item.objectIds);
    };
    // Each lead continues the other's; no Net excuses the contact.
    // A T supply on a source, as pinAnchor placed it in a Banba bandgap:
    // M7.S at (220,-120).
    expect(
      overlaps(
        part("VDD7", "vdd-port", 220, -140),
        part("M7", "pmos", 230, -100, 0, "horizontal"),
      ),
    ).toEqual([]);
    // On an NMOS turned source up, and on a current source's + pin.
    expect(
      overlaps(
        part("VDD1", "vdd-port", 90, 40),
        part("M1", "nmos", 100, 80, 180),
      ),
    ).toEqual([]);
    expect(
      overlaps(
        part("VDD2", "vdd-port", 300, 60),
        part("IREF", "current-source", 300, 100),
      ),
    ).toEqual([]);
    // A ground on an NMOS source.
    expect(
      overlaps(part("GND", "ground", 410, 130), part("M2", "nmos", 400, 100)),
    ).toEqual([]);
    // A degeneration coil whose pin lands on M1.S at (300,-20); its box
    // came from the viewBox, 3 units past the pin.
    expect(
      overlaps(part("Ls", "inductor", 300, 10), part("M3", "nmos", 290, -40)),
    ).toEqual([]);
    // Two Ports back to back.
    expect(
      overlaps(part("P1", "port", 100, 100), part("P2", "port", 100, 100, 180)),
    ).toEqual([]);

    // A part sunk into another is still reported: the T ten units down the
    // transistor's source lead, the coil ten units up into its transistor.
    expect(
      overlaps(
        part("VDD7", "vdd-port", 220, -130),
        part("M7", "pmos", 230, -100, 0, "horizontal"),
      ),
    ).toEqual([["M7", "VDD7"]]);
    expect(
      overlaps(part("Ls", "inductor", 300, 0), part("M3", "nmos", 290, -40)),
    ).toEqual([["Ls", "M3"]]);
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
    // R1 stands at the origin, pin 1 at (0,-20) pointing up; a ground at
    // (100,0) has its one pin at (100,-10), pointing up; PMOS M1 at (200,0)
    // has its source at (210,-20), pointing up, on the edge of its drawing;
    // Cell Pin vout at (300,0) has its pin there, pointing right. Findings
    // name each by what its author knows it as, not by its ID.
    type End = { instanceId: string; pinName: string } | Point;
    const findings = (...wires: (readonly [End, End])[]) => {
      const document = createEmptyDocument("doc", "Departures");
      document.instances.push(
        {
          id: "part-r1",
          reference: "R1",
          symbolId: "resistor",
          placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        },
        {
          id: "part-gnd",
          symbolId: "ground",
          placement: {
            position: { x: 100, y: 0 },
            rotation: 0,
            mirror: "none",
          },
        },
        {
          id: "part-m1",
          reference: "M1",
          symbolId: "pmos",
          placement: {
            position: { x: 200, y: 0 },
            rotation: 0,
            mirror: "none",
          },
        },
        {
          id: "part-vout",
          symbolId: "port",
          placement: {
            position: { x: 300, y: 0 },
            rotation: 0,
            mirror: "none",
          },
        },
      );
      document.netlist = {
        name: "Departures",
        terminals: [
          {
            id: "terminal-vout",
            name: "vout",
            netId: "n",
            direction: "output",
            interfaceInstanceIds: ["part-vout"],
          },
        ],
        formalParameters: [],
      };
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
    const r1 = { instanceId: "part-r1", pinName: "1" };
    const ground = { instanceId: "part-gnd", pinName: "0" };

    // A bend at the end of a part's lead is drafting.
    expect(findings([r1, { x: 40, y: -20 }])).toEqual([]);
    // Back across the part is named once, as such; back along a lead on the
    // drawing's edge is a backward departure.
    expect(findings([r1, { x: 0, y: 40 }])).toEqual([
      "Route w0 runs back across its own part R1",
    ]);
    expect(
      findings([
        { instanceId: "part-m1", pinName: "S" },
        { x: 210, y: -10 },
      ]),
    ).toEqual(["Route w0 leaves M1.S backward, against the pin's direction"]);
    // A ground hanging off the side of a wire, at either end of its Route.
    expect(findings([ground, { x: 140, y: -10 }])).toEqual([
      "Route w0 leaves ground.0 from the side",
    ]);
    expect(findings([{ x: 140, y: -10 }, ground])).toEqual([
      "Route w0 leaves ground.0 from the side",
    ]);
    expect(
      findings([
        { instanceId: "part-vout", pinName: "P" },
        { x: 300, y: -40 },
      ]),
    ).toEqual(["Route w0 leaves vout.P from the side"]);
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
