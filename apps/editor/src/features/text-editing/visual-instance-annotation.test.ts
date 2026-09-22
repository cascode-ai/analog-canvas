import { describe, expect, it } from "vitest";
import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import {
  resolveAnnotationText,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import {
  createEmptyDocument,
  flattenRichText,
  labelTextDocument,
  type Annotation,
  type RichTextDocument,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { copySelection, proposePaste } from "../clipboard/clipboard";
import { defaultInstanceLabel } from "../wiring/route-interaction-geometry";
import {
  instanceLabelAnnotationFor,
  missingDefaultInstanceDisplayAnnotations,
} from "../instance-display/default-instance-display";
import {
  createTextEditingSession,
  proposeTextEditingCommit,
  updateTextEditingSession,
} from "./text-editing";

const resolver = new InMemorySymbolResolver(builtInSymbols);
function fixture() {
  const document = createEmptyDocument("main", "Main");
  document.instances.push({
    id: "device-1",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { value: "10k" },
    },
  });
  document.annotations.push({
    id: "visual-1",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "device-1" },
    anchor: {
      kind: "object",
      objectId: "device-1",
      localOffset: { x: 40, y: -20 },
      fallbackPosition: { x: 140, y: 80 },
    },
    alignment: "end",
    rotation: 0,
    sizeScale: 1.5,
    locked: false,
  });
  return document;
}
function apply(document: SchematicDocument, edits: SchematicEdit[]) {
  const result = executeTransaction(
    document,
    {
      transactionId: `edit-${document.revision}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}
function edit(
  document: SchematicDocument,
  content: RichTextDocument,
  displayAlias = true,
) {
  const session = updateTextEditingSession(
    createTextEditingSession(
      { owner: "annotation", object: document.annotations[0]! },
      document,
    ),
    { content },
  );
  const proposal = proposeTextEditingCommit(document, {
    ...session,
    displayAlias,
  });
  if (proposal.kind !== "update") throw new Error(proposal.kind);
  return apply(document, [...(proposal.beforeEdits ?? []), proposal.edit]);
}
const text = (value: string): RichTextDocument => ({
  runs: [{ kind: "text", value }],
});

describe("one visual annotation, one electrical authority", () => {
  it("defaults to synchronized names and renames without moving or detaching the label", () => {
    const before = fixture();
    const session = createTextEditingSession(
      { owner: "annotation", object: before.annotations[0]! },
      before,
    );
    expect(session.displayAlias).toBe(false);
    const after = edit(before, text("R8"), false);
    expect(after.instances[0]!.reference).toBe("R_8");
    expect(after.annotations[0]!.binding).toEqual({
      kind: "instance-reference",
      instanceId: "device-1",
    });
    expect(after.annotations[0]!.anchor).toEqual(before.annotations[0]!.anchor);
    expect(
      flattenRichText(resolveAnnotationText(after, after.annotations[0]!)),
    ).toBe("R8");
  });

  it.each<RichTextDocument>([
    text("R2"),
    text("input_pair_left"),
    {
      runs: [
        {
          kind: "math",
          latex: String.raw`R_1=\frac{1}{g_m}`,
          display: "inline",
        },
      ],
    },
    { runs: [{ kind: "math", latex: "R1", display: "inline" }] },
    {
      runs: [
        { kind: "text", value: "Input" },
        { kind: "line-break" },
        { kind: "text", value: "pair" },
      ],
    },
  ])(
    "edits arbitrary content in place, without renaming or creating a second label: %j",
    (content) => {
      const before = fixture();
      const after = edit(before, content);
      expect(after.instances).toEqual(before.instances);
      expect(after.annotations).toHaveLength(1);
      expect(after.annotations[0]).toMatchObject({
        id: "visual-1",
        content,
        anchor: before.annotations[0]!.anchor,
        alignment: "end",
        sizeScale: 1.5,
      });
      expect(after.annotations[0]).not.toHaveProperty("binding");
      expect(after.annotations[0]).not.toHaveProperty("formatOverride");
      // Authored text is not a missing default when re-placing or toggling display.
      expect(instanceLabelAnnotationFor(after, "device-1")).toBe(
        after.annotations[0],
      );
      expect(
        defaultInstanceLabel(
          after,
          after.instances[0]!,
          resolver,
          resolveDocumentStyleProfile(after.presentation),
        ),
      ).toBeNull();
      expect(
        missingDefaultInstanceDisplayAnnotations(
          after,
          after.instances[0]!,
          resolver,
          resolveDocumentStyleProfile(after.presentation),
        ),
      ).toEqual([]);
    },
  );

  it("retains a live binding for formatting only, and rename rewrites only that projection", () => {
    const styled: RichTextDocument = {
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "R1" }],
        },
      ],
    };
    const before = edit(fixture(), styled, false);
    expect(before.annotations[0]).toMatchObject({
      binding: { kind: "instance-reference" },
      formatOverride: styled,
    });
    const after = apply(before, [
      {
        kind: "set_instance_reference",
        instanceId: "device-1",
        reference: "R7",
      },
    ]);
    expect(
      flattenRichText(resolveAnnotationText(after, after.annotations[0]!)),
    ).toBe("R7");
    expect(after.annotations[0]!.formatOverride?.runs[0]).toMatchObject({
      style: "bold",
    });
    const custom = edit(after, text("load"));
    const renamed = apply(custom, [
      {
        kind: "set_instance_reference",
        instanceId: "device-1",
        reference: "R8",
      },
    ]);
    expect(renamed.annotations[0]!.content).toEqual(text("load"));
  });

  it("keeps aliases explicit and restores the live binding when alias is disabled", () => {
    const custom = edit(edit(fixture(), text("load")), text("R1"));
    expect(custom.annotations[0]).not.toHaveProperty("binding");
    const session = {
      ...createTextEditingSession(
        { owner: "annotation", object: custom.annotations[0]! },
        custom,
      ),
      content: labelTextDocument("R_1", custom.presentation),
      displayAlias: false,
    };
    expect(session).toMatchObject({
      bound: false,
      visualInstanceId: "device-1",
    });
    expect(custom.annotations[0]!.content).toEqual(text("R1")); // cancel has no effect
    const proposal = proposeTextEditingCommit(custom, session);
    if (proposal.kind !== "update") throw new Error(proposal.kind);
    const restored = apply(custom, [proposal.edit]);
    expect(restored.annotations[0]).toMatchObject({
      id: "visual-1",
      anchor: custom.annotations[0]!.anchor,
      binding: { kind: "instance-reference", instanceId: "device-1" },
    });
    expect(restored.annotations[0]).not.toHaveProperty("content");
    expect(restored.annotations[0]!.formatOverride).toEqual(session.content);
    expect(restored.instances[0]!.reference).toBe("R1");
    const formatted = updateTextEditingSession(session, {
      content: {
        runs: [
          {
            kind: "span",
            style: "overbar",
            children: [{ kind: "text", value: "R1" }],
          },
        ],
      },
    });
    const styledRestore = proposeTextEditingCommit(custom, formatted);
    if (styledRestore.kind !== "update") throw new Error(styledRestore.kind);
    expect(apply(custom, [styledRestore.edit]).annotations[0]).toMatchObject({
      binding: { kind: "instance-reference", instanceId: "device-1" },
      formatOverride: formatted.content,
    });
  });

  it.each([false, true])(
    "creates a fresh live name when the source display alias is %s",
    (custom) => {
      const content: RichTextDocument = {
        runs: [
          {
            kind: "math",
            latex: String.raw`\overline{R_1}`,
            display: "inline",
          },
        ],
      };
      const before = custom ? edit(fixture(), content) : fixture();
      const clipboard = copySelection(before, ["device-1"]);
      const proposal = proposePaste(before, clipboard!, { x: 200, y: 0 }, 1);
      const after = apply(before, proposal.edits);
      const copied = after.instances.find(
        (instance) => instance.id === proposal.instanceIds[0],
      )!;
      expect(copied.reference).toBe("R2");
      const label = instanceLabelAnnotationFor(after, copied.id)!;
      expect(label.anchor).toMatchObject({
        kind: "object",
        objectId: copied.id,
      });
      expect(label.content).toBeUndefined();
      expect(flattenRichText(resolveAnnotationText(after, label))).toBe("R2");
      expect(instanceLabelAnnotationFor(before, "device-1")?.content).toEqual(
        custom ? content : undefined,
      );
    },
  );

  it("prefers a visible legacy custom annotation without deleting hidden authored content", () => {
    const document = fixture();
    document.annotations[0]!.visible = false;
    const { binding: _, ...rest } = document.annotations[0]!;
    const custom: Annotation = {
      ...rest,
      id: "legacy-label",
      visible: true,
      content: text("load"),
    };
    document.annotations.push(custom);
    expect(instanceLabelAnnotationFor(document, "device-1")).toBe(custom);
    expect(document.annotations).toHaveLength(2);
  });
});
