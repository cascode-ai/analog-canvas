import { createEmptyDocument, createEmptyProject } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { hierarchicalSymbolId } from "@icm/symbols";

/** Ideal linear resistors: parameter-scope acceptance, not a foundry-model benchmark. */
export function hierarchyParameterFixture() {
  const project = createEmptyProject(
    "parameter-fixture",
    "Hierarchy parameters",
  );
  const top = project.documents[0]!;
  const child = createEmptyDocument("resistors", "Resistors");
  const port = (cell: SchematicDocument, name: string) => {
    const id = `port-${name}`;
    cell.instances.push({ id, symbolId: "port", placement: null });
    cell.nets.push({ id: name, terminals: [{ instanceId: id, pinName: "P" }] });
    cell.netlist!.terminals.push({
      id,
      name,
      netId: name,
      direction: "passive",
      interfaceInstanceIds: [id],
    });
  };
  for (const name of ["IN", "OUT"]) port(child, name);
  for (const name of ["A", "B", "G"]) port(top, name);
  child.netlist!.formalParameters = [{ name: "Rbase", defaultValue: "1k" }];
  child.instances.push(
    ...["R1", "R2"].map((id) => ({
      id,
      symbolId: "resistor",
      reference: id,
      placement: null,
      netlist: { parameters: { value: id === "R1" ? "{Rbase}" : "{2*Rbase}" } },
    })),
  );
  child.nets
    .find((net) => net.id === "IN")!
    .terminals.push({ instanceId: "R1", pinName: "1" });
  child.nets
    .find((net) => net.id === "OUT")!
    .terminals.push({ instanceId: "R2", pinName: "2" });
  child.nets.push({
    id: "middle",
    terminals: [
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
    ],
  });
  for (const [id, netId] of [
    ["X1", "A"],
    ["X2", "B"],
  ] as const) {
    top.instances.push({
      id,
      symbolId: hierarchicalSymbolId("Resistors"),
      reference: id,
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: id === "X1" ? { Rbase: "2k" } : {},
      },
    });
    top.nets
      .find((net) => net.id === netId)!
      .terminals.push({ instanceId: id, pinName: "IN" });
    top.nets
      .find((net) => net.id === "G")!
      .terminals.push({ instanceId: id, pinName: "OUT" });
  }
  project.documents.push(child);
  return project;
}
