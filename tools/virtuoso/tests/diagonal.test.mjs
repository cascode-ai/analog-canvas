import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { fixture } from "./fixture.mjs";
import { convertDesign } from "../../../packages/virtuoso-import/dist/adapter/index.js";
import { segmentIntersectsRect } from "../../../packages/virtuoso-import/engine/segment_geometry.mjs";
test("diagonal bounding boxes are not treated as actual symbol intersections", () => {
  const a = { x: 0, y: 0 },
    b = { x: 10, y: 10 };
  assert.equal(
    segmentIntersectsRect(a, b, { x: 0, y: 8, width: 2, height: 2 }),
    false,
  );
  assert.equal(
    segmentIntersectsRect(a, b, { x: 4, y: 4, width: 2, height: 2 }),
    true,
  );
  assert.equal(
    segmentIntersectsRect(b, a, { x: 4, y: 4, width: 2, height: 2 }),
    true,
  );
  assert.equal(
    segmentIntersectsRect(
      a,
      { x: 0, y: 10 },
      { x: 1, y: 4, width: 2, height: 2 },
    ),
    false,
  );
});
test("native conversion retains arbitrary-angle source wire and connectivity", async () => {
  const source = fixture();
  source.shapes.find((s) => s.id === "wire-in").points[1] = [-0.5, 0.5];
  const result = await convertDesign(
    source,
    {
      version: 1,
      devices: {
        "analogLib/res": {
          symbol: "resistor",
          pins: { PLUS: "1", MINUS: "2" },
          parameters: { r: "r" },
        },
      },
    },
    { runtime: { root: fileURLToPath(new URL("../../../", import.meta.url)) } },
  );
  assert.equal(result.report.sourceDiagonalSegments, 1);
  assert(result.validation.diagonalSegments >= 1);
  assert.equal(result.report.sourceConnectivityVerified, true);
  assert.deepEqual(result.validation.erc, []);
});
