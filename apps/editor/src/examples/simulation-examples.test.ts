import { describe, expect, it } from "vitest";
import { compileSourceSimulation } from "@icm/netlist";
import { serializeProject, parseProject } from "@icm/project-protocol";
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
      expect(parseProject(serializeProject(project)).documents).toEqual(
        project.documents,
      );
      for (const folder of project.simulationFolders) {
        const code = folder.input.files.find(
          (file) => file.path === folder.input.entry,
        )!.text;
        const comment = ["rc", "rlc"].includes(example.id) ? "//" : "*";
        expect(code).toContain(`${comment} 1.`);
        expect(code).toContain(`${comment} 2. Click Run.`);
        expect(code).toContain(`${comment} 3.`);
        expect(code).not.toContain("Native Code owns");
        const compiled = await compileSourceSimulation(project, folder);
        expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
      }
      expect(JSON.stringify(example.source)).toBe(before);
      expect(createSimulationExample(example.id).id).not.toBe(project.id);
    },
  );
});
