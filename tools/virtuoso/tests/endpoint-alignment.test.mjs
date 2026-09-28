import test from "node:test";
import assert from "node:assert/strict";
import { createRoutePath } from "../../../packages/model/dist/index.js";
import { resolveRouteGeometry } from "../../../packages/derived/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../../packages/symbols/dist/index.js";
import { alignEndMarkers } from "../../../packages/virtuoso-import/engine/align_end_markers.mjs";

const instance = (id, symbolId, x, y, rotation = 0, mirror = "none") => ({
  id,
  symbolId,
  placement: { position: { x, y }, rotation, mirror },
});
const pin = (instanceId, pinName) => ({
  kind: "terminal",
  instanceId,
  pinName,
});
const route = (id, netId, start, end, bends) =>
  createRoutePath({
    id,
    netId,
    start,
    end,
    bends,
    modes: Array(bends.length + 1).fill("manual"),
  });

test("direct open ports align to device pins and ground markers rotate toward them", () => {
  const doc = {
    revision: 0,
    presentation: { grid: 10 },
    junctions: [],
    drafting: { objects: [] },
    instances: [
      instance(
        "switch",
        "voltage-controlled-switch",
        60,
        1400,
        0,
        "horizontal",
      ),
      instance("capacitor", "capacitor", 1040, 1050),
      instance("end-marker-switch-port", "port", -20, 1380),
      instance("end-marker-cap-port", "port", 880, 1080),
      instance("end-marker-switch-ground", "ground", -10, 1430),
      instance("end-marker-cap-ground", "ground", 1040, 990),
    ],
    nets: [
      {
        id: "v-resn",
        terminals: [
          { instanceId: "switch", pinName: "N" },
          { instanceId: "end-marker-switch-port", pinName: "P" },
        ],
      },
    ],
    routes: [
      route(
        "switch-port",
        "v-resn",
        pin("end-marker-switch-port", "P"),
        pin("switch", "N"),
        [
          { x: 10, y: 1380 },
          { x: 10, y: 1390 },
        ],
      ),
      route(
        "cap-port",
        "v-resp",
        pin("end-marker-cap-port", "P"),
        pin("capacitor", "2"),
        [{ x: 1040, y: 1080 }],
      ),
      route(
        "switch-ground",
        "gnd",
        pin("end-marker-switch-ground", "0"),
        pin("switch", "CN"),
        [
          { x: -10, y: 1400 },
          { x: 20, y: 1400 },
          { x: 20, y: 1420 },
        ],
      ),
      route(
        "cap-ground",
        "gnd",
        pin("end-marker-cap-ground", "0"),
        pin("capacitor", "1"),
        [
          { x: 1040, y: 960 },
          { x: 1010, y: 960 },
          { x: 1010, y: 1010 },
          { x: 1040, y: 1010 },
        ],
      ),
    ],
  };
  const resolver = createProjectSymbolResolver(
    {
      documents: [],
      topDocumentId: "unused",
      externalSubcircuitDefinitions: [],
    },
    builtInSymbols,
  );
  const originalNets = structuredClone(doc.nets);
  const changes = alignEndMarkers(doc, resolver);
  assert.equal(changes.length, 4);
  assert.deepEqual(doc.nets, originalNets);
  assert.equal(
    doc.instances.find((i) => i.id === "end-marker-switch-port").placement
      .position.y,
    1390,
  );
  assert.equal(
    doc.instances.find((i) => i.id === "end-marker-cap-port").placement.position
      .y,
    1070,
  );
  assert.equal(
    doc.instances.find((i) => i.id === "end-marker-switch-ground").placement
      .rotation,
    90,
  );
  assert.equal(
    doc.instances.find((i) => i.id === "end-marker-cap-ground").placement
      .rotation,
    180,
  );
  for (const wire of doc.routes)
    assert.equal(resolveRouteGeometry(doc, resolver, wire).segments.length, 1);
});
