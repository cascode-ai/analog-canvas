import { expect, it } from "vitest";
import {
  createEmptyProject,
  createEmptyDocument,
  semanticTextDocument,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { resolveDocumentLogicalNets } from "@icm/derived";
import { applyLabelSubscriptCase } from "./label-subscript-case";
const resolver = new InMemorySymbolResolver(builtInSymbols);
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
    restored.documents[1]!.presentation.labelSubscriptCase,
  ).toBeUndefined();
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
