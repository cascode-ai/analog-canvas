import test from "node:test";
import assert from "node:assert/strict";
import { isolatedPortInstances } from "../../../packages/virtuoso-import/dist/core/isolated-ports.js";
import { projectMappings } from "../../../packages/virtuoso-import/dist/core/index.js";
import { fixture } from "./fixture.mjs";
test("projection records removed external interface and preserves device network members", () => {
  const s = fixture(),
    port = {
      ...structuredClone(s.instances[0]),
      id: "PIN",
      name: "PIN",
      library: "basic",
      cell: "iopin",
      symbolId: "port-symbol",
      position: [20, 20],
      terminals: [],
    };
  s.instances.push(port);
  s.symbols.push({ id: "port-symbol", terminals: [], shapes: [] });
  s.terminals.push({
    id: "VIN",
    name: "VIN",
    netId: "VIN",
    direction: "input",
    pins: [{ instanceId: "PIN", worldCenter: [20, 20], localCenter: [0, 0] }],
  });
  const before = structuredClone(s),
    r = projectMappings(s, { version: 1, devices: {} }, []);
  assert.deepEqual(s, before);
  assert.deepEqual(r.report.isolatedPorts, ["PIN"]);
  assert(!r.snapshot.instances.some((i) => i.id === "PIN"));
  assert.deepEqual(r.snapshot.nets, s.nets);
  assert.deepEqual(r.report.omittedPortInterfaces, [
    { name: "VIN", netId: "VIN", direction: "input" },
  ]);
});
test("isolated formal ports are removed by geometry, not remote net membership", () => {
  const source = {
    instances: [
      { id: "P", library: "basic", cell: "iopin", terminals: [] },
      {
        id: "M",
        library: "pdk",
        cell: "mos",
        terminals: [{ netId: "n", pins: [{ worldCenter: [10, 10] }] }],
      },
    ],
    terminals: [
      { netId: "n", pins: [{ instanceId: "P", worldCenter: [0, 0] }] },
    ],
    shapes: [
      {
        type: "line",
        netId: "n",
        points: [
          [10, 10],
          [20, 10],
        ],
      },
    ],
  };
  assert.deepEqual([...isolatedPortInstances(source)], ["P"]);
  const before = structuredClone(source);
  isolatedPortInstances(source);
  assert.deepEqual(source, before);
  for (const points of [
    [
      [0, 0],
      [2, 0],
    ],
    [
      [-1, -1],
      [1, 1],
    ],
    [
      [-1, 0],
      [1, 0],
    ],
  ]) {
    source.shapes[0].points = points;
    assert.equal(isolatedPortInstances(source).size, 0);
  }
  source.shapes = [];
  source.instances[1].terminals[0].pins[0].worldCenter = [0, 0];
  assert.equal(isolatedPortInstances(source).size, 0);
  source.instances[1].terminals[0].pins[0].worldCenter = [10, 10];
  source.shapes = [{ type: "arc", netId: "n" }];
  assert.equal(isolatedPortInstances(source).size, 0);
});
