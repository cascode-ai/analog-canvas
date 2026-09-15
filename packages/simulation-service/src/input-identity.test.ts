import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
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
          { path: "tb.cir", text: "title\nparameters BIAS=1\ncontrol\nendc\n" },
          {
            path: "experiment.json",
            text: JSON.stringify({
              version: 2,
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
    const variable = { variables: [{ variableId: "BIAS", value: "2" }] };
    const varied = await cache.read(project, "s", variable);
    expect(varied).toMatch(/^[a-f0-9]{64}$/);
    expect(varied).not.toBe(hash);
    expect(await cache.read(project, "s", variable)).toBe(varied);
    project.structureRevision++;
    expect(await cache.read(project, "s")).toBe(hash);
    const input = project.simulationFolders[0]!.input;
    input.files[0]!.text += "\n// changed";
    project.structureRevision++;
    expect(await cache.read(project, "s")).not.toBe(hash);
    project.simulationFolders = [];
    project.structureRevision++;
    expect(await cache.read(project, "s")).toBeNull();
  });
  it("invalidates on a Document-only parameter edit, while layout leaves electrical identity unchanged", async () => {
    const project = parseProject(JSON.stringify(ota));
    project.simulationFolders = [
      createSimulationFolder({
        id: "native",
        name: "Native",
        profileId: "local",
        documentId: project.topDocumentId,
      }),
    ];
    const cache = new ProjectInputIdentity(),
      id = project.simulationFolders[0]!.id;
    const before = await cache.read(project, id);
    expect(before).toMatch(/^[a-f0-9]{64}$/u);
    const document = project.documents.find((d) =>
      d.instances.some((i) => i.netlist?.parameters.w),
    )!;
    const instance = document.instances.find((i) => i.netlist?.parameters.w)!;
    const variant = {
      parameters: [
        {
          documentId: document.id,
          instanceId: instance.id,
          parameter: "w",
          value: "12u",
        },
      ],
    };
    const pointPromise = cache.read(project, id, variant);
    expect(cache.read(project, id, variant)).toBe(pointPromise);
    const point = await pointPromise;
    expect(point).toMatch(/^[a-f0-9]{64}$/u);
    expect(point).not.toBe(before);
    const corner = { ...variant, environment: { corner: "ff" } };
    const cornerHash = await cache.read(project, id, corner);
    expect(cornerHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(cornerHash).not.toBe(point);
    expect(await cache.read(project, id, corner)).toBe(cornerHash);
    const hot = {
      ...corner,
      environment: { ...corner.environment, temperatureC: 125 },
    };
    const hotHash = await cache.read(project, id, hot);
    expect(hotHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hotHash).not.toBe(cornerHash);
    expect(await cache.read(project, id, hot)).toBe(hotHash);
    expect(await cache.read(project, id)).toBe(before);
    instance.placement!.position.x += 10;
    document.revision++;
    expect(await cache.read(project, id)).toBe(before);
    expect(await cache.read(project, id, variant)).toBe(point);
    instance.netlist!.parameters.w = "8u";
    document.revision++;
    expect(await cache.read(project, id)).not.toBe(before);
    // The same run point still overrides this nominal edit; it does not inherit
    // another member's cached identity or become stale from an irrelevant value.
    expect(await cache.read(project, id, variant)).toBe(point);
    const invalid = {
      parameters: [{ ...variant.parameters[0]!, instanceId: "missing" }],
    };
    expect(await cache.read(project, id, invalid)).toBeNull();
  });
});
