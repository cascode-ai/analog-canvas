import { createEmptyDocument, type Instance } from "@icm/model";
import { resolveEndpointConnection } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { pinAnchoredPlacement } from "./pin-anchor-placement.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
describe("pin anchored placement", () => {
  for (const symbolId of ["nmos", "pmos", "port"]) {
    for (const rotation of [0, 90, 180, 270] as const) {
      it.each(["none", "horizontal", "vertical", "both"] as const)(
        `${symbolId} rotation ${rotation} mirror %s`,
        (mirror) => {
          const document = createEmptyDocument("main", "Main");
          const instance: Instance = {
            id: "I",
            symbolId,
            placement: { position: { x: 500, y: 500 }, rotation, mirror },
          };
          const pinName = symbolId === "port" ? "P" : "G";
          const before = structuredClone(document);
          const anchor = { pinName, position: { x: 120, y: 80 } };
          const placement = pinAnchoredPlacement(
            document,
            resolver,
            instance,
            anchor,
          );
          expect(
            resolveEndpointConnection(
              { ...document, instances: [{ ...instance, placement }] },
              resolver,
              { kind: "terminal", instanceId: "I", pinName },
            )?.gridLanding,
          ).toEqual(anchor.position);
          expect(placement).toMatchObject({ rotation, mirror });
          expect(document).toEqual(before);
          expect(instance.placement!.position).toEqual({ x: 500, y: 500 });
        },
      );
    }
  }

  it("uses variant preferred landing, fine pin pitch and the document placement grid", () => {
    const symbol = structuredClone(
      builtInSymbols.find((item) => item.id === "resistor")!,
    );
    symbol.id = "test-fine";
    const pinName = symbol.pins[0]!.name;
    symbol.variants = [
      {
        id: "fine",
        hiddenPinNames: [],
        auxiliaryPins: [
          {
            name: pinName,
            at: { x: 16, y: 12 },
            direction: "east",
            routing: { escape: "outward", preferredLanding: { x: 20, y: 12 } },
          },
        ],
      },
    ];
    const fineResolver = new InMemorySymbolResolver([symbol]);
    const document = createEmptyDocument("fine", "Fine");
    const instance: Instance = {
      id: "R",
      symbolId: symbol.id,
      symbolVariantId: "fine",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    };
    const placement = pinAnchoredPlacement(document, fineResolver, instance, {
      pinName,
      position: { x: 120, y: 112 },
    });
    expect(placement.position).toEqual({ x: 100, y: 100 });
    const connection = resolveEndpointConnection(
      { ...document, instances: [{ ...instance, placement }] },
      fineResolver,
      { kind: "terminal", instanceId: "R", pinName },
    );
    expect(connection).toMatchObject({
      contactPoint: { x: 116, y: 112 },
      gridLanding: { x: 120, y: 112 },
    });
    expect(() =>
      pinAnchoredPlacement(document, fineResolver, instance, {
        pinName,
        position: { x: 120, y: 110 },
      }),
    ).toThrow("nearest reachable landing is (120, 112)");
    document.presentation.grid = 40;
    expect(
      pinAnchoredPlacement(document, fineResolver, instance, {
        pinName,
        position: { x: 140, y: 132 },
      }).position,
    ).toEqual({ x: 120, y: 120 });
  });

  it("rejects unknown pins without mutating or silently substituting another pin", () => {
    const document = createEmptyDocument("main", "Main");
    const instance: Instance = {
      id: "M",
      symbolId: "nmos",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    };
    expect(() =>
      pinAnchoredPlacement(document, resolver, instance, {
        pinName: "unknown",
        position: { x: 0, y: 0 },
      }),
    ).toThrow("M.unknown");
    expect(document.instances).toEqual([]);
  });

  it("uses dynamically resized signal-flow pins rather than the base artwork", () => {
    const symbol = builtInSymbols.find(
      (item) => item.formulaPresentation?.adaptiveFrame,
    )!;
    const pinName = symbol.pins[0]!.name;
    const document = createEmptyDocument("dynamic", "Dynamic");
    const instance: Instance = {
      id: "flow",
      symbolId: symbol.id,
      signalFlowParameters: { bodyWidth: 1000 },
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    };
    const anchor = { pinName, position: { x: 100, y: 100 } };
    const dynamic = pinAnchoredPlacement(document, resolver, instance, anchor);
    const base = pinAnchoredPlacement(
      document,
      resolver,
      { ...instance, signalFlowParameters: undefined },
      anchor,
    );
    expect(dynamic.position).not.toEqual(base.position);
    expect(
      resolveEndpointConnection(
        { ...document, instances: [{ ...instance, placement: dynamic }] },
        resolver,
        { kind: "terminal", instanceId: "flow", pinName },
      )?.gridLanding,
    ).toEqual(anchor.position);
  });
});
