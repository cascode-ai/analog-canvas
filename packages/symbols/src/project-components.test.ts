import { describe, expect, it } from "vitest";
import {
  ComponentDefinitionSchema,
  createEmptyProject,
  createEmptyDocument,
} from "@icm/model";
import { deviceDescriptor, subcircuitDescriptor } from "@icm/devices";
import { builtInSymbols } from "./builtins.js";
import { createProjectSymbolResolver } from "./resolver.js";
import { withProjectComponentDefinitions } from "./project-components.js";
import { hierarchicalSymbolId } from "./hierarchical-block.js";

function sample() {
  const project = createEmptyProject("portable", "Portable");
  project.documents[0]!.instances.push(
    ...["R1", "R2"].map((id) => ({
      id,
      symbolId: "resistor",
      placement: null,
    })),
  );
  const child = createEmptyDocument("child", "Child");
  child.instances.push({ id: "C1", symbolId: "capacitor", placement: null });
  project.documents.push(child);
  return project;
}

describe("Project component classes", () => {
  it("keeps generated artwork until the child interface or presentation changes", () => {
    const source = sample();
    const child = source.documents[1]!;
    child.netlist = { name: "child", terminals: [], formalParameters: [] };
    const id = hierarchicalSymbolId("child");
    source.documents[0]!.instances.push({
      id: "X1",
      symbolId: id,
      placement: null,
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: child.id },
        parameters: {},
      },
    });
    const project = withProjectComponentDefinitions(source);
    const definition = project.componentDefinitions!.find(
      (item) => item.symbol.id === id,
    )!;
    definition.symbol.primitives.push({
      kind: "circle",
      center: { x: 0, y: 0 },
      radius: 7,
    });
    expect(
      createProjectSymbolResolver(project, []).resolve(id)!.definition
        .primitives,
    ).toEqual(definition.symbol.primitives);
    project.documents[1]!.presentation.cellSymbol = {
      minimumBodySize: { width: 180, height: 100 },
    };
    const updated = withProjectComponentDefinitions(project);
    expect(
      updated.componentDefinitions!.find((item) => item.symbol.id === id)!
        .symbol.viewBox.width,
    ).toBeGreaterThan(definition.symbol.viewBox.width);
  });
  it("validates every built-in visual/electrical definition without dropping attributes", () => {
    for (const symbol of builtInSymbols) {
      const electrical = deviceDescriptor(symbol.id);
      const subcircuit = subcircuitDescriptor(symbol.id);
      const definition = {
        symbol,
        ...(electrical ? { electrical } : {}),
        ...(subcircuit ? { subcircuit } : {}),
      };
      expect(ComponentDefinitionSchema.parse(definition)).toEqual(definition);
    }
  });

  it("shares definitions, includes children and removes only unreferenced classes", () => {
    const project = withProjectComponentDefinitions(sample());
    expect(
      project.componentDefinitions!.map((definition) => definition.symbol.id),
    ).toEqual(["capacitor", "resistor"]);
    project.documents[0]!.instances.pop();
    expect(
      withProjectComponentDefinitions(project).componentDefinitions,
    ).toHaveLength(2);
    project.documents[0]!.instances.pop();
    expect(
      withProjectComponentDefinitions(project).componentDefinitions!.map(
        (definition) => definition.symbol.id,
      ),
    ).toEqual(["capacitor"]);
    expect(project.documents).toHaveLength(2);
    project.documents[1]!.instances.length = 0;
    expect(
      withProjectComponentDefinitions(project).componentDefinitions,
    ).toBeUndefined();
  });

  it("loads custom geometry without any website library ", () => {
    const project = withProjectComponentDefinitions(sample());
    const resistor = project.componentDefinitions!.find(
      (definition) => definition.symbol.id === "resistor",
    )!;
    resistor.symbol.primitives = [
      { kind: "circle", center: { x: 0, y: 0 }, radius: 9 },
    ];
    const resolver = createProjectSymbolResolver(project, []);
    expect(resolver.resolve("resistor")!.definition.primitives).toEqual(
      resistor.symbol.primitives,
    );
  });

  it("includes a floating symbol but rejects an ambiguous electrical pin mapping", () => {
    const project = createEmptyProject("floating", "Floating");
    project.documents[0]!.drafting!.objects.push({
      id: "floating",
      kind: "floating-symbol",
      symbolId: "resistor",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      transform: { rotation: 0, mirror: "none" },
    });
    const definition =
      withProjectComponentDefinitions(project).componentDefinitions![0]!;
    expect(definition.symbol.id).toBe("resistor");
    definition.electrical!.pinOrder = ["1", "1"];
    expect(() => ComponentDefinitionSchema.parse(definition)).toThrow(
      "exactly once",
    );
  });
});
