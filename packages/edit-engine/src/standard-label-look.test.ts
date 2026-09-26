import {
  createEmptyDocument,
  flattenRichText,
  roleLabelFormat,
  supplyLabelFormat,
} from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import type { SchematicEdit } from "./edit-schema.js";
import { executeTransaction } from "./transaction.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function apply(
  document: SchematicDocument,
  edits: SchematicEdit[],
): SchematicDocument {
  const result = executeTransaction(
    document,
    {
      transactionId: "supply-label-format",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      dryRun: false,
      edits,
    },
    { symbolResolver: resolver },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

function rail(
  netName: string,
  scope: "local" | "global",
): Extract<SchematicEdit, { kind: "add_power_rail" }> {
  return {
    kind: "add_power_rail",
    netId: "net-vdd",
    routeId: "rail-vdd",
    startJunctionId: "junction-start",
    endJunctionId: "junction-end",
    labelId: "label-VDD1",
    netName,
    scope,
    powerDomain: "vdd",
    start: { x: 10, y: 10 },
    end: { x: 100, y: 10 },
  };
}

const label = (document: SchematicDocument) =>
  document.annotations.find((annotation) => annotation.id === "label-VDD1")!;

describe("standard label looks", () => {
  it("draws a new rail label as italic V over an upright DD", () => {
    for (const scope of ["local", "global"] as const) {
      const document = apply(createEmptyDocument("document-main", "Main"), [
        rail("VDD", scope),
      ]);
      expect(label(document).formatOverride).toEqual(supplyLabelFormat("VDD"));
    }
    const local = apply(createEmptyDocument("document-main", "Main"), [
      rail("VDD", "local"),
    ]);
    // The electrical name keeps its exact spelling.
    expect(local.netlist?.terminals.map((terminal) => terminal.name)).toEqual([
      "VDD",
    ]);
  });

  it("leaves a rail outside the V convention to the ordinary rules", () => {
    const document = apply(createEmptyDocument("document-main", "Main"), [
      rail("AVDD", "local"),
    ]);
    expect(label(document).formatOverride).toBeUndefined();
  });

  it("keeps a Cell-Pin rail's stored look in step with its name", () => {
    const railed = apply(createEmptyDocument("document-main", "Main"), [
      rail("VDD", "local"),
    ]);
    const terminalId = railed.netlist!.terminals[0]!.id;
    const renamed = apply(railed, [
      { kind: "update_cell_terminal", terminalId, name: "VDDA" },
    ]);
    expect(label(renamed).formatOverride).toEqual(supplyLabelFormat("VDDA"));
    const avdd = apply(renamed, [
      { kind: "update_cell_terminal", terminalId, name: "AVDD" },
    ]);
    expect(label(avdd).formatOverride).toBeUndefined();
  });

  it("keeps a global rail's stored look through claim updates", () => {
    const railed = apply(createEmptyDocument("document-main", "Main"), [
      rail("VDD", "global"),
    ]);
    const claim = railed.connectivityEvidence.find(
      (evidence) => evidence.kind === "name-claim",
    )!;
    if (claim.kind !== "name-claim") throw new Error("expected a name claim");
    // Re-stating the same name must not flatten the stored subscript.
    const restated = apply(railed, [
      { kind: "upsert_connectivity_evidence", evidence: claim },
    ]);
    expect(label(restated).formatOverride).toEqual(supplyLabelFormat("VDD"));
    const renamed = apply(railed, [
      {
        kind: "upsert_connectivity_evidence",
        evidence: { ...claim, name: "VCC" },
      },
    ]);
    expect(label(renamed).formatOverride).toEqual(supplyLabelFormat("VCC"));
  });
  it("keeps a device label's stored M₁ look in step with its Reference", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: null,
    });
    document.annotations.push({
      id: "instance-label-M1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "M1" },
      formatOverride: roleLabelFormat("device-reference", "M1")!,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const renamed = apply(document, [
      { kind: "set_instance_reference", instanceId: "M1", reference: "M3" },
    ]);
    expect(renamed.annotations[0]!.formatOverride).toEqual(
      roleLabelFormat("device-reference", "M3"),
    );
    // A Reference that keeps its device letter keeps the look, the letter
    // over the rest (M_TAIL, #1116); one that drops the letter returns to the
    // ordinary rules.
    const tail = apply(renamed, [
      { kind: "set_instance_reference", instanceId: "M1", reference: "MTAIL" },
    ]);
    expect(tail.annotations[0]!.formatOverride).toEqual(
      roleLabelFormat("device-reference", "MTAIL", { deviceLetter: "M" }),
    );
    const other = apply(tail, [
      { kind: "set_instance_reference", instanceId: "M1", reference: "XTAIL" },
    ]);
    expect(other.annotations[0]!.formatOverride).toBeUndefined();
  });

  it("follows a resistor renamed R1 to RL1 into R over subscript L1", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: null,
    });
    document.annotations.push({
      id: "instance-label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      formatOverride: roleLabelFormat("device-reference", "R1")!,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const renamed = apply(document, [
      { kind: "set_instance_reference", instanceId: "R1", reference: "RL1" },
    ]);
    const format = renamed.annotations[0]!.formatOverride!;
    expect(format).toEqual(
      roleLabelFormat("device-reference", "RL1", { deviceLetter: "R" }),
    );
    expect(flattenRichText({ runs: format.runs.slice(0, 1) })).toBe("R");
    expect(flattenRichText({ runs: format.runs.slice(1) })).toBe("L1");
  });
});
