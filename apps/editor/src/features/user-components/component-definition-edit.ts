import type { ComponentDefinition } from "@icm/model";
import { ComponentDefinitionSchema } from "@icm/model";
import {
  sharedComponentNetlist,
  type SharedComponent,
} from "./component-library-contract";
import type { SymbolInsertRequest } from "../component-insert/component-insert-request";

export { sharedComponentNetlist } from "./component-library-contract";

/** Local captures have independent identities without claiming a public revision. */
export function localComponentDefinition(
  definition: ComponentDefinition,
  identity: string,
): ComponentDefinition {
  const copy = structuredClone(definition);
  const symbolId = "component-" + identity;
  copy.symbol.id = symbolId;
  if (copy.electrical) {
    copy.electrical.id = symbolId + "-electrical";
    copy.electrical.symbolId = symbolId;
  }
  if (copy.subcircuit) {
    copy.subcircuit.id = symbolId + "-interface";
    copy.subcircuit.symbolId = symbolId;
  }
  return ComponentDefinitionSchema.parse(copy);
}

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
  return componentDefinitionInsertRequest(entry.definition);
}
export function componentDefinitionInsertRequest(
  definition: ComponentDefinition,
): SymbolInsertRequest {
  return {
    kind: "symbol",
    symbolId: definition.symbol.id,
    symbolName: definition.symbol.name,
    componentDefinition: definition,
    parameters: sharedComponentNetlist(definition)?.parameters ?? {},
    initialRotation: 0,
    showReference: true,
    referenceText: null,
    showValue: false,
  };
}
