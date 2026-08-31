import {
  resolveDocumentStyleProfile,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  planSelectionAlignment,
  type SelectionAlignmentContext,
} from "./align-selection";
import { EMPTY_VISUAL_SELECTION } from "./visual-selection";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function fixture() {
  const document = createEmptyDocument("doc", "Align");
  document.instances.push(
    {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
      reference: "R1",
      netlist: { parameters: {} },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: { position: { x: 240, y: 180 }, rotation: 0, mirror: "none" },
      reference: "R2",
      netlist: { parameters: {} },
    },
    {
      id: "R3",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 140 }, rotation: 0, mirror: "none" },
      reference: "R3",
      netlist: { parameters: {} },
    },
  );
  return document;
}

function context(
  document: SchematicDocument,
  selection: SelectionAlignmentContext["selection"],
): SelectionAlignmentContext {
  return {
    document,
    resolver,
    styleProfile: resolveDocumentStyleProfile(document.presentation),
    routeGeometryRecords: [],
    annotationGrid: 1,
    selection,
  };
}

describe("planSelectionAlignment", () => {
  it("keeps the established six-way instance alignment on ordinary moves", () => {
    const document = fixture();
    const plan = planSelectionAlignment(
      context(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R1", "R2", "R3"],
      }),
      "left",
    );
    expect(plan.participantCount).toBe(3);
    expect(plan.edits).toEqual([
      { kind: "move_instance", instanceId: "R2", position: { x: 100, y: 180 } },
      { kind: "move_instance", instanceId: "R3", position: { x: 100, y: 140 } },
    ]);
  });

  it("centers on the existing average and keeps every part move on the grid", () => {
    const document = fixture();
    const plan = planSelectionAlignment(
      context(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R1", "R2", "R3"],
      }),
      "v-center",
    );
    expect(plan.edits).toEqual([
      { kind: "move_instance", instanceId: "R1", position: { x: 100, y: 140 } },
      { kind: "move_instance", instanceId: "R2", position: { x: 240, y: 140 } },
    ]);
  });

  it("aligns a part and free drafting text in one plan", () => {
    const document = fixture();
    const text = {
      id: "note",
      kind: "text" as const,
      locked: false,
      zIndex: 0,
      anchor: { kind: "free" as const, position: { x: 320, y: 100 } },
      content: { runs: [{ kind: "text" as const, value: "BIAS" }] },
      alignment: "middle" as const,
      rotation: 0 as const,
      typographyToken: "label" as const,
    };
    document.drafting = { objects: [text] };
    const before = resolveDraftingObjectGeometry(document, resolver, text);
    const plan = planSelectionAlignment(
      context(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R1"],
        draftingIds: ["note"],
      }),
      "left",
    );
    expect(plan.participantCount).toBe(2);
    expect(plan.edits).toHaveLength(1);
    const edit = plan.edits[0];
    expect(edit?.kind).toBe("upsert_drafting_object");
    if (edit?.kind !== "upsert_drafting_object") return;
    expect(edit.object.kind).toBe("text");
    if (edit.object.kind !== "text" || edit.object.anchor.kind !== "free") {
      return;
    }
    expect(edit.object.anchor.position.x).toBeLessThan(before.bounds.x);
  });

  it("aligns a semantic annotation with a part through the normal annotation move", () => {
    const document = fixture();
    document.annotations.push({
      id: "note",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "input" }] },
      anchor: { kind: "free", position: { x: 360, y: 100 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const plan = planSelectionAlignment(
      context(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R1"],
        annotationIds: ["note"],
      }),
      "left",
    );
    expect(plan.participantCount).toBe(2);
    expect(plan.edits.map((edit) => edit.kind)).toEqual([
      "upsert_schematic_annotation",
    ]);
  });

  it("treats an object label selected with its host as a follower", () => {
    const document = fixture();
    document.annotations.push({
      id: "R1-label",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "R1" }] },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 100, y: 80 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const plan = planSelectionAlignment(
      context(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R1", "R2"],
        annotationIds: ["R1-label"],
      }),
      "left",
    );
    expect(plan.participantCount).toBe(2);
    expect(
      plan.edits.some((edit) => edit.kind === "upsert_schematic_annotation"),
    ).toBe(false);
  });

  it("rejects a locked text participant atomically", () => {
    const document = fixture();
    document.annotations.push({
      id: "locked-note",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "locked" }] },
      anchor: { kind: "free", position: { x: 360, y: 100 } },
      alignment: "middle",
      rotation: 0,
      locked: true,
    });
    const plan = planSelectionAlignment(
      context(document, {
        ...EMPTY_VISUAL_SELECTION,
        instanceIds: ["R1"],
        annotationIds: ["locked-note"],
      }),
      "left",
    );
    expect(plan.edits).toEqual([]);
    expect(plan.blockingMessage).toContain("locked-note");
  });
});
