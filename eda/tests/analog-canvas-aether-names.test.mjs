import test from "node:test";
import assert from "node:assert/strict";
import { withNativeNames } from "../aether_names.mjs";

test("native names preserve topology, source data and collision distinction", () => {
  const source = {
    nets: ["VDD/2", "VDD_slash_2", "GND", "vdd!"],
    ports: [{ name: "VDD/2", netName: "VDD/2" }],
    instances: [{ nodes: [{ pinName: "S", netName: "VDD/2" }] }],
    sourceGeometry: {
      portOccurrences: [{ name: "VDD/2", netName: "VDD/2" }],
      routes: [{ netName: "VDD/2", points: [[0, 0], [0, 10]] }],
    },
  };
  const result = withNativeNames(source);
  assert.deepEqual(result.nets, ["VDD_slash_2_1", "VDD_slash_2", "GND", "vdd!"]);
  assert.deepEqual(result.nativeNameMap, { "VDD/2": "VDD_slash_2_1" });
  assert.equal(result.instances[0].nodes[0].netName, result.ports[0].netName);
  assert.equal(result.sourceGeometry.routes[0].netName, result.ports[0].netName);
  assert.equal(result.sourceGeometry.portOccurrences[0].name, result.ports[0].name);
  assert.equal(result.instances[0].nodes[0].sourceNetName, "VDD/2");
  assert.equal(source.nets[0], "VDD/2");
  assert.equal(source.ports[0].name, "VDD/2");
});

test("different slash names cannot collapse into the same net", () => {
  const result = withNativeNames({ nets: ["a/b", "a_slash_b", "a_slash_b_1", "a//b"], ports: [] });
  assert.equal(new Set(result.nets).size, 4);
  assert.equal(result.nets[0], "a_slash_b_2");
});
