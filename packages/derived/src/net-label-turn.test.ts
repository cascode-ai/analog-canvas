import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { Annotation, Point, Rect } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { resolveAnnotationPresentation } from "./annotation-presentation.js";
import {
  netLabelDirection,
  netLabelStandardOffset,
  nextNetLabelDirection,
  turnedNetLabel,
  type NetLabelDirection,
} from "./net-label-turn.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import { resolveDocumentStyleProfile } from "./style-profile.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** One wire from `from` to `to` and a Net Label at its middle, in the look
 * a new label takes today: above a horizontal wire, right of a vertical one,
 * reading to the right. */
function labelledWire(from: Point, to: Point) {
  const document = createEmptyDocument("d", "Turns");
  document.nets.push({ id: "n", terminals: [] });
  document.junctions.push(
    { id: "a", netId: "n", position: from },
    { id: "b", netId: "n", position: to },
  );
  document.routes.push(
    createRoutePath({
      id: "w",
      netId: "n",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
  );
  const geometry = resolveDocumentRoutingGeometry(
    document,
    resolver,
  ).routes.get("w")!;
  const legId = geometry.segments[0]!.address.legId;
  const label: Annotation = {
    id: "label",
    kind: "net-label",
    content: { runs: [{ kind: "text", value: "VOUT" }] },
    anchor: {
      kind: "route",
      routeId: "w",
      legId,
      t: 0.5,
      direction: "forward",
      normalOffset: netLabelStandardOffset(from, to),
      orientation: "follow",
      fallbackPosition: { x: 0, y: 0 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  };
  document.annotations.push(label);
  return { document, geometry };
}

function ink(
  document: ReturnType<typeof createEmptyDocument>,
  label: Annotation,
): Rect {
  return resolveAnnotationPresentation(
    { ...document, annotations: [label] },
    resolver,
    label,
    resolveDocumentStyleProfile(document.presentation),
  ).inkBounds;
}

/** Clear space between the text and the wire it sits on (negative: across). */
function gapToWire(box: Rect, from: Point, to: Point): number {
  if (from.y === to.y) {
    const y = from.y;
    return Math.max(box.y - y, y - (box.y + box.height));
  }
  const x = from.x;
  return Math.max(box.x - x, x - (box.x + box.width));
}

/** Which way the text runs from the middle of the wire. */
function runs(box: Rect, at: Point): NetLabelDirection {
  const dx = box.x + box.width / 2 - at.x;
  const dy = box.y + box.height / 2 - at.y;
  // Along a wire the text stands beside it, so the larger extent decides.
  if (box.width >= box.height) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

describe("turning a Net Label with R", () => {
  it("turns a quarter clockwise each time and comes back after four", () => {
    const order: NetLabelDirection[] = ["right"];
    for (let index = 0; index < 4; index += 1)
      order.push(nextNetLabelDirection(order.at(-1)!));
    expect(order).toEqual(["right", "down", "left", "up", "right"]);
    expect(netLabelDirection({ rotation: 0, alignment: "middle" })).toBe(
      "right",
    );
  });

  it.each([
    [
      "a horizontal wire drawn left to right",
      { x: 100, y: 200 },
      { x: 300, y: 200 },
    ],
    [
      "a horizontal wire drawn right to left",
      { x: 300, y: 200 },
      { x: 100, y: 200 },
    ],
    ["a vertical wire drawn downward", { x: 200, y: 100 }, { x: 200, y: 300 }],
    ["a vertical wire drawn upward", { x: 200, y: 300 }, { x: 200, y: 100 }],
  ])("keeps a decent gap and never crosses %s", (_name, from, to) => {
    const { document, geometry } = labelledWire(from, to);
    const profile = resolveDocumentStyleProfile(document.presentation);
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    let label = document.annotations[0]!;
    const seen: NetLabelDirection[] = [];
    for (let turn = 0; turn <= 4; turn += 1) {
      const box = ink(document, label);
      const gap = gapToWire(box, from, to);
      // Not across or touching the wire, and not drifting away from it.
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(12);
      const direction = netLabelDirection(label);
      seen.push(direction);
      expect(runs(box, middle)).toBe(direction);
      label = turnedNetLabel(label, () => geometry, profile)!;
      expect(label).not.toBeNull();
    }
    expect(seen).toEqual(["right", "down", "left", "up", "right"]);
  });

  it("turns a label dragged off its wire where it is", () => {
    const { document } = labelledWire({ x: 100, y: 200 }, { x: 300, y: 200 });
    const profile = resolveDocumentStyleProfile(document.presentation);
    const free: Annotation = {
      ...document.annotations[0]!,
      anchor: { kind: "free", position: { x: 50, y: 50 } },
    };
    const turned = turnedNetLabel(free, () => undefined, profile)!;
    expect(turned.anchor).toEqual(free.anchor);
    expect([turned.rotation, turned.alignment]).toEqual([270, "end"]);
  });
});
