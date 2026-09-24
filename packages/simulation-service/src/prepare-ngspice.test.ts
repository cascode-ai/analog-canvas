import { describe, expect, it } from "vitest";
import { CircuitProjectSchema, createSimulationFolder } from "@icm/model";
import { currentFiveTransistorOtaCircuitSource } from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { locateSimulationText } from "@icm/netlist";
import { CapabilitiesSchema } from "./contract.js";
import { ProjectInputIdentity } from "./input-identity.js";
import { prepareNgspiceExecutionInput } from "./prepare-ngspice.js";

function nativeSweepFixture() {
  const project = CircuitProjectSchema.parse(
    currentFiveTransistorOtaCircuitSource(),
  );
  const folder = createSimulationFolder({
    id: "native-sweep",
    name: "Native sweep",
    profileId: "ngspice",
    engine: "ngspice",
    documentId: project.topDocumentId,
  });
  folder.input.dependencies = [
    { id: "models", sha256: "a".repeat(64), mountPath: "models.lib" },
  ];
  const entry = folder.input.files.find(
    (file) => file.path === folder.input.entry,
  )!;
  entry.text = entry.text.replace(
    '.include "circuit.spice"',
    '.temp 27\n.lib "models.lib" ss\n.param BIAS=0.9\n.include "circuit.spice"',
  );
  project.simulationFolders = [folder];
  const caps = CapabilitiesSchema.parse({
    configured: true,
    rawfileCollection: "declared-single-ascii",
    inputs: ["source"],
    analyses: ["op"],
    parsedAnalyses: ["op"],
    profiles: [
      {
        id: "ngspice",
        corners: ["tt", "ff", "ss"],
        dependencies: [{ id: "models", sha256: "a".repeat(64) }],
      },
    ],
    modelLibrary: { path: "models.lib", section: "tt" },
    maxInputBytes: 2 * 1024 * 1024,
    maxOutputBytes: 1024 * 1024,
    maxTimeoutMs: 15000,
    cancel: true,
  });
  return { project, folder, entry, caps };
}

