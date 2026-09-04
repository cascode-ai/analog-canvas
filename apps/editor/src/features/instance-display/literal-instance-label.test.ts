import {
  defaultInstanceLabelPlacement,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import {
  createEmptyDocument,
  defaultDraftTextDocument,
  flattenRichText,
} from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { defaultInstanceLabel } from "../wiring/route-interaction-geometry";
import {
  literalInstanceLabelFor,
  literalInstanceLabelText,
  literalLabelFromReferenceEdit,
  planLiteralInstanceLabel,
  referencePrefixConflict,
} from "./literal-instance-label";

const resolver = new InMemorySymbolResolver(builtInSymbols);

type Instance = SchematicDocument["instances"][number];

function resistor(placed = true): Instance {
  return {
    id: "R1",
    symbolId: "resistor",
    placement: placed
      ? { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" }
      : null,
    reference: "R1",
    netlist: {
      parameters: { value: "10k" },
      binding: { kind: "primitive", deviceClass: "resistor" },
    },
  };
}

function documentWith(instance: Instance): SchematicDocument {
  const document = createEmptyDocument("main", "Main");
  document.instances.push(instance);
  return document;
}

function referenceLabel(
  document: SchematicDocument,
  instance: Instance,
): Annotation {
  const label = defaultInstanceLabel(
    document,
    instance,
    resolver,
    resolveDocumentStyleProfile(document.presentation),
  );
  if (!label) throw new Error("the resistor has a default Reference label");
  return label;
}

function slot(
  document: SchematicDocument,
  instance: Instance,
  which: "reference" | "value",
) {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) throw new Error("resistor symbol");
  const placement = defaultInstanceLabelPlacement(
    instance,
    resolved,
    resolveDocumentStyleProfile(document.presentation),
    document.presentation.grid,
    which,
  );
  if (!placement) throw new Error(`${which} slot`);
  return placement;
}

describe("referencePrefixConflict", () => {
  it("names the prefix a resistor Reference has to keep", () => {
    expect(referencePrefixConflict(resistor(), "gm")).toEqual({ prefix: "R" });
    expect(referencePrefixConflict(resistor(), " g_m ")).toEqual({
      prefix: "R",
    });
  });

  it("accepts any spelling that keeps the prefix, and says nothing about empty text", () => {
    expect(referencePrefixConflict(resistor(), "r7")).toBeNull();
    expect(referencePrefixConflict(resistor(), "Rload")).toBeNull();
    expect(referencePrefixConflict(resistor(), "   ")).toBeNull();
  });

  it("follows the hierarchy prefix for a subcircuit call and has no opinion without a policy", () => {
    const call: Instance = {
      ...resistor(),
      id: "X1",
      reference: "X1",
      netlist: {
        parameters: {},
        binding: { kind: "external-subcircuit", definitionId: "opamp-1" },
      },
    };
    expect(referencePrefixConflict(call, "U1")).toEqual({ prefix: "X" });
    const block: Instance = {
      id: "adder-1",
      symbolId: "adder",
      placement: null,
    };
    expect(referencePrefixConflict(block, "anything")).toBeNull();
  });
});

describe("literalLabelFromReferenceEdit", () => {
  it("hides the Reference projection where it stands and puts the typed text in its place", () => {
    const instance = resistor();
    const document = documentWith(instance);
    const source: Annotation = {
      ...referenceLabel(document, instance),
      sizeScale: 1.4,
      textColor: "#aa0000",
    };
    const content = {
      runs: [
        { kind: "text" as const, value: "g" },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "m" }],
        },
      ],
    };
    const conversion = literalLabelFromReferenceEdit({
      source,
      content,
      sizeScale: 1.2,
      alignment: "end",
      id: "instance-text-7",
    });
    expect(conversion).not.toBeNull();
    expect(conversion!.edits).toEqual([
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...source, visible: false },
      },
      {
        kind: "upsert_schematic_annotation",
        annotation: conversion!.label,
      },
    ]);
    expect(conversion!.label).toEqual({
      id: "instance-text-7",
      kind: "instance-label",
      content,
      anchor: source.anchor,
      alignment: "end",
      rotation: source.rotation,
      locked: false,
      sizeScale: 1.2,
      textColor: "#aa0000",
    });
    // Free text, not a projection: the model keeps the two apart.
    expect(conversion!.label.binding).toBeUndefined();
  });

  it("converts only a Reference projection with something to say", () => {
    const instance = resistor();
    const document = documentWith(instance);
    const source = referenceLabel(document, instance);
    expect(
      literalLabelFromReferenceEdit({
        source,
        content: { runs: [{ kind: "text", value: "   " }] },
        sizeScale: 1,
        alignment: "start",
        id: "instance-text-1",
      }),
    ).toBeNull();
    expect(
      literalLabelFromReferenceEdit({
        source: {
          ...source,
          binding: { kind: "instance-value", instanceId: instance.id },
        },
        content: defaultDraftTextDocument("gm"),
        sizeScale: 1,
        alignment: "start",
        id: "instance-text-1",
      }),
    ).toBeNull();
  });
});

