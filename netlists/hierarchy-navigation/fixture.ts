import { createCellDocument, createEmptyProject } from "@icm/model";
import { createHierarchyInstance } from "../../packages/edit-engine/src/index.js";

/** Four levels, repeated parent definitions, and a disconnected root. */
export function hierarchyNavigationFixture() {
  const project = createEmptyProject("unified", "Unified hierarchy", "top");
  const top = project.documents[0]!;
  for (const name of ["Channel", "Amplifier", "Pair", "Unused"])
    project.documents.push(
      createCellDocument(name.toLowerCase(), name, top.presentation),
    );
  for (const cell of project.documents) {
    for (const name of ["IN", "OUT"]) {
      const id = `P_${name}`;
      cell.instances.push({ id, symbolId: "port", placement: null });
      cell.nets.push({
        id: name,
        terminals: [{ instanceId: id, pinName: "P" }],
      });
      cell.netlist!.terminals.push({
        id,
        name,
        netId: name,
        direction: name === "IN" ? "input" : "output",
        interfaceInstanceIds: [id],
      });
    }
    if (cell !== top)
      cell.netlist!.formalParameters.push({ name: "gain", defaultValue: "10" });
  }
  for (const [parentId, id, childId, x] of [
    ["top", "X1", "channel", 200],
    ["top", "X2", "channel", 500],
    ["channel", "XA", "amplifier", 200],
    ["amplifier", "XP", "pair", 200],
    ["unused", "XP", "pair", 200],
  ] as const) {
    const parent = project.documents.find((cell) => cell.id === parentId)!;
    const instance = createHierarchyInstance(
      id,
      project.documents.find((cell) => cell.id === childId)!,
      { position: { x, y: 200 }, rotation: 0, mirror: "none" },
    );
    instance.netlist!.parameters.gain =
      parentId === "top" ? (id === "X1" ? "20" : "30") : "{gain}";
    parent.instances.push(instance);
    for (const net of parent.nets)
      net.terminals.push({ instanceId: id, pinName: net.id });
  }
  const leaf = project.documents.find((cell) => cell.id === "pair")!;
  leaf.instances.push({
    id: "R1",
    reference: "R1",
    symbolId: "resistor",
    placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
    netlist: { parameters: { value: "{gain}" } },
  });
  leaf.nets[0]!.terminals.push({ instanceId: "R1", pinName: "1" });
  leaf.nets[1]!.terminals.push({ instanceId: "R1", pinName: "2" });
  return project;
}
