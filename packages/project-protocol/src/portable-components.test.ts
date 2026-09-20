import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyProject, CircuitProjectSchema } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { renderDocumentSvg } from "@icm/render-svg";
import { analyzeDesignNetlist } from "@icm/netlist";
import { parseProject, serializeProject } from "./index.js";

describe("portable Project definitions", () => {
  it("preserves exact artwork and electrical contracts without the site library", () => {
    const project = parseProject(
      readFileSync(
        "fixtures/projects/differential-stage/project.icproj.json",
        "utf8",
      ),
    );
    const before = renderDocumentSvg(
      project.documents[0]!,
      createProjectSymbolResolver(project, builtInSymbols),
    );
    const source = serializeProject(project);
    const loaded = parseProject(source);
    expect(
      renderDocumentSvg(
        loaded.documents[0]!,
        createProjectSymbolResolver(loaded, []),
      ),
    ).toBe(before);
    expect(analyzeDesignNetlist(loaded)).toEqual(analyzeDesignNetlist(project));
    expect(serializeProject(loaded)).toBe(source);
  });

  it("customizes a copied class and uses its pin order in the exported circuit", () => {
    const project = createEmptyProject("custom", "Custom");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    document.nets.push(
      { id: "in", terminals: [{ instanceId: "R1", pinName: "1" }] },
      { id: "out", terminals: [{ instanceId: "R1", pinName: "2" }] },
    );
    const saved = parseProject(serializeProject(project));
    const definition = saved.componentDefinitions![0]!;
    definition.symbol.id = "my-resistor";
    definition.symbol.primitives = [
      { kind: "circle", center: { x: 0, y: 0 }, radius: 8 },
    ];
    definition.electrical!.symbolId = "my-resistor";
    definition.electrical!.pinOrder = ["2", "1"];
    saved.documents[0]!.instances[0]!.symbolId = "my-resistor";
    const customized = parseProject(serializeProject(saved));
    expect(
      createProjectSymbolResolver(customized, []).resolve("my-resistor")!
        .definition.primitives,
    ).toEqual(definition.symbol.primitives);
    const normal = analyzeDesignNetlist(project);
    const custom = analyzeDesignNetlist(customized);
    expect(normal.ir, JSON.stringify(normal.diagnostics)).not.toBeNull();
    expect(custom.ir, JSON.stringify(custom.diagnostics)).not.toBeNull();
    expect(
      custom.ir!.cells[0]!.instances[0]!.nodes.map((node) => node.pinName),
    ).toEqual(["2", "1"]);
  });

  it("rejects duplicate classes and mismatched visual/electrical identities", () => {
    const project = parseProject(
      readFileSync(
        "fixtures/projects/differential-stage/project.icproj.json",
        "utf8",
      ),
    );
    const duplicate = structuredClone(project);
    duplicate.componentDefinitions!.push(duplicate.componentDefinitions![0]!);
    expect(() => CircuitProjectSchema.parse(duplicate)).toThrow(
      "Duplicate local component",
    );
    const incomplete = structuredClone(project);
    incomplete.componentDefinitions!.pop();
    expect(() => parseProject(JSON.stringify(incomplete))).toThrow(
      "Missing included component",
    );
    project.componentDefinitions!.find(
      (definition) => definition.electrical,
    )!.electrical!.symbolId = "something-else";
    expect(() => parseProject(JSON.stringify(project))).toThrow(
      "identities must agree",
    );
  });
});
