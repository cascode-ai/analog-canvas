import { describe, expect, it } from "vitest";
import { compileSourceSimulation } from "@icm/netlist";
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
        const comment = "//";
        expect(code).toContain(`${comment} 1.`);
        expect(code).toContain(`${comment} 2. Click Run.`);
        expect(code).toContain(`${comment} 3.`);
        expect(code).not.toContain("Native Code owns");
        const compiled = await compileSourceSimulation(project, folder);
        expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
        if (!compiled.ok) continue;
        // A saved node must be one the compiled circuit or the testbench
        // actually connects: with strictsave=2 an unknown name fails the run,
        // and an unnamed Canvas Net's printed name can change under it.
        const instanceNodes = new Set(
          [code, ...compiled.generated.map((file) => file.text)]
            .join("\n")
            .split("\n")
            .flatMap((line) => {
              const card = /^\s*[A-Za-z_]\w*\s*\(([^()]*)\)/u.exec(line);
              return card ? card[1]!.split(/\s+/u).filter(Boolean) : [];
            }),
        );
        for (const [, node] of code.matchAll(
          /\bv\(\s*([A-Za-z_][\w.]*)\s*\)/gu,
        ))
          expect(
            instanceNodes,
            `${example.name} / ${folder.name} saves v(${node})`,
          ).toContain(node);
      }
      expect(JSON.stringify(example.source)).toBe(before);
      expect(createSimulationExample(example.id).id).not.toBe(project.id);
    },
  );
});
