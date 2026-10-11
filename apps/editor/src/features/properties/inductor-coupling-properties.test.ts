import { describe, expect, it } from "vitest";

import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  formatComponentPropertyCode,
  parseComponentPropertyCode,
  type ComponentPropertyCodeContext,
} from "./component-property-code";
import { propertyCodeSpans } from "./component-property-code-assists";
import { planComponentPropertyCodeEdits } from "./component-property-code-edits";
import {
  inductorCouplingPropertyContext,
  planCoupleInductors,
} from "./inductor-coupling-properties";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function inductors(): SchematicDocument {
  const document = createEmptyDocument("main", "Main");
  for (const [id, symbolId, x] of [
    ["L1", "inductor", 100],
    ["L2", "variable-inductor", 200],
    ["L3", "inductor-compact", 300],
    ["R1", "resistor", 400],
  ] as const)
    document.instances.push({
      id,
      symbolId,
      reference: id,
      placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
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
  if (!result.ok) throw new Error(result.error.message);
  return result.document;
}

function context(
  document: SchematicDocument,
  id: string,
): ComponentPropertyCodeContext {
  const instance = document.instances.find((item) => item.id === id)!;
  const inductorCoupling = inductorCouplingPropertyContext(document, instance);
  return {
    instance,
    referenceVisible: null,
    valueVisible: null,
    ...(inductorCoupling ? { inductorCoupling } : {}),
  };
}

/** Edit the Property Code of one inductor and apply it. */
function edit(
  document: SchematicDocument,
  id: string,
  change: (code: Record<string, any>) => void,
) {
  const code = JSON.parse(formatComponentPropertyCode(context(document, id)));
  change(code);
  const parsed = parseComponentPropertyCode(
    JSON.stringify(code),
    context(document, id),
  );
  if (!parsed.ok) throw new Error(parsed.message);
  const instance = document.instances.find((item) => item.id === id)!;
  return apply(
    document,
    planComponentPropertyCodeEdits(document, instance, parsed.value),
  );
}

describe("coupled inductor Properties", () => {
  it("offers Couple inductors only for two uncoupled inductors", () => {
    const document = inductors();
    expect(planCoupleInductors(document, ["L1", "R1"])).toBeNull();
    expect(planCoupleInductors(document, ["L1"])).toBeNull();
    const edit = planCoupleInductors(document, ["L1", "L2"])!;
    expect(edit).toEqual({
      kind: "set_inductor_coupling",
      coupling: {
        id: "coupling-L1-L2",
        name: "TF1",
        members: [
          { instanceId: "L1", dotPin: "1" },
          { instanceId: "L2", dotPin: "P1" },
        ],
        k: "1",
      },
    });
    const coupled = apply(document, [edit]);
    expect(planCoupleInductors(coupled, ["L2", "L1"])).toBeNull();
    expect(planCoupleInductors(coupled, ["L1", "L3"])).toMatchObject({
      coupling: { name: "TF2" },
    });
  });

  it("shows the dot and each coupling on both inductors, and none on an uncoupled one", () => {
    const document = apply(inductors(), [
      planCoupleInductors(inductors(), ["L1", "L2"])!,
    ]);
    const first = JSON.parse(
      formatComponentPropertyCode(context(document, "L1")),
    );
    expect(first.dot).toBe("1");
    expect(first.coupling).toEqual({
      TF1: { with: "L2", k: "1", arrow: true },
    });
    const second = JSON.parse(
      formatComponentPropertyCode(context(document, "L2")),
    );
    expect(second.coupling).toEqual({
      TF1: { with: "L1", k: "1", arrow: true },
    });
    const lone = JSON.parse(
      formatComponentPropertyCode(context(document, "L3")),
    );
    expect("coupling" in lone || "dot" in lone).toBe(false);
    expect(
      parseComponentPropertyCode(
        JSON.stringify({ ...lone, dot: "1" }),
        context(document, "R1"),
      ),
    ).toMatchObject({ ok: false });
    // The dot and the partner are choices; the arrow is a switch.
    const source = formatComponentPropertyCode(context(document, "L1"));
    const spans = propertyCodeSpans(source, context(document, "L1"));
    expect(
      spans.find((span) => span.field.path === "coupling.TF1.with")?.field
        .options,
    ).toEqual([
      { value: "L2", label: "L2" },
      { value: "L3", label: "L3" },
    ]);
    expect(spans.find((span) => span.field.path === "dot")?.field.kind).toBe(
      "choice",
    );
    expect(
      spans.find((span) => span.field.path === "coupling.TF1.arrow")?.field
        .kind,
    ).toBe("boolean");
  });

  it("edits k, the arrow, the name and the dot of one shared record", () => {
    let document = apply(inductors(), [
      planCoupleInductors(inductors(), ["L1", "L2"])!,
    ]);
    document = edit(document, "L2", (code) => {
      code.coupling = { Tx: { with: "L1", k: "0.8", arrow: false } };
      code.dot = "P2";
    });
    expect(document.inductorCouplings).toEqual([
      {
        id: "coupling-L1-L2",
        name: "Tx",
        members: [
          { instanceId: "L1", dotPin: "1" },
          { instanceId: "L2", dotPin: "P2" },
        ],
        k: "0.8",
        arrow: false,
      },
    ]);
    const fromL1 = JSON.parse(
      formatComponentPropertyCode(context(document, "L1")),
    );
    expect(fromL1.coupling).toEqual({
      Tx: { with: "L2", k: "0.8", arrow: false },
    });
  });

  it("adds a coupling from an entry, keeps one dot for all, and removes by deleting the entry", () => {
    let document = apply(inductors(), [
      planCoupleInductors(inductors(), ["L1", "L2"])!,
    ]);
    document = edit(document, "L1", (code) => {
      code.dot = "2";
      code.coupling.TF2 = { with: "L3", k: "0.5", arrow: true };
    });
    expect(document.inductorCouplings).toEqual([
      expect.objectContaining({
        name: "TF1",
        members: [
          { instanceId: "L1", dotPin: "2" },
          { instanceId: "L2", dotPin: "P1" },
        ],
      }),
      expect.objectContaining({
        name: "TF2",
        members: [
          { instanceId: "L1", dotPin: "2" },
          { instanceId: "L3", dotPin: "1" },
        ],
        k: "0.5",
      }),
    ]);
    document = edit(document, "L1", (code) => {
      delete code.coupling.TF1;
    });
    expect(document.inductorCouplings?.map((item) => item.name)).toEqual([
      "TF2",
    ]);
    document = edit(document, "L3", (code) => {
      code.coupling = {};
    });
    expect(document.inductorCouplings).toBeUndefined();
  });

  it("refuses a partner that is not another inductor of the Cell", () => {
    const document = apply(inductors(), [
      planCoupleInductors(inductors(), ["L1", "L2"])!,
    ]);
    const code = JSON.parse(
      formatComponentPropertyCode(context(document, "L1")),
    );
    code.coupling.TF1.with = "R1";
    expect(
      parseComponentPropertyCode(JSON.stringify(code), context(document, "L1")),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/with/u) });
    code.coupling.TF1.with = "L2";
    code.dot = "P1";
    expect(
      parseComponentPropertyCode(JSON.stringify(code), context(document, "L1")),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/dot/u) });
  });
});
