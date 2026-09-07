import { describe, expect, it } from "vitest";

import {
  createEmptyProject,
  type Annotation,
  type DraftingObject,
} from "@icm/model";

import {
  DEFAULT_SELECTION_FILTER,
  NO_SELECTION_FILTER,
  selectionClassForAnnotation,
  selectionClassForDrafting,
  selectionFilterSummary,
  selectionForDocument,
} from "./selection-filter";

const anchor = { kind: "free" as const, position: { x: 0, y: 0 } };
const content = { runs: [{ kind: "text" as const, value: "text" }] };

describe("selection filter", () => {
  it("classifies electrical text by semantic owner", () => {
    const annotations: Annotation[] = [
      {
        id: "name",
        kind: "instance-label",
        binding: { kind: "instance-reference", instanceId: "R1" },
        anchor,
        alignment: "start",
        rotation: 0,
        locked: false,
      },
      {
        id: "value",
        kind: "instance-value",
        content,
        anchor,
        alignment: "start",
        rotation: 0,
        locked: false,
      },
      {
        id: "pin-name",
        kind: "instance-label",
        binding: { kind: "cell-terminal-name", terminalId: "pin-1" },
        anchor,
        alignment: "start",
        rotation: 0,
        locked: false,
      },
      {
        id: "net-name",
        kind: "net-label",
        binding: { kind: "net-name", netId: "net-1" },
        netId: "net-1",
        anchor,
        alignment: "start",
        rotation: 0,
        locked: false,
      },
      {
        id: "marker",
        kind: "route-marker",
        markerKind: "current",
        content,
        anchor,
        alignment: "start",
        rotation: 0,
        locked: false,
      },
    ];
    expect(annotations.map(selectionClassForAnnotation)).toEqual([
      "instance-name",
      "instance-value",
      "pin-name",
      "net-name",
      "route-marker",
    ]);
  });

  it("classifies drafting text, paths, and shapes", () => {
    const base = { id: "d", locked: false, zIndex: 0, anchor };
    const objects = [
      {
        ...base,
        kind: "text",
        content,
        alignment: "start",
        rotation: 0,
      },
      { ...base, kind: "arrow", from: anchor, to: anchor },
      {
        ...base,
        kind: "rectangle",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        rotation: 0,
        lineStyle: "solid",
      },
    ] as DraftingObject[];
    expect(objects.map(selectionClassForDrafting)).toEqual([
      "drafting-text",
      "drafting-line",
      "drafting-shape",
    ]);
  });

  it("collects only enabled object families for Select All", () => {
    const document = createEmptyProject("p", "P").documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.annotations.push({
      id: "value",
      kind: "instance-value",
      content,
      anchor,
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const wiresOnly = { ...NO_SELECTION_FILTER, route: true };
    expect(selectionForDocument(document, wiresOnly)).toEqual({
      instanceIds: [],
      routeIds: [],
      junctionIds: [],
      annotationIds: [],
      draftingIds: [],
    });
    expect(
      selectionForDocument(document, DEFAULT_SELECTION_FILTER).instanceIds,
    ).toEqual(["R1"]);
  });

  it("summarizes only non-default filters", () => {
    expect(selectionFilterSummary(DEFAULT_SELECTION_FILTER)).toBeNull();
    expect(selectionFilterSummary(NO_SELECTION_FILTER)).toBe("Filter: None");
    expect(
      selectionFilterSummary({ ...NO_SELECTION_FILTER, route: true }),
    ).toBe("Filter: Wires");
  });
});
