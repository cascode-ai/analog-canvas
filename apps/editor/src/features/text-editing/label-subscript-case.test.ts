import { expect, it } from "vitest";
import {
  createEmptyProject,
  createEmptyDocument,
  labelTypography,
  semanticTextDocument,
  type SchematicDocument,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { applyLabelSubscriptCase } from "./label-subscript-case";
import { flattenRichText, richTextIdentifier } from "@icm/model";
import { resolveAnnotationText } from "@icm/derived";
const resolver = new InMemorySymbolResolver(builtInSymbols);
const layout = {
  underscoreSubscript: true,
  subscriptAfterFirst: false,
  firstLetterItalic: true,
};

function useLegacyLabelTypography(document: SchematicDocument): void {
  delete document.presentation.labelFirstLetterItalic;
  delete document.presentation.labelSubscriptAfterFirst;
  delete document.presentation.labelSubscriptCase;
  delete document.presentation.labelSubscriptItalic;
  delete document.presentation.labelUnderscoreSubscript;
}

it("updates old formatted labels and module body names together, preserving color and unrelated content", () => {
  const source = fixture(),
    doc = source.documents[0]!;
  doc.instances.push({
    id: "amp",
    reference: "X1",
    symbolId: "opamp-lettered",
    placement: { position: { x: 300, y: 100 }, rotation: 0, mirror: "none" },
    signalFlowParameters: { formula: "A_gain" },
  });
  const literal = applyLabelSubscriptCase(
    source,
    doc.id,
    "preserve",
    resolver,
    [],
    false,
    { ...layout, underscoreSubscript: false, firstLetterItalic: false },
  );
  expect(
    flattenRichText(
      resolveAnnotationText(
        literal.documents[0]!,
        literal.documents[0]!.annotations[0]!,
      ),
    ),
  ).toBe("R_load");
  expect(literal.documents[0]!.instances[0]!.reference).toBe("R_load");
  expect(literal.documents[0]!.annotations[0]!.textColor).toBe("#ff0000");
  const script = applyLabelSubscriptCase(
    literal,
    doc.id,
    "uppercase",
    resolver,
    [],
    true,
    layout,
  );
  expect(
    script.documents[0]!.instances.at(-1)!.signalFlowParameters!.formula,
  ).toBe("A_GAIN");
  expect(
    richTextIdentifier(script.documents[0]!.annotations[0]!.formatOverride!),
  ).toBe("R_LOAD");
  expect(script.documents[1]).toEqual(source.documents[1]);
  expect(
    parseProject(serializeProject(script)).documents[0]!.presentation,
  ).toMatchObject({
    labelUnderscoreSubscript: true,
    labelFirstLetterItalic: true,
  });
});

it("applies first-letter subscripts to plain names and aliases as one consistent naming action", () => {
  const source = fixture(),
    doc = source.documents[0]!;
  doc.instances[0]!.reference = "Rload";
  delete doc.annotations[0]!.formatOverride;
  doc.netlist!.terminals[0]!.name = "Vin";
  const next = applyLabelSubscriptCase(
    source,
    doc.id,
    "lowercase",
    resolver,
    [],
    false,
    { ...layout, subscriptAfterFirst: true },
  );
  expect(next.documents[0]!.instances[0]!.reference).toBe("R_load");
  expect(next.documents[0]!.netlist!.terminals[0]!.name).toBe("V_in");
  expect(next.documents[0]!.annotations[0]!.formatOverride).toBeUndefined();
  expect(
    richTextIdentifier(
      resolveAnnotationText(
        next.documents[0]!,
        next.documents[0]!.annotations[0]!,
      ),
    ),
  ).toBe("R_load");
});
function fixture() {
  const project = createEmptyProject("case", "Case");
  const document = project.documents[0]!;
  document.instances.push({
    id: "R1",
    reference: "R_load",
    symbolId: "resistor",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
  });
  document.annotations.push({
    id: "label-R1",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "R1" },
    anchor: { kind: "free", position: { x: 100, y: 80 } },
    alignment: "start",
    rotation: 0,
    locked: false,
    textColor: "#ff0000",
    formatOverride: semanticTextDocument("R_load", "instance-label"),
  });
  document.netlist!.terminals.push({
    id: "vip",
    name: "V_in",
    netId: "net-in",
    direction: "input",
    interfaceInstanceIds: ["P1"],
  });
  document.instances.push({
    id: "P1",
    symbolId: "port",
    placement: { position: { x: 0, y: 100 }, rotation: 0, mirror: "none" },
  });
  document.nets.push({
    id: "net-in",
    terminals: [
      { instanceId: "R1", pinName: "1" },
      { instanceId: "P1", pinName: "P" },
    ],
  });
  project.documents.push(createEmptyDocument("other", "Other"));
  return project;
}
it("renames source names, keeps local style and persists only in this Cell", () => {
  const source = fixture(),
    id = source.topDocumentId;
  const copy = structuredClone(source);
  const next = applyLabelSubscriptCase(source, id, "uppercase", resolver);
  expect(source).toEqual(copy);
  expect(next.documents[0]!.instances[0]!.reference).toBe("R_LOAD");
  expect(next.documents[0]!.netlist!.terminals[0]!.name).toBe("V_IN");
  expect(next.documents[0]!.annotations[0]!.textColor).toBe("#ff0000");
  expect(next.documents[1]).toEqual(source.documents[1]);
  const restored = parseProject(serializeProject(next));
  expect(restored.documents[0]!.presentation.labelSubscriptCase).toBe(
    "uppercase",
  );
  expect(
    labelTypography(restored.documents[1]!.presentation).subscriptCase,
  ).toBe("preserve");
  const lower = applyLabelSubscriptCase(next, id, "lowercase", resolver);
  expect(lower.documents[0]!.instances[0]!.reference).toBe("R_load");
});
it("allows same-name Nets to remain electrically merged", () => {
  const project = fixture(),
    document = project.documents[0]!;
  for (const [id, name] of [
    ["a", "V_load"],
    ["b", "V_LOAD"],
  ]) {
    document.nets.push({ id: id!, terminals: [] });
    document.annotations.push({
      id: `label-${id}`,
      kind: "net-label",
      netId: id!,
      binding: { kind: "net-name", netId: id! },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    document.connectivityEvidence.push({
      id: `claim-${id}`,
      kind: "name-claim",
      netId: id!,
      name: name!,
      scope: "local",
      owner: { kind: "net-label", annotationId: `label-${id}` },
    });
  }
  const next = applyLabelSubscriptCase(
    project,
    document.id,
    "uppercase",
    resolver,
  );
  const nets = resolveDocumentLogicalNets(next.documents[0]!);
  expect(nets.byBaseNetId.get("a")?.id).toBe(nets.byBaseNetId.get("b")?.id);
  expect(nets.byBaseNetId.get("a")?.name).toBe("V_LOAD");
});

it("updates historical explicit subscripts and the bound names without guessing plain names", () => {
  const source = fixture();
  const doc = source.documents[0]!;
  useLegacyLabelTypography(doc);
  doc.instances[0]!.reference = "Rload";
  doc.netlist!.terminals[0]!.name = "Vin";
  doc.annotations.push({
    ...doc.annotations[0]!,
    id: "label-port",
    binding: { kind: "cell-terminal-name", terminalId: "vip" },
    formatOverride: semanticTextDocument("V_in", "formal-port"),
  });
  doc.instances.push({
    ...doc.instances[0]!,
    id: "plain",
    reference: "Rplain",
  });
  const next = applyLabelSubscriptCase(source, doc.id, "uppercase", resolver);
  expect(next.documents[0]!.instances.map((i) => i.reference)).toEqual([
    "R_LOAD",
    undefined,
    "Rplain",
  ]);
  expect(next.documents[0]!.netlist!.terminals[0]!.name).toBe("V_IN");
  expect(next.documents[0]!.annotations[0]!.formatOverride).toEqual(
    semanticTextDocument("R_LOAD", "instance-label"),
  );
});

it("toggles only subscript slant, persists it and leaves source names and other Cells untouched", () => {
  const source = fixture(),
    doc = source.documents[0]!;
  doc.presentation.labelSubscriptItalic = true;
  doc.instances[0]!.reference = "Rload"; // explicit historical subscript
  const upright = applyLabelSubscriptCase(
    source,
    doc.id,
    "preserve",
    resolver,
    [],
    false,
  );
  const updated = upright.documents[0]!;
  expect(updated.instances).toEqual(doc.instances);
  expect(updated.nets).toEqual(doc.nets);
  expect(updated.netlist).toEqual(doc.netlist);
  expect(updated.annotations[0]!.textColor).toBe("#ff0000");
  expect(updated.annotations[0]!.formatOverride!.runs).toEqual([
    doc.annotations[0]!.formatOverride!.runs[0],
    {
      kind: "span",
      style: "subscript",
      children: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "load" }],
        },
      ],
    },
  ]);
  expect(upright.documents[1]).toEqual(source.documents[1]);
  const restored = parseProject(serializeProject(upright));
  expect(restored.documents[0]!.presentation.labelSubscriptItalic).toBe(false);
  const italic = applyLabelSubscriptCase(
    restored,
    doc.id,
    "preserve",
    resolver,
    [],
    true,
  );
  expect(italic.documents[0]!.annotations).toEqual(doc.annotations);
});