describe("planLiteralInstanceLabel", () => {
  const nextId = () => "instance-text-1";

  it("stands a new label on the value line below a shown Reference", () => {
    const instance = resistor();
    const document = documentWith(instance);
    document.annotations.push(referenceLabel(document, instance));
    const plan = planLiteralInstanceLabel({
      document,
      instance,
      text: " gm ",
      resolver,
      nextId,
    });
    const value = slot(document, instance, "value");
    expect(plan).toEqual({
      kind: "created",
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "instance-text-1",
            kind: "instance-label",
            content: defaultDraftTextDocument("gm"),
            anchor: {
              kind: "object",
              objectId: "R1",
              localOffset: {
                x: value.position.x - 100,
                y: value.position.y - 100,
              },
              fallbackPosition: value.position,
            },
            alignment: value.alignment,
            rotation: 0,
            locked: false,
          },
        },
      ],
    });
  });

  it("continues the stack past a shown value instead of covering it", () => {
    const instance = resistor();
    const document = documentWith(instance);
    document.annotations.push(referenceLabel(document, instance));
    const value = slot(document, instance, "value");
    document.annotations.push({
      id: "instance-value-R1",
      kind: "instance-value",
      binding: { kind: "instance-value", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: value.position.x - 100, y: value.position.y - 100 },
        fallbackPosition: value.position,
      },
      alignment: value.alignment,
      rotation: 0,
      locked: false,
    });
    const plan = planLiteralInstanceLabel({
      document,
      instance,
      text: "gm",
      resolver,
      nextId,
    });
    const reference = slot(document, instance, "reference");
    expect(plan.kind).toBe("created");
    if (plan.kind !== "created") return;
    const created = plan.edits[0]!;
    if (created.kind !== "upsert_schematic_annotation") throw new Error();
    expect(created.annotation.anchor).toEqual({
      kind: "object",
      objectId: "R1",
      localOffset: {
        x: value.position.x * 2 - reference.position.x - 100,
        y: value.position.y * 2 - reference.position.y - 100,
      },
      fallbackPosition: {
        x: value.position.x * 2 - reference.position.x,
        y: value.position.y * 2 - reference.position.y,
      },
    });
  });

  it("takes the place of a hidden Reference projection, wherever it was dragged", () => {
    const instance = resistor();
    const document = documentWith(instance);
    const hidden: Annotation = {
      ...referenceLabel(document, instance),
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: -30, y: 12 },
        fallbackPosition: { x: 70, y: 112 },
      },
      alignment: "end",
      rotation: 90,
      visible: false,
    };
    document.annotations.push(hidden);
    const plan = planLiteralInstanceLabel({
      document,
      instance,
      text: "gm",
      resolver,
      nextId,
    });
    expect(plan).toMatchObject({
      kind: "created",
      edits: [
        {
          annotation: {
            anchor: hidden.anchor,
            alignment: "end",
            rotation: 90,
          },
        },
      ],
    });
  });

  it("uses the Reference line when the component shows no Reference at all", () => {
    const instance: Instance = {
      id: "adder-1",
      symbolId: "adder",
      placement: { position: { x: 200, y: 160 }, rotation: 0, mirror: "none" },
    };
    const document = documentWith(instance);
    const plan = planLiteralInstanceLabel({
      document,
      instance,
      text: "Σ",
      resolver,
      nextId,
    });
    const reference = slot(document, instance, "reference");
    expect(plan).toMatchObject({
      kind: "created",
      edits: [
        {
          annotation: {
            anchor: { fallbackPosition: reference.position },
            alignment: reference.alignment,
          },
        },
      ],
    });
  });

  it("rewrites, keeps, and removes the one label it owns", () => {
    const instance = resistor();
    const document = documentWith(instance);
    const existing: Annotation = {
      id: "instance-text-3",
      kind: "instance-label",
      content: defaultDraftTextDocument("gm"),
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 20 },
        fallbackPosition: { x: 100, y: 120 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };
    document.annotations.push(existing);
    expect(literalInstanceLabelFor(document, "R1")).toBe(existing);
    expect(literalInstanceLabelText(document, "R1")).toBe("gm");
    expect(
      planLiteralInstanceLabel({
        document,
        instance,
        text: " gm",
        resolver,
        nextId,
      }),
    ).toEqual({ kind: "unchanged" });
    const rewritten = planLiteralInstanceLabel({
      document,
      instance,
      text: "1/gm",
      resolver,
      nextId,
    });
    expect(rewritten).toEqual({
      kind: "updated",
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            ...existing,
            content: defaultDraftTextDocument("1/gm"),
          },
        },
      ],
    });
    expect(
      planLiteralInstanceLabel({
        document,
        instance,
        text: "",
        resolver,
        nextId,
      }),
    ).toEqual({
      kind: "removed",
      edits: [
        {
          kind: "remove_schematic_annotation",
          annotationId: "instance-text-3",
        },
      ],
    });
  });

  it("has nothing to remove and nowhere to stand without a placement", () => {
    const retained = resistor(false);
    const document = documentWith(retained);
    expect(
      planLiteralInstanceLabel({
        document,
        instance: retained,
        text: "",
        resolver,
        nextId,
      }),
    ).toEqual({ kind: "unchanged" });
    expect(
      planLiteralInstanceLabel({
        document,
        instance: retained,
        text: "gm",
        resolver,
        nextId,
      }),
    ).toEqual({
      kind: "rejected",
      message: "Place the component before giving it a label",
    });
  });
});

describe("default Reference label beside a literal label", () => {
  it("still re-creates the Reference projection when only free text is attached", () => {
    const instance = resistor();
    const document = documentWith(instance);
    document.annotations.push({
      id: "instance-text-1",
      kind: "instance-label",
      content: defaultDraftTextDocument("gm"),
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 100, y: 100 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const label = defaultInstanceLabel(
      document,
      instance,
      resolver,
      resolveDocumentStyleProfile(document.presentation),
    );
    expect(label?.binding).toEqual({
      kind: "instance-reference",
      instanceId: "R1",
    });
    // The value the label resolves to is the Reference, untouched by the text.
    expect(flattenRichText(defaultDraftTextDocument(instance.reference!))).toBe(
      "R1",
    );
  });
});
