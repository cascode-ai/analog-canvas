import { describe, expect, it } from "vitest";
import { createEmptyDocument, type Instance } from "@icm/model";
import {
  symbolCarriesReference,
  symbolSupportsValueAnnotation,
} from "@icm/derived";
import { expandedDeviceSymbols, razaviProductSymbols } from "@icm/symbols";

import {
  componentParameters,
  initialComponentParameterValues,
} from "../component-insert/component-parameters";
import {
  initialInstanceNetlist,
  nextInstanceReference,
} from "../netlist-export/netlist-authoring";
import {
  formatComponentPropertyCode,
  parseComponentPropertyCode,
} from "./component-property-code";

import { itemPropertyCode } from "./item-property-code";

// Own the exhaustive data boundary here; browser tests cover representative
// UI capabilities, with hierarchy/property-terminal workflows in their own specs.
describe("placeable catalog property code", () => {
  it.each([...razaviProductSymbols, ...expandedDeviceSymbols])(
    "$id exposes valid editable placement and preserves its initial parameters",
    (symbol) => {
      const document = createEmptyDocument("catalog", "Catalog");
      const reference = nextInstanceReference(document, symbol.id);
      const netlist = initialInstanceNetlist(
        symbol.id,
        initialComponentParameterValues(symbol.id),
      );
      const instance: Instance = {
        id: "placed",
        symbolId: symbol.id,
        ...(reference ? { reference } : {}),
        ...(netlist ? { netlist } : {}),
        placement: {
          position: { x: 200, y: 160 },
          rotation: 0,
          mirror: "none",
        },
      };
      const context = {
        instance,
        referenceVisible: symbolCarriesReference(symbol.id) ? true : null,
        valueVisible: symbolSupportsValueAnnotation(symbol.id) ? true : null,
        ...(symbol.id === "vdd-port"
          ? { connection: "cell-pin" as const, netName: "VDD" }
          : {}),
        details: {
          parameters: componentParameters(symbol.id),
          signalFlow: Boolean(symbol.formulaPresentation),
        },
      };
      const source = formatComponentPropertyCode(context);
      const parsed = parseComponentPropertyCode(source, context);
      expect(parsed).toMatchObject({ ok: true });
      if (!parsed.ok) return;
      expect(parsed.value.placement).toEqual({
        coordinate: [200, 160],
        rotation: 0,
        mirror: "none",
      });
      if (netlist)
        expect(parsed.value.parameters).toMatchObject(netlist.parameters);
      if (reference) expect(parsed.value.netlistName).toBe(reference);

      const projection = itemPropertyCode(source, {
        type: symbol.id,
        name: reference ?? "placed",
        ...(reference ? { namePath: "netlistName" } : {}),
      });
      const publicCode = JSON.parse(projection.format(source));
      expect(Object.keys(publicCode).slice(0, 6)).toEqual([
        "type",
        "name",
        "coordinate",
        "rotation",
        "mirror",
        "color",
      ]);
      publicCode.coordinate = [320, 240];
      publicCode.rotation = 90;
      publicCode.mirror = "horizontal";
      publicCode.color = [200, 30, 40];
      expect(
        projection.parse(JSON.stringify(publicCode), (text) =>
          parseComponentPropertyCode(text, context),
        ),
      ).toMatchObject({
        ok: true,
        value: {
          placement: {
            coordinate: [320, 240],
            rotation: 90,
            mirror: "horizontal",
          },
          appearance: { color: "#c81e28" },
        },
      });
      const edited = JSON.parse(source);
      edited.placement.coordinate = [320, 240];
      edited.placement.rotation = 90;
      expect(
        parseComponentPropertyCode(JSON.stringify(edited), context),
      ).toMatchObject({
        ok: true,
        value: {
          placement: { coordinate: [320, 240], rotation: 90 },
          ...(netlist ? { parameters: netlist.parameters } : {}),
        },
      });
    },
  );
});
