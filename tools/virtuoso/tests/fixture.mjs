// Synthetic topology-only data. No foundry models or company design information.
export function fixture() {
  const pin = (point) => ({
    worldCenter: point,
    localCenter: point,
    instanceId: null,
  });
  const terminals = [
    {
      name: "PLUS",
      netId: "VIN",
      direction: "inputOutput",
      pins: [pin([0, 0.125])],
    },
    {
      name: "MINUS",
      netId: "GND",
      direction: "inputOutput",
      pins: [pin([0, -0.125])],
    },
  ];
  const shape = (id, netId, points) => ({
    id,
    netId,
    type: "line",
    layer: "wire",
    points,
  });
  const label = (id, netId, position) => ({
    id,
    netId,
    type: "label",
    layer: "wire",
    position,
    text: netId,
  });
  const snapshot = {
    format: "analog-agent.schematic",
    schemaVersion: 1,
    source: { library: "demo", cell: "resistor_example", view: "schematic" },
    coordinates: { yAxis: "up", dbuPerUserUnit: 160 },
    instances: [
      {
        id: "R1",
        name: "R1",
        library: "analogLib",
        cell: "res",
        view: "symbol",
        symbolId: "res-symbol",
        position: [0, 0],
        orientation: "R0",
        transform: [[0, 0], "R0", 1],
        arrayCount: 1,
        properties: [
          { name: "r", type: "string", value: "Rbias" },
          { name: "layoutOnly", type: "string", value: "do-not-export" },
        ],
        effectiveCdfParameters: [
          { name: "r", type: "string", value: "1k" },
          { name: "m", type: "string", value: "1" },
        ],
        terminals,
        simulationInfo: {
          status: "available",
          simulators: [
            {
              name: "spectre",
              termOrder: ["PLUS", "MINUS"],
              componentName: "resistor",
              modelName: null,
            },
          ],
        },
      },
    ],
    symbols: [
      {
        id: "res-symbol",
        terminals: terminals.map((t) => ({ ...t, netId: null })),
        shapes: [],
        bbox: [
          [-0.1, -0.2],
          [0.1, 0.2],
        ],
      },
    ],
    nets: [
      {
        id: "VIN",
        name: "VIN",
        isGlobal: false,
        numBits: 1,
        terminals: [{ instanceId: "R1", pinName: "PLUS" }],
      },
      {
        id: "GND",
        name: "GND",
        isGlobal: false,
        numBits: 1,
        terminals: [{ instanceId: "R1", pinName: "MINUS" }],
      },
    ],
    terminals: [],
    shapes: [
      shape("wire-in", "VIN", [
        [0, 0.125],
        [0, 0.5],
      ]),
      shape("wire-gnd", "GND", [
        [0, -0.125],
        [0, -0.5],
      ]),
      label("label-in", "VIN", [0.125, 0.4]),
      label("label-gnd", "GND", [0.125, -0.4]),
    ],
    warnings: [],
  };
  const second = structuredClone(snapshot.instances[0]);
  second.id = "R2";
  second.name = "R2";
  second.position = [1, 0];
  for (const t of second.terminals) t.pins[0].worldCenter[0] += 1;
  snapshot.instances.push(second);
  snapshot.nets[0].terminals.push({ instanceId: "R2", pinName: "PLUS" });
  snapshot.nets[1].terminals.push({ instanceId: "R2", pinName: "MINUS" });
  snapshot.shapes.push(
    shape("wire-in2", "VIN", [
      [1, 0.125],
      [1, 0.5],
    ]),
    shape("wire-gnd2", "GND", [
      [1, -0.125],
      [1, -0.5],
    ]),
    label("label-in2", "VIN", [1.125, 0.4]),
    label("label-gnd2", "GND", [1.125, -0.4]),
  );
  return snapshot;
}