it("formats display aliases independently of their instance name", () => {
  const source = fixture(),
    doc = source.documents[0]!;
  doc.presentation.labelSubscriptItalic = true;
  const alias = doc.annotations[0]!;
  delete alias.binding;
  alias.content = semanticTextDocument("R_alias", "instance-label");
  delete alias.formatOverride;
  const next = applyLabelSubscriptCase(
    source,
    doc.id,
    "uppercase",
    resolver,
    [],
    false,
  );
  // The instance's own underscore name still participates in circuit naming.
  expect(next.documents[0]!.instances[0]!.reference).toBe("R_LOAD");
  expect(next.documents[0]!.annotations[0]!.content!.runs[1]).toMatchObject({
    style: "subscript",
    children: [{ style: "bold", children: [{ value: "ALIAS" }] }],
  });
  expect(next.documents[0]!.annotations[0]!.binding).toBeUndefined();
});

it("applies appearance and label changes together without dropping either edit", () => {
  const source = fixture(),
    doc = source.documents[0]!;
  const next = applyLabelSubscriptCase(
    source,
    doc.id,
    "uppercase",
    resolver,
    [
      {
        kind: "set_presentation_style",
        styleProfileId: doc.presentation.styleProfileId,
        styleOverrides: { fontScale: 1.5 },
      },
    ],
    false,
  );
  expect(next.documents[0]!.presentation.styleOverrides).toEqual({
    fontScale: 1.5,
  });
  expect(next.documents[0]!.presentation.labelSubscriptItalic).toBe(false);
  expect(next.documents[0]!.instances[0]!.reference).toBe("R_LOAD");
});

