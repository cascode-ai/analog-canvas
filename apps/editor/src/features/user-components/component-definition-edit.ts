import type { ComponentDefinition } from "@icm/model";
import {
  sharedComponentNetlist,
  type SharedComponent,
} from "./component-library-contract";
import type { SymbolInsertRequest } from "../component-insert/component-insert-request";

export { sharedComponentNetlist } from "./component-library-contract";

export function newComponentDefinition(): ComponentDefinition {
  return {
    symbol: {
      schemaVersion: 1,
      id: "custom-component",
      name: "New component",
      viewBox: { x: -40, y: -30, width: 80, height: 60 },
      pins: [
        {
          name: "IN",
          role: "input",
          at: { x: -40, y: 0 },
          direction: "west",
          presentation: {
            visibility: "visible",
            showName: true,
            textSizeScale: 0.5,
          },
        },
        {
          name: "OUT",
          role: "output",
          at: { x: 40, y: 0 },
          direction: "east",
          presentation: {
            visibility: "visible",
            showName: true,
            textSizeScale: 0.5,
          },
        },
      ],
      primitives: [
        {
          kind: "polyline",
          points: [
            { x: -20, y: -20 },
            { x: 20, y: -20 },
            { x: 20, y: 20 },
            { x: -20, y: 20 },
            { x: -20, y: -20 },
          ],
        },
        { kind: "line", from: { x: -40, y: 0 }, to: { x: -20, y: 0 } },
        { kind: "line", from: { x: 20, y: 0 }, to: { x: 40, y: 0 } },
      ],
      variants: [],
    },
    subcircuit: {
      id: "custom-component",
      symbolId: "custom-component",
      target: "custom_block",
      ports: [
        { name: "VDD", supply: "VDD", direction: "inout" },
        { name: "VSS", supply: "VSS", direction: "inout" },
        { name: "IN", pinName: "IN", direction: "input" },
        { name: "OUT", pinName: "OUT", direction: "output" },
      ],
    },
  };
}

export function sharedComponentInsertRequest(
  entry: SharedComponent,
): SymbolInsertRequest {
  return {
    kind: "symbol",
    symbolId: entry.definition.symbol.id,
    symbolName: entry.definition.symbol.name,
    componentDefinition: entry.definition,
    parameters: sharedComponentNetlist(entry.definition)?.parameters ?? {},
    initialRotation: 0,
    showReference: true,
    referenceText: null,
    showValue: false,
  };
}
