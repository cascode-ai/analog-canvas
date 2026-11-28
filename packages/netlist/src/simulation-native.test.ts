import {
  createEmptyProject,
  createSimulationFolder,
  readSimulationExperimentConfig,
  NativeSimulationExperimentConfigSchema,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { compileNgspiceSourceSimulation } from "./simulation-source-ngspice.js";
import { nativeSourceCollection } from "./simulation-native-collection.js";
import { inspectSimulationSourceGraph } from "./simulation-source-graph.js";
import { migrateSimulationConfigToNative } from "./simulation-native-migration.js";

function fixture(program: string) {
  const project = createEmptyProject("native", "Native");
  const folder = createSimulationFolder({
    id: "native",
    name: "Native",
    profileId: "test",
  });
  folder.input.files.find((f) => f.path === folder.input.entry)!.text =
    `Native\n.param RVAL=1k\nV1 in 0 1\nR1 in 0 {RVAL}\n.control\nset filetype=ascii\n${program}\n.endc\n.end\n`;
  return { project, folder };
}

describe("Code is the experiment authority", () => {
  it("explicitly converts safe legacy metadata and retains unsupported intent without data loss", () => {
    const { project, folder } = fixture("op\nwrite out.raw");
    const file = folder.input.files.find(
      (f) => f.path === folder.input.configPath,
    )!;
    file.text = JSON.stringify({
      version: 1,
      environment: { profileId: "test" },
      collection: { rawfile: null },
    });
    const original = JSON.stringify(folder);
    const converted = migrateSimulationConfigToNative(project, folder);
    expect(
      converted.ok && readSimulationExperimentConfig(converted.folder),
    ).toMatchObject({ ok: true, authority: "code" });
    expect(JSON.stringify(folder)).toBe(original);
    file.text = JSON.stringify({
      version: 1,
      environment: { profileId: "test" },
      collection: { rawfile: "result.raw" },
    });
    const collectionBefore = structuredClone(folder);
    expect(migrateSimulationConfigToNative(project, folder)).toMatchObject({
      ok: false,
      message: expect.stringContaining("collection.rawfile"),
    });
    expect(folder).toEqual(collectionBefore);
    file.text = JSON.stringify({
      version: 1,
      environment: { profileId: "test" },
      runPlan: {
        mode: "sweep",
        axes: [{ kind: "temperature", values: [0, 27] }],
      },
    });
    const blocked = JSON.stringify(folder);
    expect(migrateSimulationConfigToNative(project, folder)).toMatchObject({
      ok: false,
    });
    expect(JSON.stringify(folder)).toBe(blocked);
  });
  it("creates no electrical sidecar fields and rejects adding a second authority", () => {
    const { folder } = fixture("op\nwrite out.raw");
    const config = JSON.parse(
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text,
    );
    expect(config).toEqual({ version: 2, environment: { profileId: "test" } });
    for (const field of [
      "variables",
      "outputs",
      "deviceOperatingPoints",
      "measurements",
      "runPlan",
      "collection",
    ])
      expect(
        NativeSimulationExperimentConfigSchema.safeParse({
          ...config,
          [field]: [],
        }).success,
      ).toBe(false);
    expect(readSimulationExperimentConfig(folder)).toMatchObject({
      ok: true,
      authority: "code",
    });
  });
  it("retains analysis/save/parameter changes in source with declared rawfile collection", () => {
    const { project, folder } = fixture("save v(in)\nop\nwrite out.raw");
    const before = folder.input.files.find(
      (f) => f.path === folder.input.configPath,
    )!.text;
    const compiled = compileNgspiceSourceSimulation(project, folder);
    expect(compiled).toMatchObject({
      ok: true,
      authority: "code",
      config: {
        collection: { rawfile: "out.raw" },
        outputs: [],
        variables: [],
      },
    });
    const entry = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    )!;
    entry.text = entry.text
      .replace("RVAL=1k", "RVAL=2k")
      .replace("save v(in)", "save i(V1)");
    const changed = compileNgspiceSourceSimulation(project, folder);
    expect(changed).toMatchObject({
      ok: true,
      config: { collection: { rawfile: "out.raw" } },
    });
    if (changed.ok)
      expect(changed.files.find((f) => f.path === entry.path)!.text).toBe(
        entry.text,
      );
    expect(
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text,
    ).toBe(before);
  });
  it.each(["write $target", "write one.raw\nwrite two.raw"])(
    "retains the collector's rejection boundary: %s",
    (program) => {
      const { folder } = fixture(program);
      expect(
        nativeSourceCollection(inspectSimulationSourceGraph(folder.input))
          .diagnostics.length,
      ).toBeGreaterThan(0);
    },
  );
  it("permits console-only programs without inventing out.raw", () => {
    const { project, folder } = fixture("op");
    expect(compileNgspiceSourceSimulation(project, folder)).toMatchObject({
      ok: true,
      config: { collection: { rawfile: null } },
    });
  });
});
