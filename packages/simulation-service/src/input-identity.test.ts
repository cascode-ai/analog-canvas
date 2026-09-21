import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import ota from "../../../netlists/native-ota-library/legacy-source.icproj.json";
import { ProjectInputIdentity, sourceInputRevision } from "./input-identity.js";
import { compileNgspiceSourceSimulation } from "@icm/netlist";

describe("Project input identity", () => {
  it("does not treat object key order as an authored input change", async () => {
    const project = createEmptyProject("ordered", "Stable identity");
    const folder = createSimulationFolder({
      id: "ordered-source",
      name: "Ordered source",
      profileId: "ngspice-test",
    });
    folder.input.circuitBindings = [];
    folder.input.entry = "ordered.cir";
    folder.input.files = [
      {
        path: folder.input.configPath,
        text: JSON.stringify({
          version: 2,
          environment: { profileId: "ngspice-test" },
        }),
      },
      {
        path: "ordered.cir",
        text: "Ordered\nV1 in 0 1\n.control\nop\n.endc\n.end\n",
      },
    ];
    project.simulationFolders = [folder];
    const prepared = compileNgspiceSourceSimulation(project, folder);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));

    const reordered = structuredClone(folder);
    reordered.input = {
      dependencies: [...reordered.input.dependencies],
      files: reordered.input.files.map(({ path, text }) => ({ text, path })),
      circuitBindings: [...reordered.input.circuitBindings],
      configPath: reordered.input.configPath,
      entry: reordered.input.entry,
      kind: reordered.input.kind,
    };

    expect(await sourceInputRevision(reordered, prepared)).toBe(
      await sourceInputRevision(folder, prepared),
    );
  });

  it("compares an ngspice run against the same compiler used by its captured Prepare", async () => {
    const project = createEmptyProject("dual", "Dual engine identity");
    const folder = createSimulationFolder({
      id: "ng",
      name: "Divider",
      profileId: "ngspice-test",
    });
    folder.input.circuitBindings = [];
    folder.input.entry = "divider.cir";
    folder.input.files = [
      {
        path: folder.input.configPath,
        text: JSON.stringify({
          version: 2,
          environment: { profileId: "ngspice-test" },
        }),
      },
      {
        path: "divider.cir",
        text: "Divider\nV1 in 0 1\nR1 in mid 1k\nR2 mid 0 1k\n.control\nop\nwrite out.raw all\n.endc\n.end\n",
      },
    ];
    project.simulationFolders = [folder];
    const prepared = compileNgspiceSourceSimulation(project, folder);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(JSON.stringify(prepared));
    const cache = new ProjectInputIdentity();
    const capturedRevision = await sourceInputRevision(folder, prepared);
    await cache.read(project, folder.id, undefined, "vacask");
    expect(await cache.read(project, folder.id, undefined, "ngspice")).toBe(
      capturedRevision,
    );
    folder.input.files[1]!.text = folder.input.files[1]!.text.replace(
      "R2 mid 0 1k",
      "R2 mid 0 2k",
    );
    project.structureRevision++;
    expect(await cache.read(project, folder.id, undefined, "ngspice")).not.toBe(
      capturedRevision,
    );
  });
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