it("renames a legacy power-label claim and keeps its authored upright subscript", () => {
  const source = fixture(),
    doc = source.documents[0]!;
  useLegacyLabelTypography(doc);
  doc.annotations.push({
    ...doc.annotations[0]!,
    id: "rail",
    kind: "power-label",
    netId: "rail-net",
    binding: { kind: "net-name", netId: "rail-net" },
    formatOverride: {
      runs: [
        { kind: "text", value: "V" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "dd" }],
        },
      ],
    },
  });
  doc.nets.push({ id: "rail-net", terminals: [] });
  doc.connectivityEvidence.push({
    id: "rail-name",
    kind: "name-claim",
    netId: "rail-net",
    name: "Vdd",
    scope: "local",
    owner: { kind: "net-label", annotationId: "rail" },
  });
  const next = applyLabelSubscriptCase(
    source,
    doc.id,
    "uppercase",
    resolver,
    [],
    true,
  );
  expect(next.documents[0]!.connectivityEvidence[0]).toMatchObject({
    name: "V_DD",
  });
  expect(next.documents[0]!.annotations.at(-1)!.formatOverride).toEqual({
    runs: [
      { kind: "text", value: "V" },
      {
        kind: "span",
        style: "subscript",
        children: [{ kind: "text", value: "DD" }],
      },
    ],
  });
});
