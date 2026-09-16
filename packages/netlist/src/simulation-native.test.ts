import {
  createEmptyProject,
  createSimulationFolder,
  readSimulationExperimentConfig,
  NativeSimulationExperimentConfigSchema,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { compileSourceSimulation } from "./simulation-source-compile.js";
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
    `Native\nparameters RVAL=1k\nmodel voltage vsource\nmodel resistance resistor\nV1 (In 0) voltage dc=1\nR1 (In 0) resistance r=RVAL\ncontrol\noptions rawfile="ascii"\n${program}\nendc\n`;
  return { project, folder };
}

describe("native Code is the experiment authority", () => {
  it("explicitly converts safe legacy metadata and retains unsupported intent without data loss", () => {
    const { project, folder } = fixture("analysis result op");
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
      message: expect.stringContaining("single declared write path"),
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
    const { folder } = fixture("analysis result op");
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
  it("retains native analysis/save/parameter changes in source without a single-file collection setting", () => {
    const { project, folder } = fixture("save v(In)\nanalysis result op");
    const before = folder.input.files.find(
      (f) => f.path === folder.input.configPath,
    )!.text;
    const compiled = compileSourceSimulation(project, folder);
    expect(compiled).toMatchObject({
      ok: true,
      authority: "code",
      config: {
        collection: { rawfile: null },
        outputs: [],
        variables: [],
      },
    });
    const entry = folder.input.files.find(
      (f) => f.path === folder.input.entry,
    )!;
    entry.text = entry.text
      .replace("RVAL=1k", "RVAL=2k")
      .replace("analysis result op", "analysis changed op")
      .replace("save v(In)", "save i(V1)");
    const changed = compileSourceSimulation(project, folder);
    expect(changed).toMatchObject({
      ok: true,
      config: { collection: { rawfile: null } },
    });
    if (changed.ok)
      expect(changed.files.find((f) => f.path === entry.path)!.text).toBe(
        entry.text,
      );
    expect(
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text,
    ).toBe(before);
  });
  it("does not split nested native sweeps or persist a parallel JSON sweep plan", () => {
    const { project, folder } = fixture(
      'sweep resistance instance="R1" parameter="r" values=[1k, 2k]\nsweep voltage instance="V1" parameter="dc" values=[1, 2]\nanalysis result op',
    );
    expect(compileSourceSimulation(project, folder)).toMatchObject({
      ok: true,
    });
    expect(
      compileSourceSimulation(project, folder, {
        variables: [{ variableId: "x", value: "2k" }],
      }),
    ).toMatchObject({ ok: false });
  });
  it.each(["write $target", "write one.raw\nwrite two.raw"])(
    "retains the old collector's rejection boundary until its remaining callers retire: %s",
    (program) => {
      const { folder } = fixture(program);
      folder.input.files.find((f) => f.path === folder.input.entry)!.text =
        `Legacy collector\n.control\n${program}\n.endc\n.end\n`;
      expect(
        nativeSourceCollection(inspectSimulationSourceGraph(folder.input))
          .diagnostics.length,
      ).toBeGreaterThan(0);
    },
  );
  it("permits console-only native programs without inventing out.raw", () => {
    const { project, folder } = fixture("analysis bias op write=0");
    expect(compileSourceSimulation(project, folder)).toMatchObject({
      ok: true,
      config: { collection: { rawfile: null } },
    });
  });
});
