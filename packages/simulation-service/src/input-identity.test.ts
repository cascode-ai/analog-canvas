import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
import { ProjectInputIdentity } from "./input-identity.js";

describe("Project input identity", () => {
  it("reuses a revision and recognizes raw inputs with resolved dependencies", async () => {
    const project = createEmptyProject("p", "test");
    project.simulationFolders.push({
      id: "s",
      name: "Raw",
      version: 4,
      input: {
        kind: "source",
        entry: "tb.cir",
        configPath: "experiment.json",
        circuitBindings: [],
        files: [
          { path: "tb.cir", text: "title\n.end" },
          {
            path: "experiment.json",
            text: JSON.stringify({
              version: 1,
              environment: { profileId: "local" },
            }),
          },
        ],
        dependencies: [
          { id: "models", mountPath: "models.lib", sha256: "a".repeat(64) },
        ],
      },
    });
    const cache = new ProjectInputIdentity();
    const first = cache.read(project, "s");
    expect(cache.read(project, "s")).toBe(first);
    const hash = await first;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    project.structureRevision++;
    expect(await cache.read(project, "s")).toBe(hash);
    const input = project.simulationFolders[0]!.input;
    input.files[0]!.text += "\n* changed";
    project.structureRevision++;
    expect(await cache.read(project, "s")).not.toBe(hash);
    project.simulationFolders = [];
    project.structureRevision++;
    expect(await cache.read(project, "s")).toBeNull();
  });
  it("invalidates on a Document-only parameter edit, while layout leaves electrical identity unchanged", async () => {
    const project = parseProject(JSON.stringify(ota));
    const cache = new ProjectInputIdentity(),
      id = project.simulationFolders[0]!.id;
    const before = await cache.read(project, id);
    expect(before).toMatch(/^[a-f0-9]{64}$/u);
    const document = project.documents.find((d) =>
      d.instances.some((i) => i.netlist?.parameters.w),
    )!;
    const instance = document.instances.find((i) => i.netlist?.parameters.w)!;
    instance.placement!.position.x += 10;
    document.revision++;
    expect(await cache.read(project, id)).toBe(before);
    instance.netlist!.parameters.w = "8u";
    document.revision++;
    expect(await cache.read(project, id)).not.toBe(before);
  });
});
