import {
  createEmptyDocument,
  reflectOrientation,
  SchematicDocumentSchema,
} from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import {
  defaultInstanceLabelPlacement,
  defaultInstanceParameterLabelPlacement,
  defaultVddPowerLabelPlacement,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  followAttachedAnnotations,
  reflowCanonicalInstanceLabelsAfterPresentationChange,
} from "./transaction-instance-annotations.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function documentWithDraggedLabel(): {
  document: SchematicDocument;
  annotation: Annotation;
} {
  const document = createEmptyDocument("doc", "Labels");
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: { position: { x: 200, y: 100 }, rotation: 0, mirror: "none" },
    reference: "R_ESR",
    netlist: { parameters: {} },
  });
  const annotation: Annotation = {
    id: "label-r1",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "R1" },
    anchor: {
      kind: "object",
      objectId: "R1",
      // A user-dragged spot to the right of the body: intentionally NOT the
      // canonical default placement.
      localOffset: { x: 70, y: 5 },
      fallbackPosition: { x: 270, y: 105 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  };
  document.annotations.push(annotation);
  return { document, annotation };
}

describe("adaptive presentation label reflow", () => {
  function formulaDocument(userMoved = false): {
    document: SchematicDocument;
    annotation: Annotation;
  } {
    const document = createEmptyDocument("formula", "Formula");
    const instance: SchematicDocument["instances"][number] = {
      id: "B1",
      symbolId: "unit-delay",
      placement: {
        position: { x: 200, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      reference: "X1",
      netlist: { parameters: {} },
    };
    document.instances.push(instance);
    const resolved = resolver.resolve("unit-delay");
    if (!resolved) throw new Error("unit-delay missing");
    const canonical = defaultInstanceLabelPlacement(
      instance,
      resolved,
      resolveDocumentStyleProfile(document.presentation),
      document.presentation.grid,
      "reference",
    );
    if (!canonical || !instance.placement) throw new Error("placement missing");
    const position = userMoved
      ? { x: canonical.position.x + 50, y: canonical.position.y + 10 }
      : canonical.position;
    const annotation: Annotation = {
      id: "label-b1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "B1" },
      anchor: {
        kind: "object",
        objectId: "B1",
        localOffset: {
          x: position.x - instance.placement.position.x,
          y: position.y - instance.placement.position.y,
        },
        fallbackPosition: position,
      },
      alignment: userMoved ? "start" : canonical.alignment,
      rotation: 0,
      locked: false,
    };
    document.annotations.push(annotation);
    return { document, annotation };
  }

  it("moves a canonical label below an expanded frame", () => {
    const { document, annotation } = formulaDocument();
    const before = structuredClone(document.instances[0]!);
    document.instances[0]!.signalFlowParameters = { bodyHeight: 80 };
    const changed = new Set<string>();

    reflowCanonicalInstanceLabelsAfterPresentationChange(
      document,
      before,
      "B1",
      changed,
      resolver,
    );

    expect(annotation.anchor).toMatchObject({
      kind: "object",
      localOffset: { x: 0, y: 55 },
      fallbackPosition: { x: 200, y: 155 },
    });
    expect(annotation.alignment).toBe("middle");
    expect(changed).toContain("label-b1");
  });

  it("preserves a user-moved label when the frame expands", () => {
    const { document, annotation } = formulaDocument(true);
    const before = structuredClone(document.instances[0]!);
    const original = structuredClone(annotation);
    document.instances[0]!.signalFlowParameters = { bodyHeight: 80 };
    const changed = new Set<string>();

    reflowCanonicalInstanceLabelsAfterPresentationChange(
      document,
      before,
      "B1",
      changed,
      resolver,
    );

    expect(annotation).toEqual(original);
    expect(changed).not.toContain("label-b1");
  });
});

describe("followAttachedAnnotations rigid fallback", () => {
  it("flips start/end when a mirror flips the world x-axis", () => {
    const { document, annotation } = documentWithDraggedLabel();
    followAttachedAnnotations(
      document,
      "R1",
      { x: 200, y: 100 },
      { rotation: 0, mirror: "none" },
      { x: 200, y: 100 },
      { rotation: 0, mirror: "horizontal" },
      new Set(),
      resolver,
    );
    if (annotation.anchor.kind !== "object") throw new Error("anchor kind");
    // Anchor mirrors to the far side; the upright text now extends the
    // other way.
    expect(annotation.anchor.localOffset.x).toBe(-70);
    expect(annotation.alignment).toBe("end");
  });

  it("keeps the alignment through a quarter turn", () => {
    const { document, annotation } = documentWithDraggedLabel();
    followAttachedAnnotations(
      document,
      "R1",
      { x: 200, y: 100 },
      { rotation: 0, mirror: "none" },
      { x: 200, y: 100 },
      { rotation: 90, mirror: "none" },
      new Set(),
      resolver,
    );
    expect(annotation.alignment).toBe("start");
  });

  it("persists a user-moved label through a 45-degree turn", () => {
    const { document, annotation } = documentWithDraggedLabel();
    followAttachedAnnotations(
      document,
      "R1",
      { x: 200, y: 100 },
      { rotation: 0, mirror: "none" },
      { x: 200, y: 100 },
      { rotation: 45, mirror: "none" },
      new Set(),
      resolver,
    );
    if (annotation.anchor.kind !== "object") throw new Error("anchor kind");
    expect(annotation.anchor.localOffset).toEqual({ x: 46, y: 53 });
    expect(annotation.anchor.fallbackPosition).toEqual({ x: 246, y: 153 });
    expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("flips the alignment through a half turn", () => {
    const { document, annotation } = documentWithDraggedLabel();
    followAttachedAnnotations(
      document,
      "R1",
      { x: 200, y: 100 },
      { rotation: 0, mirror: "none" },
      { x: 200, y: 100 },
      { rotation: 180, mirror: "none" },
      new Set(),
      resolver,
    );
    expect(annotation.alignment).toBe("end");
  });
});

describe("attached text reflection", () => {
  const cases = [
    { symbolId: "nmos", kind: "instance-label" as const },
    { symbolId: "nmos", kind: "instance-value" as const },
    { symbolId: "resistor", kind: "instance-value" as const },
    { symbolId: "opamp", kind: "instance-label" as const },
    { symbolId: "port", kind: "instance-label" as const },
    { symbolId: "port-filled", kind: "instance-label" as const },
    { symbolId: "vdd-port", kind: "power-label" as const },
    { symbolId: "xfmr", kind: "instance-value" as const, parameter: "k" },
    { symbolId: "tcoil", kind: "instance-value" as const, parameter: "l1" },
  ];
  it.each(cases)(
    "reflects existing $symbolId $kind positions instead of choosing a new default side",
    ({ symbolId, kind, ...extra }) => {
      for (const rotation of [0, 45, 90] as const) {
        for (const direction of ["left-right", "top-bottom"] as const) {
          const document = createEmptyDocument("reflected", "Reflected labels");
          const instance = {
            id: "U1",
            symbolId,
            placement: {
              position: { x: 200, y: 100 },
              rotation,
              mirror: "none" as const,
            },
          };
          document.instances.push(instance);
          const resolved = resolver.resolve(symbolId)!;
          const profile = resolveDocumentStyleProfile(document.presentation);
          const parameter = "parameter" in extra ? extra.parameter : undefined;
          const initial = parameter
            ? defaultInstanceParameterLabelPlacement(
                instance,
                resolved,
                profile,
                10,
                parameter,
              )
            : kind === "power-label"
              ? defaultVddPowerLabelPlacement(instance, resolved, 10)
              : defaultInstanceLabelPlacement(
                  instance,
                  resolved,
                  profile,
                  10,
                  kind === "instance-value" ? "value" : "reference",
                );
          if (!initial) throw new Error(`Missing ${symbolId} label placement`);
          const annotation: Annotation = {
            id: kind === "power-label" ? "power-label-u1" : "label-u1",
            kind,
            ...(parameter
              ? {
                  binding: {
                    kind: "instance-value" as const,
                    instanceId: "U1",
                    parameter,
                  },
                }
              : symbolId.startsWith("port")
                ? {
                    binding: {
                      kind: "cell-terminal-name" as const,
                      terminalId: "cell-u1",
                    },
                  }
                : {
                    content: {
                      runs: [{ kind: "text" as const, value: "Label" }],
                    },
                  }),
            anchor: {
              kind: "object",
              objectId: "U1",
              localOffset: {
                x: initial.position.x - 200,
                y: initial.position.y - 100,
              },
              fallbackPosition: initial.position,
            },
            alignment: initial.alignment,
            rotation: 0,
            locked: false,
          };
          document.annotations.push(annotation);
          const before = structuredClone(annotation);
          const oldPosition = instance.placement.position;
          const oldOrientation = {
            rotation: instance.placement.rotation,
            mirror: instance.placement.mirror,
          };
          const newPosition = { x: 400, y: 300 };
          const newOrientation = reflectOrientation(oldOrientation, direction);
          document.instances[0]!.placement = {
            position: newPosition,
            ...newOrientation,
          };
          const changed = new Set<string>();
          followAttachedAnnotations(
            document,
            "U1",
            oldPosition,
            oldOrientation,
            newPosition,
            newOrientation,
            changed,
            resolver,
          );
          if (before.anchor.kind !== "object") throw new Error("anchor");
          const expectedOffset = {
            x:
              before.anchor.localOffset.x *
              (direction === "left-right" ? -1 : 1),
            y:
              before.anchor.localOffset.y *
              (direction === "top-bottom" ? -1 : 1),
          };
          expect(annotation.anchor).toEqual({
            kind: "object",
            objectId: "U1",
            localOffset: expectedOffset,
            fallbackPosition: {
              x: newPosition.x + expectedOffset.x,
              y: newPosition.y + expectedOffset.y,
            },
          });
          expect(annotation.alignment).toBe(
            direction === "left-right" && before.alignment !== "middle"
              ? before.alignment === "start"
                ? "end"
                : "start"
              : before.alignment,
          );
          expect(annotation.rotation).toBe(0);
          expect(annotation.binding).toEqual(before.binding);
          expect(changed).toContain(annotation.id);
          document.instances[0]!.placement = {
            position: oldPosition,
            ...oldOrientation,
          };
          followAttachedAnnotations(
            document,
            "U1",
            newPosition,
            newOrientation,
            oldPosition,
            oldOrientation,
            changed,
            resolver,
          );
          expect(annotation).toEqual(before);
        }
      }
    },
  );
});
