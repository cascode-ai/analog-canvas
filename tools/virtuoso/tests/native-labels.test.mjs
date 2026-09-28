import test from "node:test";
import assert from "node:assert/strict";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../../packages/symbols/dist/index.js";
import { createEmptyProject } from "../../../packages/model/dist/index.js";
import {
  defaultInstanceLabelPlacement,
  resolveDocumentStyleProfile,
} from "../../../packages/derived/dist/index.js";
import { placeNativeInstanceLabels } from "../../../packages/virtuoso-import/engine/native_labels.mjs";
import { separateLabels } from "../../../packages/virtuoso-import/engine/label_layout.mjs";

test("names use native positions for rotations and mirrors without modifying geometry", () => {
  for (const symbolId of ["nmos", "pmos", "resistor", "port"]) {
    for (const rotation of [0, 90, 180, 270])
      for (const mirror of ["none", "horizontal"]) {
        const instance = {
          id: "device",
          symbolId,
          reference: "M_original",
          placement: { position: { x: 500, y: 500 }, rotation, mirror },
        };
        const binding =
          symbolId === "port"
            ? { kind: "cell-terminal-name", terminalId: "interface" }
            : { kind: "instance-reference", instanceId: "device" };
        const project = createEmptyProject("labels", "labels"),
          doc = project.documents[0];
        doc.instances = [instance];
        doc.annotations = [
          {
            id: "label",
            kind: "instance-label",
            binding,
            anchor: {
              kind: "object",
              objectId: "device",
              localOffset: { x: 40, y: -10 },
              fallbackPosition: { x: 540, y: 490 },
            },
            alignment: "start",
            rotation: 0,
            locked: false,
          },
        ];
        doc.netlist = {
          name: "labels",
          terminals: [
            { id: "interface", name: "IN", interfaceInstanceIds: ["device"] },
          ],
          formalParameters: [],
        };
        const resolver = createProjectSymbolResolver(
          {
            documents: [],
            topDocumentId: "unused",
            externalSubcircuitDefinitions: [],
          },
          builtInSymbols,
        );
        const before = structuredClone(instance);
        const expected = defaultInstanceLabelPlacement(
          instance,
          resolver.resolve(symbolId),
          resolveDocumentStyleProfile(doc.presentation),
          10,
          "reference",
        );
        const changes = placeNativeInstanceLabels(doc, resolver);
        assert.equal(changes.length, 1);
        assert.deepEqual(
          doc.annotations[0].anchor.fallbackPosition,
          expected.position,
        );
        assert.equal(doc.annotations[0].alignment, expected.alignment);
        assert.deepEqual(doc.annotations[0].binding, binding);
        assert.deepEqual(instance, before);
        const placed = structuredClone(doc.annotations[0]);
        separateLabels(doc, resolver, new Set(changes.map((c) => c.id)));
        assert.deepEqual(doc.annotations[0], placed);
        doc.annotations[0].locked = true;
        assert.deepEqual(placeNativeInstanceLabels(doc, resolver), []);
      }
  }
});
