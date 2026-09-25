import {
  createEmptyDocument,
  flattenRichText,
  SchematicDocumentSchema,
} from "@icm/model";
import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { executeTransaction } from "./transaction.js";
import { refreshInstanceValueAnnotation } from "./transaction-instance-annotations.js";

it("keeps a Value label's authored look in step with its parameter", () => {
  const document = createEmptyDocument("value-look", "Value look");
  document.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: { parameters: { value: "RL" } },
  });
  document.annotations.push({
    id: "R1-value",
    kind: "instance-value",
    binding: { kind: "instance-value", instanceId: "R1" },
    formatOverride: {
      runs: [
        { kind: "text", value: "R" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "L" }],
        },
      ],
    },
    anchor: {
      kind: "object",
      objectId: "R1",
      localOffset: { x: 0, y: 0 },
      fallbackPosition: { x: 0, y: 0 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  const parsed = SchematicDocumentSchema.safeParse(document);
  expect(
    parsed.success,
    JSON.stringify(parsed.success ? [] : parsed.error.issues),
  ).toBe(true);
  const before = structuredClone(document.instances[0]!);
  document.instances[0]!.netlist!.parameters.value = "RD";
  refreshInstanceValueAnnotation(document, before, "R1", new Set());
  expect(flattenRichText(document.annotations[0]!.formatOverride!)).toBe("RD");
  expect(SchematicDocumentSchema.safeParse(document).success).toBe(true);
  const invalid = executeTransaction(
    document,
    {
      transactionId: "bad-value-look",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            ...document.annotations[0]!,
            formatOverride: { runs: [{ kind: "text", value: "WRONG" }] },
          },
        },
      ],
    },
    { symbolResolver: new InMemorySymbolResolver(builtInSymbols) },
  );
  expect(invalid.ok).toBe(false);
  if (!invalid.ok)
    expect(invalid.error.message).toContain("current displayed characters");
});
