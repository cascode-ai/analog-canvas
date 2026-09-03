import { describe, expect, it } from "vitest";

import type { CanvasHit, CanvasHitKind } from "./canvas-hit-resolver";
import {
  resolvePointerDownAction,
  type PointerDownFacts,
} from "./pointer-down-router";

const hitOf = (kind: CanvasHitKind, id: string): CanvasHit => ({
  kind,
  id,
  selected: false,
  element: { tagName: kind } as unknown as Element,
});

const facts = (
  overrides: Partial<PointerDownFacts> = {},
): PointerDownFacts => ({
  button: 0,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  tool: "pointer",
  interactionKind: "idle",
  placementOwnsCanvas: false,
  cellSymbolLayoutTarget: false,
  handleAtPoint: false,
  hit: hitOf("instance", "R1"),
  compositeSelectionOwnsHit: false,
  compositeMovePlanHasPreview: false,
  primaryInstanceId: null,
  armedVerbConsumesHit: false,
  simulationPickNetsActive: false,
  ...overrides,
});

describe("who owns one press on the canvas", () => {
  it("hands each hit kind to the domain that owns it", () => {
    expect(resolvePointerDownAction(facts())).toEqual({
      kind: "begin-instance-move",
      instanceId: "R1",
    });
    expect(
      resolvePointerDownAction(facts({ hit: hitOf("route", "route-1") })),
    ).toEqual({ kind: "route-pointer-down", routeId: "route-1" });
    expect(
      resolvePointerDownAction(facts({ hit: hitOf("annotation", "a1") })),
    ).toEqual({ kind: "begin-annotation-drag", annotationId: "a1" });
    expect(
      resolvePointerDownAction(facts({ hit: hitOf("drafting", "d1") })),
    ).toEqual({ kind: "begin-drafting-drag", draftingId: "d1" });
    expect(
      resolvePointerDownAction(facts({ hit: hitOf("junction", "j1") })),
    ).toEqual({ kind: "select-junction", junctionId: "j1" });
  });

  it("reads a press as a Net pick while the Simulation panel is picking", () => {
    // A conductor, a Junction, or a Net label names a Net. A part does not,
    // and nothing is selected, moved, or handed to an armed verb meanwhile.
    // The label case is the one that was lost when its element handler went.
    const picking = {
      simulationPickNetsActive: true,
      armedVerbConsumesHit: true,
    };
    expect(
      resolvePointerDownAction(
        facts({ ...picking, hit: hitOf("annotation", "label-1") }),
      ),
    ).toEqual({
      kind: "simulation-pick",
      hitKind: "annotation",
      id: "label-1",
    });
    expect(
      resolvePointerDownAction(
        facts({ ...picking, hit: hitOf("route", "route-1") }),
      ),
    ).toEqual({ kind: "simulation-pick", hitKind: "route", id: "route-1" });
    expect(
      resolvePointerDownAction(
        facts({ ...picking, hit: hitOf("junction", "j1") }),
      ),
    ).toEqual({ kind: "simulation-pick", hitKind: "junction", id: "j1" });
    expect(resolvePointerDownAction(facts({ ...picking })).kind).toBe("ignore");
    expect(
      resolvePointerDownAction(facts({ ...picking, hit: null })).kind,
    ).toBe("ignore");
  });

  it("gives an Instance label no press of its own", () => {
    // The label is drawn by its owner; pressing it selects through the
    // Instance, never through a drag the label starts itself.
    const action = resolvePointerDownAction(
      facts({ hit: hitOf("instance-label", "R1") }),
    );
    expect(action.kind).toBe("ignore");
  });

  it("lets placement, empty space, and the layout overlay pass", () => {
    expect(
      resolvePointerDownAction(facts({ placementOwnsCanvas: true })).kind,
    ).toBe("ignore");
    expect(resolvePointerDownAction(facts({ hit: null })).kind).toBe("ignore");
    expect(
      resolvePointerDownAction(facts({ cellSymbolLayoutTarget: true })).kind,
    ).toBe("ignore");
  });

  it("keeps handles ahead of the scene", () => {
    // A route handle can sit under a Junction circle, and the buried-wire
    // span exists exactly because a symbol covers the wire.
    expect(resolvePointerDownAction(facts({ handleAtPoint: true }))).toEqual({
      kind: "handle-passthrough",
    });
    expect(
      resolvePointerDownAction(facts({ hit: hitOf("handle", "h1") })),
    ).toEqual({ kind: "handle-passthrough" });
  });

  it("leaves every drawing-tool press to the tool", () => {
    // Drawing reads the whole gesture: where the press lands, whether it
    // continues or finishes a wire, and which junctions that implies. This
    // router speaks for the pointer tool, so a drawing press passes through
    // to its target untouched — including an endpoint circle, which is how
    // a wire starts from a pin and which carries no hit kind at all.
    for (const hit of [
      hitOf("route", "route-1"),
      hitOf("junction", "j1"),
      hitOf("instance", "R1"),
      null,
    ]) {
      expect(resolvePointerDownAction(facts({ tool: "wire", hit }))).toEqual({
        kind: "gesture-passthrough",
      });
    }
  });

  it("gives the middle button and the drawing tools to the gesture layer", () => {
    // One rule, one place: the middle press pans and cycles the wire corner
    // on release. It used to be written here and in the wire controller.
    expect(resolvePointerDownAction(facts({ button: 1 }))).toEqual({
      kind: "gesture-passthrough",
    });
    expect(
      resolvePointerDownAction(facts({ button: 1, tool: "wire" })),
    ).toEqual({ kind: "gesture-passthrough" });
    expect(resolvePointerDownAction(facts({ tool: "wire" })).kind).toBe(
      "gesture-passthrough",
    );
    expect(resolvePointerDownAction(facts({ button: 2 })).kind).toBe(
      "gesture-passthrough",
    );
  });

  it("commits a move already in flight wherever the press lands", () => {
    expect(
      resolvePointerDownAction(
        facts({ interactionKind: "moving-selection", primaryInstanceId: "R2" }),
      ),
    ).toEqual({ kind: "begin-instance-move", instanceId: "R2" });
    expect(
      resolvePointerDownAction(
        facts({ interactionKind: "moving-selection", hit: null }),
      ),
    ).toEqual({ kind: "begin-visual-selection-move" });
  });

  it("moves a composite selection as one body on a plain press", () => {
    const composite = {
      hit: hitOf("route", "route-1"),
      compositeSelectionOwnsHit: true,
      compositeMovePlanHasPreview: true,
    };
    expect(
      resolvePointerDownAction(
        facts({ ...composite, primaryInstanceId: "R1" }),
      ),
    ).toEqual({ kind: "begin-instance-move", instanceId: "R1" });
    // A marquee of wires and junctions alone still moves as one body.
    expect(resolvePointerDownAction(facts(composite))).toEqual({
      kind: "begin-visual-selection-move",
    });
  });

  it("lets a modifier compose the selection instead of moving it", () => {
    for (const modifier of ["shiftKey", "ctrlKey", "metaKey"] as const) {
      const action = resolvePointerDownAction(
        facts({
          [modifier]: true,
          hit: hitOf("route", "route-1"),
          compositeSelectionOwnsHit: true,
          compositeMovePlanHasPreview: true,
          primaryInstanceId: "R1",
        }),
      );
      // The hit answers for itself, so the press can add or remove it.
      expect(action, modifier).toEqual({
        kind: "route-pointer-down",
        routeId: "route-1",
      });
    }
  });

  it("falls through to the hit when the composite move has nothing to show", () => {
    expect(
      resolvePointerDownAction(
        facts({
          hit: hitOf("route", "route-1"),
          compositeSelectionOwnsHit: true,
          compositeMovePlanHasPreview: false,
        }),
      ),
    ).toEqual({ kind: "route-pointer-down", routeId: "route-1" });
  });

  it("gives an armed verb the press before any drag starts", () => {
    expect(
      resolvePointerDownAction(
        facts({ armedVerbConsumesHit: true, hit: hitOf("route", "route-1") }),
      ),
    ).toEqual({ kind: "consume-armed-verb", hitKind: "route", id: "route-1" });
    // Even inside a composite selection the verb still owns the press.
    expect(
      resolvePointerDownAction(
        facts({
          armedVerbConsumesHit: true,
          compositeSelectionOwnsHit: true,
          compositeMovePlanHasPreview: true,
          primaryInstanceId: "R1",
        }),
      ).kind,
    ).toBe("consume-armed-verb");
  });
});
