import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { ProjectInputIdentity } from "./input-identity.js";

describe("Project input identity", () => {
  it("reuses a revision and recognizes raw inputs with resolved dependencies", async () => {
    const project = createEmptyProject("p", "test");
    project.simulationSetups.push({
      id: "s",
      name: "Raw",
      version: 2,
      input: {
        kind: "raw",
        entry: "tb.cir",
        files: [{ path: "tb.cir", text: "title\n.end" }],
        dependencies: [
          { id: "models", mountPath: "models.lib", sha256: "a".repeat(64) },
        ],
        environment: { profileId: "local" },
      },
    });
    const cache = new ProjectInputIdentity();
    const first = cache.read(project, "s");
    expect(cache.read(project, "s")).toBe(first);
    const hash = await first;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    project.structureRevision++;
    expect(await cache.read(project, "s")).toBe(hash);
    const input = project.simulationSetups[0]!.input;
    if (input.kind !== "raw") throw Error("fixture");
    input.files[0]!.text += "\n* changed";
    project.structureRevision++;
    expect(await cache.read(project, "s")).not.toBe(hash);
    project.simulationSetups = [];
    project.structureRevision++;
    expect(await cache.read(project, "s")).toBeNull();
  });
});
