import {
  resolveAnnotationPresentation,
  resolveDocumentStyleProfile,
  resolveDraftingObjectGeometry,
} from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  EDGE_ALIGNMENT_MODES,
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
  it.each(
    EDGE_ALIGNMENT_MODES.flatMap(({ mode }) =>
      [5, 10].map((grid) => [mode, grid] as const),
    ),
  )("aligns fine-positioned text %s with placement grid %s", (mode, grid) => {
    for (const kind of ["annotation", "drafting"] as const) {
      for (const anchored of [false, true]) {
        const document = fixture();
        const positions = [
          { x: 103, y: 112 },
          { x: 106, y: 115 },
          { x: 104, y: 114 },
        ];
        const labels = positions.map((position, index) => ({
          id: `text-${index}`,
          content: { runs: [{ kind: "text" as const, value: "X" }] },
          anchor: anchored
            ? {
                kind: "object" as const,
                objectId: "R1",
                localOffset: { x: position.x - 100, y: position.y - 100 },
                fallbackPosition: position,
              }
            : { kind: "free" as const, position },
          alignment: "middle" as const,
          rotation: 90 as const,
          locked: false,
        }));
        const selection = {
          ...EMPTY_VISUAL_SELECTION,
          annotationIds:
            kind === "annotation" ? labels.map(({ id }) => id) : [],
          draftingIds: kind === "drafting" ? labels.map(({ id }) => id) : [],
        };
        if (kind === "annotation") {
          document.annotations = labels.map((label) => ({
            ...label,
            kind: "instance-label",
          }));
        } else {
          document.drafting = {
            objects: labels.map((label) => ({
              ...label,
              kind: "text",
              zIndex: 0,
              typographyToken: "label",
            })),
          };
        }
        const initial = {
          ...context(document, selection),
          annotationGrid: grid,
        };
        const plan = planSelectionAlignment(initial, mode);
        expect(
          plan.edits.length,
          `${kind}, anchored=${anchored}`,
        ).toBeGreaterThan(0);
        const result = executeTransaction(
          document,
          {
            transactionId: "align-text",
            documentId: document.id,
            expectedRevision: document.revision,
            actor: { kind: "human", id: "test" },
            edits: plan.edits,
          },
          { symbolResolver: resolver },
        );
        expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
        if (!result.ok) throw new Error(result.error.message);
        const presentations =
          kind === "annotation"
            ? result.document.annotations.map((annotation) =>
                resolveAnnotationPresentation(
                  result.document,
                  resolver,
                  annotation,
                  initial.styleProfile,
                ),
              )
            : result.document.drafting!.objects.map((object) => {
                const geometry = resolveDraftingObjectGeometry(
                  result.document,
                  resolver,
                  object,
                );
                if (geometry.kind !== "text") throw new Error("Expected text");
                return geometry;
              });
        const horizontal = ["left", "h-center", "right"].includes(mode);
        // Identical rotated text has identical extents: all six edge/center
        // operations must converge while preserving the perpendicular axis.
        const aligned = presentations.map(({ bounds }) =>
          horizontal ? bounds.x : bounds.y,
        );
        expect(Math.max(...aligned) - Math.min(...aligned)).toBeCloseTo(0);
        expect(
          presentations.map(({ position }) =>
            horizontal ? position.y : position.x,
          ),
        ).toEqual(
          positions.map((position) => (horizontal ? position.y : position.x)),
        );
        expect(result.document.instances).toEqual(document.instances);
        expect(
          planSelectionAlignment(
            { ...initial, document: result.document },
            mode,
          ).edits,
        ).toEqual([]);
      }
    }
  });

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
