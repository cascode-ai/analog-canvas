import { executeTransaction } from "@icm/edit-engine";
import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { captureDocumentComposition, copySelection } from "./clipboard";
import { clipboardPreviewDocument } from "./clipboard-preview";
import { proposePaste } from "./paste-proposal";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function coupled(): SchematicDocument {
  const document = createEmptyDocument("source", "Source");
  for (const [id, x] of [
    ["L1", 100],
    ["L2", 200],
    ["L3", 300],
  ] as const)
    document.instances.push({
      id,
      symbolId: "inductor",
      reference: id,
      placement: { position: { x, y: 100 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1u" } },
    });
  document.inductorCouplings = [
    {
      id: "coupling-1",
      name: "TF1",
      members: [
        { instanceId: "L1", dotPin: "2" },
        { instanceId: "L2", dotPin: "1" },
      ],
      k: "0.7",
      arrow: false,
    },
  ];
  return document;
}

function paste(
  document: SchematicDocument,
  clipboard = copySelection(document, ["L1", "L2"])!,
) {
  const proposal = proposePaste(document, clipboard, { x: 0, y: 200 }, 1);
  expect(proposal.errors).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: "paste-coupling",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits: proposal.edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(result.error.message);
  return { proposal, document: result.document };
}

describe("copying coupled inductors", () => {
  it("carries a coupling with both its inductors, re-keyed under a free name", () => {
    const { proposal, document } = paste(coupled());
    const [original, copy] = document.inductorCouplings!;
    expect(original!.name).toBe("TF1");
    const ids = proposal.idRemap.instances;
    expect(copy).toEqual({
      id: proposal.idRemap.inductorCouplings!["coupling-1"],
      name: "TF2",
      members: [
        { instanceId: ids["L1"], dotPin: "2" },
        { instanceId: ids["L2"], dotPin: "1" },
      ],
      k: "0.7",
      arrow: false,
    });
    expect(copy!.id).not.toBe("coupling-1");
  });

  it("drops a coupling when only one of its inductors is copied", () => {
    const source = coupled();
    expect(copySelection(source, ["L1", "L3"])!.inductorCouplings).toBe(
      undefined,
    );
    const { document } = paste(source, copySelection(source, ["L1"])!);
    expect(document.inductorCouplings).toHaveLength(1);
  });

  it("keeps couplings in a whole-Document copy and in the paste ghost", () => {
    const source = coupled();
    const composition = captureDocumentComposition(source)!;
    expect(composition.inductorCouplings).toEqual(source.inductorCouplings);
    const target = createEmptyDocument("target", "Target");
    const { document } = paste(target, composition);
    expect(document.inductorCouplings).toHaveLength(1);
    expect(document.inductorCouplings![0]!.name).toBe("TF1");
    const ghost = clipboardPreviewDocument(
      source,
      copySelection(source, ["L1", "L2"])!,
      { x: 0, y: 200 },
      [],
      resolver,
    );
    expect(ghost.inductorCouplings).toHaveLength(1);
    const lonely = clipboardPreviewDocument(
      source,
      copySelection(source, ["L3"])!,
      { x: 0, y: 200 },
      [],
      resolver,
    );
    expect(lonely.inductorCouplings).toBeUndefined();
  });
});