describe("ngspice authored input identity", () => {
  it("projects native corner, temperature and exact Canvas parameters into one immutable run", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    const document = project.documents.find((item) =>
      item.instances.some((instance) => instance.netlist?.parameters.w),
    )!;
    const instance = document.instances.find(
      (item) => item.netlist?.parameters.w,
    )!;
    const before = structuredClone(project);
    const nominal = await prepareNgspiceExecutionInput(project, folder, caps);
    const variant = {
      environment: { corner: "ff", temperatureC: 125 },
      parameters: [
        {
          documentId: document.id,
          instanceId: instance.id,
          parameter: "w",
          value: "33u",
        },
      ],
    };
    const point = await prepareNgspiceExecutionInput(
      project,
      folder,
      caps,
      variant,
    );
    if (!nominal.ok || !point.ok)
      throw Error(JSON.stringify({ nominal, point }));
    expect(nominal.input.environment.corner).toBe("ss");
    expect(point.input.environment).toMatchObject({
      corner: "ff",
      temperatureC: 125,
    });
    const text = point.input.files.find(
      (file) => file.path === entry.path,
    )!.text;
    expect(text).toContain('.lib "models.lib" ff');
    expect(text).toContain(".temp 125");
    expect(text).not.toContain('.lib "models.lib" ss');
    expect(point.generated.map((file) => file.text).join("\n")).toContain(
      "w=33",
    );
    expect(point.input.inputRevision).not.toBe(nominal.input.inputRevision);
    expect(point.digest).not.toBe(nominal.digest);
    expect(
      await new ProjectInputIdentity().read(
        project,
        folder.id,
        variant,
        "ngspice",
      ),
    ).toBe(point.input.inputRevision);
    const map = point.sourceMaps.find((item) => item.path === entry.path)!;
    expect(locateSimulationText(map, text.indexOf("ff"))).toMatchObject({
      kind: "generated",
      purpose: "run-variant",
      nominal: { path: entry.path },
    });
    expect(project).toEqual(before);
  });

  it("selects the requested section when Profile models are inserted automatically", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    entry.text = entry.text.replace('.lib "models.lib" ss\n', "");
    folder.input.dependencies = [];
    const point = await prepareNgspiceExecutionInput(project, folder, caps, {
      environment: { corner: "ff" },
    });
    if (!point.ok) throw Error(JSON.stringify(point));
    const text = point.input.files.find(
      (file) => file.path === entry.path,
    )!.text;
    expect(text).toMatch(/\.lib\s+"icm-models\.lib"\s+ff/u);
    expect(text.match(/\.lib\s+/gu)).toHaveLength(1);
    expect(point.input.environment.corner).toBe("ff");
  });

  it("rejects conflicting native Profile loads instead of silently selecting a requested corner", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    entry.text = entry.text.replace(
      '.lib "models.lib" ss',
      '.lib "models.lib" ss\n.lib "models.lib" tt',
    );
    const result = await prepareNgspiceExecutionInput(project, folder, caps, {
      environment: { corner: "ff" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "SIMULATION_MODEL_CORNER_CONFLICT" }),
        ]),
      },
    });
  });

  it("rejects a plain Profile include and a corner without a model target", async () => {
    const { project, folder, entry, caps } = nativeSweepFixture();
    entry.text = entry.text.replace(
      '.lib "models.lib" ss',
      '.include "models.lib"',
    );
    const plainInclude = await prepareNgspiceExecutionInput(
      project,
      folder,
      caps,
      { environment: { corner: "ff" } },
    );
    expect(plainInclude).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COMPILE_REFUSED",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "SIMULATION_MODEL_CORNER_CONFLICT" }),
        ]),
      },
    });

    const graphless = createSimulationFolder({
      id: "graphless",
      name: "Graphless",
      profileId: "ngspice",
      engine: "ngspice",
    });
    const missing = await prepareNgspiceExecutionInput(
      project,
      graphless,
      caps,
      { environment: { corner: "ff" } },
    );
    expect(missing).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_CORNER_TARGET_MISSING" },
    });
  });
  it.each([undefined, "ff"])(
    "keeps Profile-resolved corner %s out of source identity",
    async (corner) => {
      const project = CircuitProjectSchema.parse(
        currentFiveTransistorOtaCircuitSource(),
      );
      const folder = createSimulationFolder({
        id: "native",
        name: "Native",
        profileId: "ngspice",
        engine: "ngspice",
        documentId: project.topDocumentId,
      });
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
        JSON.stringify({
          version: 2,
          environment: { profileId: "ngspice" },
        });
      if (corner) {
        folder.input.dependencies = [
          { id: "models", sha256: "a".repeat(64), mountPath: "models.lib" },
        ];
        const entry = folder.input.files.find(
          (f) => f.path === folder.input.entry,
        )!;
        entry.text = entry.text.replace(
          "\n",
          `\n.lib "models.lib" ${corner}\n`,
        );
      }
      project.simulationFolders = [folder];
      const before = structuredClone(project);
      const caps = CapabilitiesSchema.parse({
        configured: true,
        rawfileCollection: "declared-single-ascii",
        inputs: ["source"],
        analyses: ["op"],
        parsedAnalyses: ["op"],
        profiles: [
          {
            id: "ngspice",
            corners: ["tt", "ff"],
            dependencies: [{ id: "models", sha256: "a".repeat(64) }],
          },
        ],
        modelLibrary: { path: "models.lib", section: "tt" },
        maxInputBytes: 2 * 1024 * 1024,
        maxOutputBytes: 1024 * 1024,
        maxTimeoutMs: 15000,
        cancel: true,
      });
      const prepared = await prepareNgspiceExecutionInput(
        project,
        folder,
        caps,
      );
      if (!prepared.ok) throw Error(JSON.stringify(prepared));
      expect(prepared.input.environment.corner).toBe(corner ?? "tt");
      const identity = new ProjectInputIdentity();
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).toBe(prepared.input.inputRevision);
      expect(project).toEqual(before);
      project.documents[0]!.revision++;
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).toBe(prepared.input.inputRevision);
      folder.input.files.find((f) => f.path === folder.input.entry)!.text +=
        "\n* source changed\n";
      project.structureRevision++;
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).not.toBe(prepared.input.inputRevision);
    },
  );
});
