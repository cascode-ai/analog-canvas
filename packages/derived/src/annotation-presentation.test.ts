import { createEmptyDocument, flattenRichText } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  isSchematicAnnotationVisible,
  resolveAnnotationPresentation,
} from "./annotation-presentation.js";
import { resolveAnnotationText } from "./annotation-text.js";
import { resolveSchematicStyleProfile } from "./style-profile.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("annotation presentation", () => {
  it("uses a resolved object anchor for the visible glyph and bounds", () => {
    const document = createEmptyDocument("annotations", "Annotations");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const annotation = {
      id: "instance-label-R1",
      kind: "instance-label" as const,
      content: { runs: [{ kind: "text" as const, value: "R1" }] },
      anchor: {
        kind: "object" as const,
        objectId: "R1",
        localOffset: { x: 16, y: 8 },
        fallbackPosition: { x: 900, y: 900 },
      },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    document.annotations.push(annotation);
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );

    expect(
      resolveAnnotationPresentation(document, resolver, annotation, profile),
    ).toMatchObject({
      position: { x: 116, y: 108 },
      bounds: expect.objectContaining({ x: 116 }),
    });

    document.instances[0]!.placement!.position = { x: 140, y: 130 };
    expect(
      resolveAnnotationPresentation(document, resolver, annotation, profile),
    ).toMatchObject({ position: { x: 156, y: 138 } });
  });

  it("uses fallback only after its target disappears", () => {
    const document = createEmptyDocument("annotations", "Annotations");
    const annotation = {
      id: "orphan-label",
      kind: "instance-label" as const,
      content: { runs: [{ kind: "text" as const, value: "orphan" }] },
      anchor: {
        kind: "object" as const,
        objectId: "missing",
        localOffset: { x: 2, y: 3 },
        fallbackPosition: { x: 31, y: 41 },
      },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    expect(
      resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        resolveSchematicStyleProfile(document.presentation.styleProfileId),
      ),
    ).toMatchObject({
      position: { x: 31, y: 41 },
      anchor: { resolved: false },
    });
  });

  it("hides retained-instance labels and suppresses obsolete formal Port designators", () => {
    const document = createEmptyDocument("annotations", "Annotations");
    // A designated Instance, so this case turns on placement and formal-Port
    // status alone rather than on the empty-text rule below.
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: null,
    });
    const retainedLabel = {
      id: "instance-label-R1",
      kind: "instance-label" as const,
      binding: {
        kind: "instance-reference" as const,
        instanceId: "R1",
      },
      anchor: {
        kind: "object" as const,
        objectId: "R1",
        localOffset: { x: 16, y: 8 },
        fallbackPosition: { x: 900, y: 900 },
      },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    const obsoleteFormalDesignator = {
      ...retainedLabel,
      id: "designator-R1",
      binding: { kind: "instance-reference" as const, instanceId: "R1" },
    };
    expect(
      isSchematicAnnotationVisible(document, obsoleteFormalDesignator),
    ).toBe(false);
    expect(isSchematicAnnotationVisible(document, retainedLabel)).toBe(false);

    document.instances[0]!.placement = {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    };
    expect(isSchematicAnnotationVisible(document, retainedLabel)).toBe(true);

    document.netlist = {
      name: "Child",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-r1",
          name: "Vout",
          netId: "net-r1",
          direction: "output",
          interfaceInstanceIds: ["R1"],
        },
      ],
    };
    expect(isSchematicAnnotationVisible(document, retainedLabel)).toBe(false);
  });

  // An annotation whose resolved text is empty paints nothing, so a hit box
  // over it is a target nobody can see — the blank ghost that sits above a
  // drawing-only Symbol that has no reference designator to project.
  it("hides a bound label whose projected text resolves to nothing", () => {
    const document = createEmptyDocument("empty-text", "Empty text");
    document.instances.push({
      id: "S-anon",
      symbolId: "ideal-switch",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const designator = {
      id: "instance-label-S-anon",
      kind: "instance-label" as const,
      binding: { kind: "instance-reference" as const, instanceId: "S-anon" },
      anchor: {
        kind: "object" as const,
        objectId: "S-anon",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 100, y: 80 },
      },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    expect(
      flattenRichText(resolveAnnotationText(document, designator)).trim(),
    ).toBe("");
    expect(isSchematicAnnotationVisible(document, designator)).toBe(false);

    document.instances[0]!.reference = "S1";
    expect(isSchematicAnnotationVisible(document, designator)).toBe(true);
  });

  // Whitespace is not content either: a label of blank runs paints nothing.
  it("treats whitespace-only annotation content as empty", () => {
    const document = createEmptyDocument("blank-text", "Blank text");
    const blank = {
      id: "blank-label",
      kind: "instance-label" as const,
      content: { runs: [{ kind: "text" as const, value: "   " }] },
      anchor: { kind: "free" as const, position: { x: 10, y: 10 } },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    expect(isSchematicAnnotationVisible(document, blank)).toBe(false);
    expect(
      isSchematicAnnotationVisible(document, {
        ...blank,
        content: { runs: [{ kind: "text" as const, value: "note" }] },
      }),
    ).toBe(true);
  });
});
