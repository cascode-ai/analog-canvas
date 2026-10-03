import test from "node:test";
import assert from "node:assert/strict";
import {
  portLabelPlacement,
  supplyLabelPlacement,
  placePortLabels,
} from "../../../packages/virtuoso-import/engine/port_labels.mjs";
test("external port label quadrants follow direction", () => {
  for (const [direction, position, alignment] of [
    [{ x: -1, y: 0 }, { x: 90, y: 88 }, "end"],
    [{ x: 1, y: 0 }, { x: 110, y: 88 }, "start"],
    [{ x: 0, y: -1 }, { x: 110, y: 88 }, "start"],
    [{ x: 0, y: 1 }, { x: 110, y: 124 }, "start"],
  ])
    assert.deepEqual(portLabelPlacement({ x: 100, y: 100 }, direction), {
      position,
      alignment,
    });
});
test("open end names use rotated/mirrored direction and retain net binding", () => {
  for (const rotation of [0, 90, 180, 270])
    for (const mirror of ["none", "horizontal"]) {
      const doc = {
        instances: [],
        junctions: [{ id: "j", netId: "n", position: { x: 100, y: 100 } }],
        drafting: {
          objects: [
            {
              kind: "floating-symbol",
              symbolId: "port",
              anchor: { kind: "object", objectId: "j" },
              transform: { rotation, mirror },
            },
          ],
        },
        annotations: [
          {
            id: "a",
            kind: "net-label",
            netId: "n",
            binding: { kind: "net-name", netId: "n" },
            anchor: { kind: "free", position: { x: 105, y: 90 } },
          },
        ],
      };
      assert.equal(placePortLabels(doc, {}).length, 1);
      assert.deepEqual(doc.annotations[0].binding, {
        kind: "net-name",
        netId: "n",
      });
      assert.equal(doc.annotations[0].anchor.objectId, "j");
      assert.equal(
        doc.annotations[0].alignment,
        (rotation === 0 && mirror === "none") ||
          (rotation === 180 && mirror === "horizontal")
          ? "end"
          : "start",
      );
    }
});
test("vertical VDD and GND labels stay to the left of the symbol", () => {
  assert.deepEqual(supplyLabelPlacement({ x: 100, y: 100 }, { x: 0, y: -1 }), {
    position: { x: 84, y: 86 },
    alignment: "end",
  });
  assert.deepEqual(supplyLabelPlacement({ x: 100, y: 100 }, { x: 0, y: 1 }), {
    position: { x: 84, y: 126 },
    alignment: "end",
  });
  assert.equal(supplyLabelPlacement({ x: 100, y: 100 }, { x: 1, y: 0 }), null);
  for (const [symbolId, rotation, expectedY] of [
    ["vdd-port", 0, 86],
    ["vdd-port", 180, 126],
    ["ground", 0, 126],
    ["ground", 180, 86],
  ]) {
    const doc = {
      instances: [
        {
          id: "marker",
          symbolId,
          placement: { position: { x: 100, y: 100 }, rotation, mirror: "none" },
        },
      ],
      nets: [
        {
          id: "net",
          terminals: [
            {
              instanceId: "marker",
              pinName: symbolId === "ground" ? "0" : "P",
            },
          ],
        },
      ],
      junctions: [],
      drafting: { objects: [] },
      annotations: [
        {
          id: "label",
          kind: "net-label",
          netId: "net",
          binding: { kind: "net-name", netId: "net" },
          anchor: { kind: "free", position: { x: 105, y: 105 } },
        },
      ],
    };
    assert.equal(placePortLabels(doc, {}).length, 1);
    assert.deepEqual(doc.annotations[0].anchor.fallbackPosition, {
      x: 84,
      y: expectedY,
    });
    assert.equal(doc.annotations[0].anchor.objectId, "marker");
    assert.equal(doc.annotations[0].alignment, "end");
  }
});
