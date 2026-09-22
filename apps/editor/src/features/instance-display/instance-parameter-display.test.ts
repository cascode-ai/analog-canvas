import { describe, expect, it } from "vitest";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import {
  createEmptyDocument,
  flattenRichText,
  type Rotation,
  type SchematicDocument,
} from "@icm/model";
import { resolveAnnotationText } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  instanceParameterVisibility,
  instanceParameterVisibilityEdits,
} from "./instance-parameter-display";
import { copySelection, proposePaste } from "../clipboard/clipboard";
import {
  createTextEditingSession,
  proposeTextEditingCommit,
  resolveTextEditingTarget,
  updateTextEditingSession,
} from "../text-editing/text-editing";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture(symbolId = "xfmr") {
  const document = createEmptyDocument("main", "Magnetics");
  document.instances.push({
    id: "T1",
    symbolId,
    reference: "T1",
    netlist: {
      parameters:
        symbolId === "xfmr"
          ? { k: "0.8", lp: "2n", ls: "4n" }
          : { k: "0.9", l1: "2n", l2: "3n", cb: "1p" },
    },
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  return document;
}
function apply(document: SchematicDocument, edits: readonly SchematicEdit[]) {
  const result = executeTransaction(
    document,
    {
      transactionId: "parameter-display",
      documentId: document.id,
      actor: { kind: "human", id: "test" },
      expectedRevision: document.revision,
      edits: [...edits],
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.document;
}
function show(document: SchematicDocument, desired: Record<string, boolean>) {
  return apply(
    document,
    instanceParameterVisibilityEdits(
      document,
      document.instances[0]!,
      resolver,
      desired,
    ),
  );
}

describe("magnetic parameter display", () => {
  it.each(["xfmr", "tcoil"])(
    "edits a %s parameter from its label without detaching or replacing its other parameters",
    (symbolId) => {
      const winding = symbolId === "xfmr" ? "lp" : "l1";
      const windingLabel = symbolId === "xfmr" ? "Lp" : "L1";
      const document = show(fixture(symbolId), { [winding]: true });
      const annotation = document.annotations[0]!;
      const original = createTextEditingSession(
        { owner: "annotation", object: annotation },
        document,
      );
      expect(proposeTextEditingCommit(document, original)).toEqual({
        kind: "unchanged",
      });
      for (const value of [
        "4.5n",
        `${winding.toUpperCase()} = 4.5n`,
        `${winding} = {inductance * 2}`,
      ]) {
        const session = updateTextEditingSession(original, {
          content: { runs: [{ kind: "text", value }] },
        });
        const proposal = proposeTextEditingCommit(document, session);
        expect(proposal.kind).toBe("update");
        if (proposal.kind !== "update")
          throw new Error("Expected value update");
        const updated = apply(document, [
          ...(proposal.beforeEdits ?? []),
          proposal.edit,
        ]);
        expect(updated.instances[0]!.netlist).toEqual({
          ...document.instances[0]!.netlist,
          parameters: {
            ...document.instances[0]!.netlist!.parameters,
            [winding]: value.includes("{") ? "{inductance * 2}" : "4.5n",
          },
        });
        expect(updated.annotations[0]!.binding).toEqual(annotation.binding);
        expect(updated.annotations[0]!.content).toBeUndefined();
        expect(updated.annotations[0]!.anchor).toEqual(annotation.anchor);
      }
      const labelOnly = proposeTextEditingCommit(
        document,
        updateTextEditingSession(original, {
          content: {
            runs: [{ kind: "text", value: windingLabel }],
          },
        }),
      );
      expect(labelOnly.kind).toBe("update");
      if (labelOnly.kind !== "update") throw new Error(labelOnly.kind);
      const withoutValue = apply(document, [labelOnly.edit]);
      expect(withoutValue.instances[0]!.netlist).toEqual(
        document.instances[0]!.netlist,
      );
      expect(withoutValue.annotations[0]!.binding).toEqual({
        kind: "instance-value",
        instanceId: "T1",
        parameter: winding,
        showValue: false,
      });
      expect(
        flattenRichText(
          resolveAnnotationText(withoutValue, withoutValue.annotations[0]!),
        ),
      ).toBe(windingLabel);

      const restoredValue = proposeTextEditingCommit(
        withoutValue,
        updateTextEditingSession(
          createTextEditingSession(
            { owner: "annotation", object: withoutValue.annotations[0]! },
            withoutValue,
          ),
          { content: { runs: [{ kind: "text", value: "6n" }] } },
        ),
      );
      expect(restoredValue.kind).toBe("update");
      if (restoredValue.kind !== "update") throw new Error(restoredValue.kind);
      const withValue = apply(withoutValue, [
        ...(restoredValue.beforeEdits ?? []),
        restoredValue.edit,
      ]);
      expect(withValue.instances[0]!.netlist!.parameters[winding]).toBe("6n");
      expect(withValue.annotations[0]!.binding).toEqual(annotation.binding);

      const deletion = proposeTextEditingCommit(
        document,
        updateTextEditingSession(original, {
          content: { runs: [{ kind: "text", value: "" }] },
        }),
      );
      expect(deletion.kind).toBe("delete");
      if (deletion.kind !== "delete") throw new Error(deletion.kind);
      const hidden = apply(document, [deletion.edit]);
      expect(hidden.annotations).toHaveLength(0);
      expect(hidden.instances[0]!.netlist).toEqual(
        document.instances[0]!.netlist,
      );

      for (const value of [`${winding} =`, "other = 9n"]) {
        const proposal = proposeTextEditingCommit(
          document,
          updateTextEditingSession(original, {
            content: { runs: [{ kind: "text", value }] },
          }),
        );
        expect(proposal.kind).toBe("blocked");
      }
      expect(
        resolveTextEditingTarget(
          show(document, { [winding]: false }),
          original,
        ),
      ).toBeNull();
      expect(
        resolveTextEditingTarget({ ...document, annotations: [] }, original),
      ).toBeNull();
      const cleared = apply(document, [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "T1",
          unset: [winding],
        },
      ]);
      expect(resolveTextEditingTarget(cleared, original)).toBeNull();
    },
  );

  it.each(["xfmr", "tcoil"])(
    "independently toggles K and winding labels on %s without changing electrical parameters",
    (symbolId) => {
      const before = fixture(symbolId);
      const winding = symbolId === "xfmr" ? "lp" : "l1";
      let document = show(before, { k: true });
      expect(document.instances).toEqual(before.instances);
      expect(document.annotations).toHaveLength(1);
      expect(
        flattenRichText(
          resolveAnnotationText(document, document.annotations[0]!),
        ),
      ).toBe(symbolId === "xfmr" ? "K = 0.8" : "K = 0.9");
      document = show(document, { k: false, [winding]: true });
      expect(
        instanceParameterVisibility(document, document.instances[0]!),
      ).toMatchObject({ k: false, [winding]: true });
      document = show(document, { k: true });
      expect(
        instanceParameterVisibility(document, document.instances[0]!),
      ).toMatchObject({ k: true, [winding]: true });
      expect(document.annotations).toHaveLength(2);
    },
  );
  it("preserves dragged placement and styling when hiding and showing", () => {
    let document = show(fixture(), { k: true });
    const annotation = document.annotations[0]!;
    annotation.anchor = {
      kind: "object",
      objectId: "T1",
      localOffset: { x: -70, y: 35 },
      fallbackPosition: { x: 30, y: 135 },
    };
    annotation.textColor = "#dc2626";
    annotation.sizeScale = 1.2;
    document = show(show(document, { k: false }), { k: true });
    expect(document.annotations).toEqual([annotation]);
  });
  it("updates live text, hides cleared values and rejects showing an empty parameter", () => {
    let document = show(fixture(), { k: true, lp: true });
    document = apply(document, [
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "T1",
        set: { k: "0.73", lp: "L_PRIMARY" },
      },
    ]);
    expect(
      document.annotations.map((annotation) =>
        flattenRichText(resolveAnnotationText(document, annotation)),
      ),
    ).toEqual(["K = 0.73", "Lp = L_PRIMARY"]);
    document = apply(document, [
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: "T1",
        unset: ["k"],
      },
    ]);
    expect(
      instanceParameterVisibility(document, document.instances[0]!),
    ).toMatchObject({ k: false, lp: true });
    expect(() => show(document, { k: true })).toThrow("Set K");
  });
  it.each(["xfmr", "tcoil"])(
    "keeps %s parameter rows readable and reflects the whole column",
    (symbolId) => {
      for (const rotation of [
        0, 45, 90, 135, 180, 225, 270, 315,
      ] as Rotation[]) {
        const initial = show(
          fixture(symbolId),
          symbolId === "xfmr"
            ? { k: true, lp: true, ls: true }
            : { k: true, l1: true, l2: true, cb: true },
        );
        const rotated = apply(initial, [
          { kind: "rotate_instance", instanceId: "T1", rotation },
        ]);
        const originalPositions = rotated.annotations.map((annotation) => {
          expect(annotation.rotation).toBe(0);
          expect(annotation.alignment).toBe("start");
          if (annotation.anchor.kind !== "object") throw new Error("anchor");
          return annotation.anchor.fallbackPosition;
        });
        for (let i = 1; i < originalPositions.length; i++) {
          expect(
            originalPositions[i]!.y - originalPositions[i - 1]!.y,
          ).toBeGreaterThanOrEqual(20);
        }
        for (const mirror of ["horizontal", "vertical", "both"] as const) {
          const mirrored = apply(rotated, [
            { kind: "mirror_instance", instanceId: "T1", mirror },
          ]);
          mirrored.annotations.forEach((annotation, index) => {
            const before = originalPositions[index]!;
            const horizontal = mirror === "horizontal" || mirror === "both";
            const vertical = mirror === "vertical" || mirror === "both";
            expect(annotation).toMatchObject({
              rotation: 0,
              alignment: horizontal ? "end" : "start",
              anchor: {
                fallbackPosition: {
                  x: horizontal ? 200 - before.x : before.x,
                  y: vertical ? 200 - before.y : before.y,
                },
              },
            });
            expect(resolveAnnotationText(mirrored, annotation)).toEqual(
              resolveAnnotationText(rotated, rotated.annotations[index]!),
            );
          });
          const restored = apply(mirrored, [
            { kind: "mirror_instance", instanceId: "T1", mirror: "none" },
          ]);
          expect(restored.annotations).toEqual(rotated.annotations);
        }
      }
    },
  );
  it("lets a user-placed parameter follow its own attachment through rotation", () => {
    let document = show(fixture(), { k: true });
    document.annotations[0]!.anchor = {
      kind: "object",
      objectId: "T1",
      localOffset: { x: 100, y: 50 },
      fallbackPosition: { x: 200, y: 150 },
    };
    document = apply(document, [
      { kind: "rotate_instance", instanceId: "T1", rotation: 180 },
    ]);
    expect(document.annotations[0]).toMatchObject({
      rotation: 0,
      alignment: "end",
      anchor: {
        localOffset: { x: -100, y: -50 },
        fallbackPosition: { x: 0, y: 50 },
      },
    });
  });
  it("copies parameter ownership without replacing selectors or hidden labels", () => {
    let document = show(fixture(), { k: true, lp: true });
    document = show(document, { lp: false });
    const clipboard = copySelection(document, ["T1"]);
    if (!clipboard) throw new Error("missing clipboard");
    const pasted = proposePaste(document, clipboard, { x: 400, y: 200 }, 1);
    document = apply(document, pasted.edits);
    const copy = document.instances.find((instance) => instance.id !== "T1")!;
    expect(instanceParameterVisibility(document, copy)).toMatchObject({
      k: true,
      lp: false,
    });
    document = apply(document, [
      {
        kind: "patch_instance_netlist_parameters",
        instanceId: copy.id,
        set: { k: "0.6" },
      },
    ]);
    const labels = document.annotations.filter(
      (annotation) =>
        annotation.binding?.kind === "instance-value" &&
        annotation.binding.parameter === "k",
    );
    expect(
      labels.map((annotation) =>
        flattenRichText(resolveAnnotationText(document, annotation)),
      ),
    ).toEqual(["K = 0.8", "K = 0.6"]);
  });
});
