import { describe, expect, it } from "vitest";
import {
  compileNgspiceSourceSimulation,
  inspectSimulationSourceGraph,
} from "@icm/netlist";
import {
  serializeProject,
  parseProject,
  canonicalConnectionIndexes,
} from "@icm/project-protocol";
import {
  createSimulationExample,
  simulationExamples,
} from "./simulation-examples";

describe("simulation starter projects", () => {
  it.each(simulationExamples)(
    "imports and compiles every $name experiment",
    async (example) => {
      const before = JSON.stringify(example.source);
      const project = createSimulationExample(example.id);
      expect(project.simulationFolders.length).toBeGreaterThan(0);
      expect(
        canonicalConnectionIndexes(parseProject(serializeProject(project)))
          .documents,
      ).toEqual(canonicalConnectionIndexes(project).documents);
      for (const folder of project.simulationFolders) {
        const code = folder.input.files.find(
          (file) => file.path === folder.input.entry,
        )!.text;
        const comment = "*";
        expect(code).toContain(`${comment} 1.`);
        expect(code).toContain(`${comment} 2. Click Run.`);
        expect(code).toContain(`${comment} 3.`);
        expect(code).not.toContain("Native Code owns");
        const compiled = await compileNgspiceSourceSimulation(project, folder);
        expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
        if (!compiled.ok) continue;
        // Every saved top-level v(node) must belong to a node connected in the
        // compiled circuit or testbench (hierarchical subcircuit nodes like
        // xdut.tail are checked by their prefix instance name).
        const graph = inspectSimulationSourceGraph({
          ...folder.input,
          circuitBindings: [],
          files: compiled.files,
        });
        const instanceNodes = new Set<string>();
        const instanceNames = new Set<string>();
        for (const { statement } of graph.statements) {
          if (statement.kind !== "instance") continue;
          instanceNames.add(statement.name.toLowerCase());
          for (const node of statement.nodes)
            instanceNodes.add(node.toLowerCase());
        }
        for (const [, rawNode] of code.matchAll(
          /\bv\(\s*([A-Za-z_][\w.]*)\s*\)/giu,
        )) {
          const node = rawNode!.toLowerCase();
          if (node.includes(".")) {
            expect(
              instanceNames,
              `${example.name} / ${folder.name} saves hierarchical v(${rawNode})`,
            ).toContain(node.split(".")[0]);
          } else {
            expect(
              instanceNodes,
              `${example.name} / ${folder.name} saves v(${rawNode})`,
            ).toContain(node);
          }
        }
      }
      expect(JSON.stringify(example.source)).toBe(before);
      expect(createSimulationExample(example.id).id).not.toBe(project.id);
    },
  );
});
