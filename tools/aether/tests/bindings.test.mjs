import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyProject } from "@icm/model";
import { analyzeDesignNetlist } from "@icm/netlist";
import { parseSpiceNumber } from "@icm/spice";
import { assertSupportedHierarchy } from "../analog-canvas-aether-bindings.mjs";

function fixture(customName) {
  const project = createEmptyProject("binding-test", "Binding test", "dut");
  const document = project.documents[0];
  const source = { id: "gate", symbolId: "inverter", reference: "X1",
    placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    netlist: { binding: { kind: "unresolved-subcircuit", name: "inverter" }, parameters: {} } };
  document.instances.push(source);
  const pins = customName === "nch_ulvt_mac" ? ["D", "G", "S", "B"] : ["VDD", "VSS", "A", "Y"];
  if (customName) {
    if (customName === "nch_ulvt_mac") source.symbolId = "nmos";
    source.netlist.binding = { kind: "external-subcircuit", definitionId: "custom" };
    project.externalSubcircuitDefinitions.push({ id: "custom", name: customName,
      interfaceStatus: "declared", terminals: pins.map((name) => ({id: name, name, direction: "inout"})),
      formalParameters: [], implementation: { kind: "placeholder" } });
  }
  for (const pinName of pins) {
    document.nets.push({ id: pinName, terminals: [{ instanceId: "gate", pinName }] });
  }
  const analysis = analyzeDesignNetlist(project, {format: "spice"});
  assert.ok(analysis.ir, JSON.stringify(analysis.diagnostics));
  const instance = analysis.ir.cells.find((c) => c.id === analysis.ir.topCellId).instances[0];
  assert.ok(instance, JSON.stringify(analysis.diagnostics));
  return [project, analysis.ir, source, instance];
}

test("real Canvas built-in inverter can be explicitly lowered", () => {
  assert.doesNotThrow(() => assertSupportedHierarchy(...fixture()));
});
test("a custom external inverter cannot acquire built-in meaning by name", () => {
  assert.throws(() => assertSupportedHierarchy(...fixture("inverter")), /unsupported authored/);
});
test("custom MOS implementation is not replaced by the declaration-only PDK remap", () => {
  assert.throws(() => assertSupportedHierarchy(...fixture("nch_ulvt_mac")), /unsupported authored/);
});
test("canonical Canvas SPICE authority treats a and A as atto", () => {
  assert.equal(parseSpiceNumber("1a").value, 1e-18);
  assert.equal(parseSpiceNumber("1A").value, 1e-18);
});
