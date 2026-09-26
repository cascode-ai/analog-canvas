import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument, StyleOverrides } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildSvgScene } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** A branch with a label, a No Connect mark and two drawing objects. */
function circuit(): SchematicDocument {
  const document = createEmptyDocument("doc", "Kept style");
  document.instances.push(
    {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 260, y: 220 }, rotation: 90, mirror: "none" },
      reference: "R1",
      netlist: { parameters: {} },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: { position: { x: 420, y: 400 }, rotation: 0, mirror: "none" },
      reference: "R2",
      netlist: { parameters: {} },
    },
    {
      id: "R3",
      symbolId: "resistor",
      placement: { position: { x: 580, y: 400 }, rotation: 0, mirror: "none" },
      reference: "R3",
      netlist: { parameters: {} },
    },
  );
  document.nets.push({
    id: "net-t",
    terminals: [
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
      { instanceId: "R3", pinName: "1" },
    ],
  });
  document.junctions.push({
    id: "J1",
    netId: "net-t",
    position: { x: 420, y: 240 },
    role: "branch",
  });
  const route = (id: string, start: string, end: [string, string]) =>
    createRoutePath({
      id,
      netId: "net-t",
      start:
        start === "J1"
          ? { kind: "junction", junctionId: "J1" }
          : { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "terminal", instanceId: end[0], pinName: end[1] },
      bends: id === "r-right" ? [{ x: 580, y: 240 }] : [],
      modes: id === "r-right" ? ["manual", "manual"] : ["manual"],
    });
  document.routes.push(
    createRoutePath({
      id: "r-left",
      netId: "net-t",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "junction", junctionId: "J1" },
      bends: [],
      modes: ["manual"],
    }),
    route("r-tap", "J1", ["R2", "1"]),
    route("r-right", "J1", ["R3", "1"]),
  );
  document.annotations.push({
    id: "label-R1",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "R1" },
    anchor: {
      kind: "object",
      objectId: "R1",
      localOffset: { x: 20, y: 0 },
      fallbackPosition: { x: 280, y: 220 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  document.noConnects.push({
    id: "nc-R2",
    endpoint: { kind: "terminal", instanceId: "R2", pinName: "2" },
  });
  document.drafting = {
    objects: [
      {
        id: "note",
        kind: "text",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 120, y: 100 } },
        alignment: "start",
        rotation: 0,
        content: { runs: [{ kind: "text", value: "Gain" }] },
      },
      {
        id: "box",
        kind: "rectangle",
        locked: false,
        zIndex: 1,
        anchor: { kind: "free", position: { x: 100, y: 60 } },
        center: { x: 200, y: 100 },
        width: 200,
        height: 80,
        rotation: 0,
        lineStyle: "solid",
      },
    ],
  };
  return document;
}

const sourceStyle: StyleOverrides = {
  fontScale: 2,
  wireStrokeScale: 1.5,
  symbolStrokeScale: 1.25,
  annotationStrokeScale: 1.5,
  junctionRadiusScale: 1.3,
};

/** Every drawn object of `document`, keeping `style` unless skipped. */
function keepEverywhere(
  document: SchematicDocument,
  style: StyleOverrides,
  skip: ReadonlySet<string> = new Set(),
): SchematicDocument {
  for (const object of [
    ...document.instances,
    ...document.routes,
    ...document.junctions,
    ...document.annotations,
    ...document.noConnects,
    ...(document.drafting?.objects ?? []),
  ])
    if (!skip.has(object.id)) object.documentStyle = structuredClone(style);
  return document;
}

function styled(style?: StyleOverrides): SchematicDocument {
  const document = circuit();
  if (style) document.presentation.styleOverrides = style;
  return document;
}

describe("a kept Document style", () => {
  it("draws every kind of object exactly as its source drawing did", () => {
    const source = buildSvgScene(styled(sourceStyle), resolver);
    const copy = keepEverywhere(styled(), sourceStyle);
    expect(buildSvgScene(copy, resolver)).toEqual(source);
    // A plain source pasted into a styled drawing keeps the plain look.
    const plainCopy = keepEverywhere(styled({ fontScale: 2 }), {});
    expect(buildSvgScene(plainCopy, resolver)).toEqual(
      buildSvgScene(styled(), resolver),
    );
  });

  it("draws a Junction without its own style like the Routes it joins", () => {
    const copy = keepEverywhere(styled(), sourceStyle, new Set(["J1"]));
    expect(buildSvgScene(copy, resolver)).toEqual(
      buildSvgScene(styled(sourceStyle), resolver),
    );
  });

  it("leaves objects without a kept style drawn like their Document", () => {
    const copy = keepEverywhere(styled(), sourceStyle, new Set(["R3"]));
    const body = buildSvgScene(copy, resolver).formalBody;
    const symbolStroke = (id: string) =>
      body.match(
        new RegExp(
          `<g data-object-id="${id}"[^>]*><g transform="[^"]*"><g fill="none" stroke="#000" stroke-width="([^"]+)"`,
          "u",
        ),
      )?.[1];
    expect(symbolStroke("R3")).toBe("1.6");
    expect(symbolStroke("R2")).toBe(String(1.6 * 1.25));
  });
});
