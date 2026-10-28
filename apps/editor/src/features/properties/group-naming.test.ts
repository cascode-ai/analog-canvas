import { describe, expect, it } from "vitest";
import {
  executeProjectTransaction,
  executeTransaction,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  resolveAnnotationName,
  resolveAnnotationText,
  resolveDocumentLogicalNets,
} from "@icm/derived";
import {
  createEmptyProject,
  flattenRichText,
  labelTextDocument,
  roleLabelFormat,
  type Annotation,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { instanceLabelAnnotationFor } from "../instance-display/default-instance-display";
import { instanceDisplayEdits } from "../instance-display/instance-display-edits";
import {
  groupNamingStatus,
  planDisplayAlias,
  planGroupNaming,
  planNetLabelAlias,
  shownPartName,
} from "./group-naming";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function label(id: string, instanceId: string, x: number): Annotation {
  return {
    id,
    kind: "instance-label",
    anchor: {
      kind: "object",
      objectId: instanceId,
      localOffset: { x: 20, y: -10 },
      fallbackPosition: { x: x + 20, y: -10 },
    },
    alignment: "start",
    rotation: 0,
    locked: false,
  };
}

function project(): CircuitProject {
  const project = createEmptyProject("naming", "Naming");
  const document = project.documents[0]!;
  ["R1", "R2", "R3"].forEach((reference, index) => {
    const id = `device-${index + 1}`;
    document.instances.push({
      id,
      reference,
      symbolId: "resistor",
      placement: {
        position: { x: index * 100, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "1k" },
      },
    });
    const format = roleLabelFormat("device-reference", reference, {
      deviceLetter: "R",
    });
    document.annotations.push({
      ...label(`label-${id}`, id, index * 100),
      binding: { kind: "instance-reference", instanceId: id },
      ...(format ? { formatOverride: format } : {}),
    });
  });
  return project;
}

function name(
  source: CircuitProject,
  instanceIds: readonly string[],
  value: string,
) {
  return planGroupNaming({
    project: source,
    document: source.documents[0]!,
    resolver,
    instanceIds,
    name: value,
    labelFor: instanceLabelAnnotationFor,
    newLabelFor: (document, instanceId) =>
      instanceDisplayEdits(document, resolver, [instanceId], {
        showReference: true,
      }).flatMap((edit) =>
        edit.kind === "upsert_schematic_annotation" ? [edit.annotation] : [],
      )[0],
  });
}

function apply(document: SchematicDocument, edits: SchematicEdit[]) {
  const result = executeTransaction(
    document,
    {
      transactionId: "group-name",
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

const shown = (document: SchematicDocument, instanceId: string) => {
  const annotation = instanceLabelAnnotationFor(document, instanceId)!;
  return resolveAnnotationText(document, annotation);
};

describe("one name for several selected parts", () => {
  it("renames the part selected first and shows the name on the others as an alias", () => {
    const source = project();
    // R2 was selected first, then R3 and R1.
    const plan = name(source, ["device-2", "device-3", "device-1"], "R5");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan).toMatchObject({ holder: "R2", aliases: ["R3", "R1"] });
    expect(groupNamingStatus("R5", plan)).toBe(
      "R2 is now R5; R3, R1 show it as a display alias",
    );
    const after = apply(source.documents[0]!, plan.edits);
    expect(after.instances.map((instance) => instance.reference)).toEqual([
      "R1",
      "R5",
      "R3",
    ]);
    // Only R2's label names its part; the others hold their own text, and
    // all three draw it alike.
    expect(instanceLabelAnnotationFor(after, "device-2")!.binding).toEqual({
      kind: "instance-reference",
      instanceId: "device-2",
    });
    for (const id of ["device-1", "device-3"]) {
      expect(instanceLabelAnnotationFor(after, id)!.binding).toBeUndefined();
      expect(shown(after, id)).toEqual(shown(after, "device-2"));
    }
    expect(flattenRichText(shown(after, "device-1"))).toBe("R5");
    expect(
      shownPartName(instanceLabelAnnotationFor(after, "device-1"), "R1"),
    ).toBe("R5");

    // Naming them again moves only the name, and the part that has a name
    // keeps it.
    const again = { ...source, documents: [after] };
    const next = name(again, ["device-2", "device-3", "device-1"], "R6");
    if (!next.ok) throw new Error(next.message);
    expect(next).toMatchObject({ holder: "R5", aliases: ["R3", "R1"] });
    const renamed = apply(after, next.edits);
    expect(renamed.instances.map((instance) => instance.reference)).toEqual([
      "R1",
      "R6",
      "R3",
    ]);
    expect(flattenRichText(shown(renamed, "device-3"))).toBe("R6");
    // Nothing is left to do once they all show it.
    const settled = name(
      { ...source, documents: [renamed] },
      ["device-2", "device-3", "device-1"],
      "R6",
    );
    expect(settled).toMatchObject({ ok: true, edits: [] });
  });

  it("keeps the name with the part that has it, which shows its name again", () => {
    const source = project();
    const document = source.documents[0]!;
    // R3 shows an alias of its own.
    const r3 = document.annotations.find(
      (annotation) => annotation.id === "label-device-3",
    )!;
    delete r3.binding;
    delete r3.formatOverride;
    r3.content = { runs: [{ kind: "text", value: "Rload" }] };
    const plan = name(source, ["device-1", "device-3"], "R3");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan).toMatchObject({ holder: "R3", aliases: ["R1"] });
    expect(groupNamingStatus("R3", plan)).toBe(
      "R3 keeps the name; R1 shows it as a display alias",
    );
    const after = apply(document, plan.edits);
    expect(instanceLabelAnnotationFor(after, "device-3")!.binding).toEqual({
      kind: "instance-reference",
      instanceId: "device-3",
    });
    expect(flattenRichText(shown(after, "device-1"))).toBe("R3");
    expect(after.instances[0]!.reference).toBe("R1");
  });

  it("passes the name to the next selected part that can take it", () => {
    const source = project();
    // A capacitor selected first cannot be named R9; the resistor after it can.
    source.documents[0]!.instances.push({
      id: "cap",
      reference: "C1",
      symbolId: "capacitor",
      placement: { position: { x: 400, y: 0 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "primitive", deviceClass: "capacitor" },
        parameters: { value: "1p" },
      },
    });
    source.documents[0]!.annotations.push({
      ...label("label-cap", "cap", 400),
      binding: { kind: "instance-reference", instanceId: "cap" },
    });
    const plan = name(source, ["cap", "device-1"], "R9");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan).toMatchObject({ holder: "R1", aliases: ["C1"] });
  });

  it("shows a name no part can carry on them all", () => {
    const source = project();
    for (const value of ["R 5", "R2", "Φ2"]) {
      const plan = name(source, ["device-1", "device-3"], value);
      if (!plan.ok) throw new Error(plan.message);
      // R2 is a part outside the selection; a space and Φ are not netlist names.
      expect(plan).toMatchObject({ holder: null, aliases: ["R1", "R3"] });
      const after = apply(source.documents[0]!, plan.edits);
      expect(after.instances.map((instance) => instance.reference)).toEqual([
        "R1",
        "R2",
        "R3",
      ]);
    }
    const plan = name(source, ["device-1", "device-3"], "R2");
    if (!plan.ok) throw new Error(plan.message);
    expect(groupNamingStatus("R2", plan)).toBe(
      "R2 cannot be a netlist name here; R1, R3 show it as a display alias",
    );
  });

  it("gives a part without a label one that shows the name, and skips a ground", () => {
    const source = project();
    const document = source.documents[0]!;
    document.annotations = document.annotations.filter(
      (annotation) => annotation.id !== "label-device-3",
    );
    document.instances.push({
      id: "gnd",
      symbolId: "ground",
      placement: { position: { x: 0, y: 100 }, rotation: 0, mirror: "none" },
    });
    const plan = name(source, ["gnd", "device-1", "device-3"], "R7");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan).toMatchObject({ holder: "R1", aliases: ["R3"] });
    const after = apply(document, plan.edits);
    expect(flattenRichText(shown(after, "device-3"))).toBe("R7");
    expect(name(source, ["gnd"], "R7")).toEqual({
      ok: false,
      message: "None of the selected parts has a name",
    });
  });

  it("renames the first Pin through its Cell and shows its name on another Pin as an alias", () => {
    const source = createEmptyProject("pins", "Pins");
    const document = source.documents[0]!;
    ["IN", "OUT"].forEach((pin, index) => {
      const id = `pin-${index + 1}`;
      document.instances.push({
        id,
        symbolId: "port",
        placement: {
          position: { x: index * 100, y: 0 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.nets.push({
        id: `net-${pin}`,
        terminals: [{ instanceId: id, pinName: "P" }],
      });
      document.netlist!.terminals.push({
        id: `terminal-${pin}`,
        name: pin,
        netId: `net-${pin}`,
        direction: "passive",
        interfaceInstanceIds: [id],
      });
      document.annotations.push({
        ...label(`label-${id}`, id, index * 100),
        binding: { kind: "cell-terminal-name", terminalId: `terminal-${pin}` },
      });
    });
    const plan = name(source, ["pin-1", "pin-2"], "Vin");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan).toMatchObject({ holder: "IN", aliases: ["OUT"] });
    expect(plan.structure).not.toEqual([]);
    const own = plan.structure.find(
      (edit) =>
        edit.kind === "transact_document" && edit.documentId === document.id,
    );
    if (own?.kind !== "transact_document") throw new Error("no Pin rename");
    own.edits.push(...plan.edits);
    const result = executeProjectTransaction(source, {
      transactionId: "group-name",
      projectId: source.id,
      expectedStructureRevision: source.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: plan.structure,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const after = result.project.documents[0]!;
    expect(after.netlist!.terminals.map((terminal) => terminal.name)).toEqual([
      "Vin",
      "OUT",
    ]);
    // OUT keeps its name and shows Vin, drawn as the Vin Pin's label is.
    expect(instanceLabelAnnotationFor(after, "pin-2")!.binding).toBeUndefined();
    expect(shown(after, "pin-2")).toEqual(shown(after, "pin-1"));
    expect(flattenRichText(shown(after, "pin-2"))).toBe("Vin");
    // A Pin never takes another Pin's name, which would join them.
    const joined = name(source, ["pin-2", "pin-1"], "IN");
    expect(joined).toMatchObject({ ok: true, holder: "IN", aliases: ["OUT"] });
    expect(joined.ok && joined.structure).toEqual([]);
  });
});

describe("one part's display alias (#1254)", () => {
  function opampDocument(): SchematicDocument {
    const document = createEmptyProject("alias", "Alias").documents[0]!;
    document.instances.push({
      id: "amp",
      reference: "X1",
      symbolId: "opamp",
      placement: {
        position: { x: 200, y: 200 },
        rotation: 0,
        mirror: "none",
      },
    } as SchematicDocument["instances"][number]);
    return document;
  }
  const labels = {
    labelFor: instanceLabelAnnotationFor,
    newLabelFor: (document: SchematicDocument, instanceId: string) =>
      instanceDisplayEdits(document, resolver, [instanceId], {
        showReference: true,
      }).flatMap((edit) =>
        edit.kind === "upsert_schematic_annotation" &&
        edit.annotation.kind === "instance-label"
          ? [edit.annotation]
          : [],
      )[0],
  };
  const apply = (document: SchematicDocument, edits: SchematicEdit[]) => {
    const result = executeTransaction(
      document,
      {
        transactionId: "alias",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits,
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    return result.document;
  };

  it("draws an op-amp X1 as A1 and keeps X1 in the netlist", () => {
    let document = opampDocument();
    const plan = planDisplayAlias({
      document,
      instanceId: "amp",
      alias: "A1",
      ...labels,
    });
    if (!plan.ok) throw new Error(plan.message);
    document = apply(document, plan.edits);
    const shown = instanceLabelAnnotationFor(document, "amp")!;
    expect(shown.binding).toBeUndefined();
    expect(flattenRichText(resolveAnnotationText(document, shown))).toBe("A1");
    expect(shown.content).toEqual(roleLabelFormat("device-reference", "A1"));
    expect(document.instances[0]!.reference).toBe("X1");

    // Null names it again, bound to its Reference in its standard look.
    const back = planDisplayAlias({
      document,
      instanceId: "amp",
      alias: null,
      ...labels,
    });
    if (!back.ok) throw new Error(back.message);
    document = apply(document, back.edits);
    const named = instanceLabelAnnotationFor(document, "amp")!;
    expect(named.binding).toEqual({
      kind: "instance-reference",
      instanceId: "amp",
    });
    expect(flattenRichText(resolveAnnotationText(document, named))).toBe("X1");
  });

  it("shows a hidden label with the alias, and refuses a part with no name", () => {
    let document = opampDocument();
    const shown = planDisplayAlias({
      document,
      instanceId: "amp",
      alias: null,
      ...labels,
    });
    if (!shown.ok) throw new Error(shown.message);
    document = apply(document, shown.edits);
    const label = instanceLabelAnnotationFor(document, "amp")!;
    document = apply(document, [
      {
        kind: "upsert_schematic_annotation",
        annotation: { ...label, visible: false },
      },
    ]);
    const plan = planDisplayAlias({
      document,
      instanceId: "amp",
      alias: "A2",
      ...labels,
    });
    if (!plan.ok) throw new Error(plan.message);
    const [edit] = plan.edits;
    expect(
      edit?.kind === "upsert_schematic_annotation" && edit.annotation.visible,
    ).not.toBe(false);
    document.instances[0]!.reference = undefined;
    expect(
      planDisplayAlias({ document, instanceId: "amp", alias: "A1", ...labels }),
    ).toMatchObject({ ok: false });
  });

  it("draws a Port VEA,OUT while its Cell Pin stays VEA_OUT (#1880)", () => {
    let document = createEmptyProject("pin-alias", "Pin alias").documents[0]!;
    document.instances.push({
      id: "pin",
      symbolId: "port",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "net-ea",
      terminals: [{ instanceId: "pin", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "terminal-ea",
      name: "VEA_OUT",
      netId: "net-ea",
      direction: "passive",
      interfaceInstanceIds: ["pin"],
    });
    document.annotations.push({
      ...label("label-pin", "pin", 0),
      binding: { kind: "cell-terminal-name", terminalId: "terminal-ea" },
    });
    const plan = planDisplayAlias({
      document,
      instanceId: "pin",
      alias: "VEA,OUT",
      ...labels,
    });
    if (!plan.ok) throw new Error(plan.message);
    document = apply(document, plan.edits);
    const shown = instanceLabelAnnotationFor(document, "pin")!;
    expect(shown.binding).toBeUndefined();
    expect(flattenRichText(resolveAnnotationText(document, shown))).toBe(
      "VEA,OUT",
    );
    expect(document.netlist!.terminals[0]!.name).toBe("VEA_OUT");
  });
});

describe("a Net label's display alias (#1880)", () => {
  function labelledDocument(): SchematicDocument {
    const document = createEmptyProject("net-alias", "Net alias").documents[0]!;
    ["ea", "other"].forEach((suffix, index) => {
      document.nets.push({ id: `net-${suffix}`, terminals: [] });
      document.annotations.push({
        id: `label-${suffix}`,
        kind: "net-label",
        binding: { kind: "net-name", netId: `net-${suffix}` },
        netId: `net-${suffix}`,
        anchor: { kind: "free", position: { x: index * 100, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      });
      document.connectivityEvidence.push({
        id: `claim-${suffix}`,
        kind: "name-claim",
        netId: `net-${suffix}`,
        name: "VEA_OUT",
        owner: { kind: "net-label", annotationId: `label-${suffix}` },
        scope: "local",
      });
    });
    return document;
  }
  const apply = (document: SchematicDocument, edits: SchematicEdit[]) => {
    const result = executeTransaction(
      document,
      {
        transactionId: "net-alias",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "test" },
        edits,
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(result.diagnostics[0]?.message);
    return result.document;
  };
  const labelOf = (document: SchematicDocument, id: string) =>
    document.annotations.find((annotation) => annotation.id === id)!;

  it("draws VEA,OUT while the Net keeps VEA_OUT and still joins by it", () => {
    let document = labelledDocument();
    const plan = planNetLabelAlias({
      document,
      annotationId: "label-ea",
      alias: "VEA,OUT",
    });
    if (!plan.ok) throw new Error(plan.message);
    document = apply(document, plan.edits);
    const shown = labelOf(document, "label-ea");
    expect(shown.binding).toBeUndefined();
    expect(shown.netId).toBe("net-ea");
    expect(flattenRichText(resolveAnnotationText(document, shown))).toBe(
      "VEA,OUT",
    );
    expect(resolveAnnotationName(document, shown)).toBe("VEA_OUT");
    // Its claim still names the Net, and same-name labels join by it.
    const logical = resolveDocumentLogicalNets(document);
    expect(logical.byBaseNetId.get("net-ea")?.name).toBe("VEA_OUT");
    expect(logical.byBaseNetId.get("net-ea")?.id).toBe(
      logical.byBaseNetId.get("net-other")?.id,
    );

    // Clearing it names the Net again, in the label's standard look.
    const back = planNetLabelAlias({
      document,
      annotationId: "label-ea",
      alias: null,
    });
    if (!back.ok) throw new Error(back.message);
    document = apply(document, back.edits);
    const named = labelOf(document, "label-ea");
    expect(named.binding).toEqual({ kind: "net-name", netId: "net-ea" });
    expect(named.content).toBeUndefined();
    expect(resolveAnnotationText(document, named)).toEqual(
      labelTextDocument("VEA_OUT", document.presentation),
    );
    expect(
      planNetLabelAlias({ document, annotationId: "label-ea", alias: null }),
    ).toEqual({ ok: true, edits: [] });
  });

  it("joins nothing by an alias that spells another Net's name", () => {
    let document = labelledDocument();
    document.connectivityEvidence = document.connectivityEvidence.map(
      (evidence) =>
        evidence.id === "claim-other" && evidence.kind === "name-claim"
          ? { ...evidence, name: "VREF" }
          : evidence,
    );
    const plan = planNetLabelAlias({
      document,
      annotationId: "label-other",
      alias: "VEA_OUT",
    });
    if (!plan.ok) throw new Error(plan.message);
    document = apply(document, plan.edits);
    // Drawn as the name would be.
    expect(labelOf(document, "label-other").content).toEqual(
      labelTextDocument("VEA_OUT", document.presentation),
    );
    const logical = resolveDocumentLogicalNets(document);
    expect(logical.byBaseNetId.get("net-other")?.name).toBe("VREF");
    expect(logical.byBaseNetId.get("net-other")?.id).not.toBe(
      logical.byBaseNetId.get("net-ea")?.id,
    );
  });

  it("refuses text that is not a Net label naming a Net", () => {
    const document = labelledDocument();
    expect(
      planNetLabelAlias({ document, annotationId: "missing", alias: "A" }),
    ).toMatchObject({ ok: false });
    document.connectivityEvidence = [];
    expect(
      planNetLabelAlias({ document, annotationId: "label-ea", alias: "A" }),
    ).toMatchObject({ ok: false });
  });
});
