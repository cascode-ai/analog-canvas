import { describe, expect, it } from "vitest";
import { createEmptyProject, flattenRichText, type Instance } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  displayableInstanceValue,
  instanceDisplayParameters,
} from "./instance-value.js";
import { defaultInstanceParameterLabelPlacement } from "./instance-label-placement.js";
import { resolveDocumentStyleProfile } from "./style-profile.js";

describe("model-owned value display", () => {
  it("keeps an existing bound MOS fraction and its single multiplier control", () => {
    const project = createEmptyProject("p", "MOS");
    project.externalSubcircuitDefinitions.push({
      id: "mos",
      name: "sky130_fd_pr__nfet_01v8",
      interfaceStatus: "declared",
      terminals: ["D", "G", "S", "B"].map((name) => ({
        id: name,
        name,
        direction: "passive" as const,
      })),
      formalParameters: [],
    });
    const parameters = { w: "2u", l: "150n", nf: "1", m: "4" };
    const instance: Instance = {
      id: "m",
      symbolId: "nmos",
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "mos" },
        parameters,
      },
    };
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    expect(displayableInstanceValue(instance, resolver)).toEqual(
      displayableInstanceValue({ symbolId: "nmos", netlist: { parameters } }),
    );
    expect(
      instanceDisplayParameters(instance, resolver).map((p) => p.name),
    ).toEqual(["m"]);
  });
  it.each([
    [
      "sky130_fd_pr__res_generic_po",
      "resistor",
      ["t1", "t2"],
      {},
      "W=1u L=43u",
    ],
    [
      "sky130_fd_pr__cap_mim_m3_1",
      "capacitor",
      ["C0", "C1"],
      { mf: "5" },
      "W=1u L=43u ×5",
    ],
    [
      "sky130_fd_pr__cap_var_lvt",
      "capacitor",
      ["C0", "C1", "B"],
      { vm: "3" },
      "W=1u L=43u ×3",
    ],
    ["rhigh", "resistor", ["1", "2", "bn"], { m: "4" }, "W=1u L=43u ×4"],
  ] as const)(
    "projects %s through the same model contract",
    (name, symbolId, terminals, count, expected) => {
      const project = createEmptyProject("p", "Models");
      project.externalSubcircuitDefinitions.push({
        id: "model",
        name,
        interfaceStatus: "declared",
        terminals: terminals.map((name) => ({
          id: name,
          name,
          direction: "passive" as const,
        })),
        formalParameters: [],
      });
      const instance: Instance = {
        id: "part",
        symbolId,
        placement: null,
        netlist: {
          binding: { kind: "external-subcircuit", definitionId: "model" },
          parameters: { w: "1u", l: "43u", ...count },
        },
      };
      const result = displayableInstanceValue(
        instance,
        createProjectSymbolResolver(project, builtInSymbols),
      );
      expect(result.kind).toBe("displayable");
      if (result.kind === "displayable")
        expect(flattenRichText(result.content)).toBe(expected);
      expect(displayableInstanceValue(instance).kind).toBe("undisplayable");
    },
  );

  it("does not infer a summary from a custom model's artwork or substitute placeholders", () => {
    const project = createEmptyProject("p", "Custom");
    project.externalSubcircuitDefinitions.push({
      id: "custom",
      name: "custom_R",
      interfaceStatus: "declared",
      terminals: [],
      formalParameters: [{ name: "SIZE", defaultValue: "7" }],
    });
    const instance: Instance = {
      id: "r",
      symbolId: "resistor",
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "custom" },
        parameters: { SIZE: "{size}", value: "10k" },
      },
    };
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    expect(displayableInstanceValue(instance, resolver).kind).toBe(
      "undisplayable",
    );
    expect(
      instanceDisplayParameters(instance, resolver).map((p) => p.name),
    ).toEqual(["SIZE"]);
    expect(
      displayableInstanceValue(
        { symbolId: "resistor", netlist: { parameters: {} } },
        resolver,
      ).kind,
    ).toBe("undisplayable");
  });

  it("shows the bound resistor's geometry rather than the ideal symbol's value", () => {
    const project = createEmptyProject("p", "Geometry");
    project.externalSubcircuitDefinitions.push({
      id: "poly",
      name: "sky130_fd_pr__res_high_po",
      interfaceStatus: "declared",
      terminals: ["R0", "R1", "B"].map((name) => ({
        id: name,
        name,
        direction: "passive" as const,
      })),
      formalParameters: [],
    });
    const instance: Instance = {
      id: "r",
      reference: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "poly" },
        parameters: { w: "1u", l: "43u", mult: "2" },
      },
    };
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const display = displayableInstanceValue(instance, resolver);
    expect(display.kind).toBe("displayable");
    if (display.kind === "displayable")
      expect(flattenRichText(display.content)).toBe("W=1u L=43u ×2");
    expect(
      instanceDisplayParameters(instance, resolver).map((p) => p.name),
    ).toEqual(["w", "l", "mult"]);
    instance.placement = {
      position: { x: 100, y: 100 },
      rotation: 0,
      mirror: "none",
    };
    const placements = ["w", "l", "mult"].map((name) =>
      defaultInstanceParameterLabelPlacement(
        instance,
        resolver.resolve("resistor")!,
        resolveDocumentStyleProfile(project.documents[0]!.presentation),
        10,
        name,
        resolver,
      ),
    );
    expect(placements.every(Boolean)).toBe(true);
    expect(new Set(placements.map((p) => p?.position.y)).size).toBe(3);
  });
});
