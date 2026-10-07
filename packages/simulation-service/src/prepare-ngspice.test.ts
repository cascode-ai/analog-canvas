import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  createSimulationFolder,
  createEmptyProject,
} from "@icm/model";
import {
  executeProjectTransaction,
  createExternalSubcircuitInstance,
} from "../../edit-engine/src/index.js";
import { currentFiveTransistorOtaCircuitSource } from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { locateSimulationText, createDesignNetlistExport } from "@icm/netlist";
import { createSimulationInputMetadata } from "@icm/spice-run";
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
  it.each([false, true])(
    "protects global device models while respecting a testbench's local scope (%s)",
    async (local) => {
      const project = createEmptyProject("diode", "Diode");
      const definition = {
        id: "amp",
        name: "amp",
        interfaceStatus: "declared" as const,
        formalParameters: [],
        terminals: [{ id: "a", name: "A", direction: "passive" as const }],
        implementation: {
          kind: "source" as const,
          sourceId: "diode",
          entry: "amp",
        },
      };
      project.externalSubcircuitDefinitions.push(definition);
      project.modelSources = [
        {
          id: "diode",
          language: "spice",
          entry: "diode.spice",
          revision: 1,
          dependencies: [],
          files: [
            {
              path: "diode.spice",
              text: ".model shared D(Is=1e-14)\n.subckt amp A\nD1 A 0 shared\n.ends amp\n",
            },
          ],
        },
      ];
      project.documents[0]!.instances.push(
        createExternalSubcircuitInstance("X1", definition, {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "none",
        }),
      );
      project.documents[0]!.noConnects.push({
        id: "nc",
        endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
      });
      const folder = createSimulationFolder({
        id: "diode",
        name: "Diode",
        engine: "ngspice",
        profileId: "ngspice",
        documentId: project.topDocumentId,
      });
      const entry = folder.input.files.find(
        (f) => f.path === folder.input.entry,
      )!;
      const card = ".model SHARED D(Is=1e-9)\n";
      entry.text = entry.text.replace(
        ".control",
        (local
          ? `.subckt tb_helper A\n${card}D1 A 0 SHARED\n.ends tb_helper\n`
          : card) + ".control",
      );
      const { caps } = nativeSweepFixture();
      const prepared = await prepareNgspiceExecutionInput(
        project,
        folder,
        caps,
      );
      expect(prepared.ok, JSON.stringify(prepared)).toBe(local);
      if (!prepared.ok)
        expect(prepared.error.diagnostics).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "MODEL_SOURCE_SHADOW",
              path: folder.input.entry,
              sourceRef: expect.any(Object),
            }),
          ]),
        );
    },
  );
  it("refuses a missing legacy implementation despite an unused available dependency", async () => {
    const project = createEmptyProject("legacy", "Legacy");
    const definition = {
      id: "missing",
      name: "missing",
      interfaceStatus: "declared" as const,
      formalParameters: [],
      terminals: [{ id: "a", name: "A", direction: "passive" as const }],
    };
    project.externalSubcircuitDefinitions.push(definition);
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance("X1", definition, {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      }),
    );
    project.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
    });
    const folder = createSimulationFolder({
      id: "legacy",
      name: "Legacy",
      engine: "ngspice",
      profileId: "ngspice",
      documentId: project.topDocumentId,
    });
    const { caps } = nativeSweepFixture();
    folder.input.dependencies = [
      { id: "models", mountPath: "models.lib", sha256: "a".repeat(64) },
    ];
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared.ok).toBe(false);
    if (!prepared.ok)
      expect(prepared.error.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "MODEL_IMPLEMENTATION_MISSING" }),
        ]),
      );
  });
  it("exports and prepares distinct selected sections in one owned library without a false cycle", async () => {
    const initial = createEmptyProject("sections", "Sections");
    const applied = executeProjectTransaction(initial, {
      projectId: initial.id,
      expectedStructureRevision: 0,
      transactionId: "sections",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "sections",
            language: "spice",
            entry: "main.spice",
            revision: 0,
            dependencies: [],
            files: [
              { path: "main.spice", text: '.lib "models.lib" COMMON\n' },
              {
                path: "models.lib",
                text: '.lib common\n.lib "models.lib" HeLpEr\n.subckt amp A\nX1 A leaf\n.ends amp\n.endl common\n.lib helper\n.subckt leaf A\nR1 A 0 1k\n.ends leaf\n.endl helper\n',
              },
            ],
          },
          definitions: [{ definitionId: "amp", entry: "amp" }],
        },
      ],
    });
    if (!applied.ok) throw Error(JSON.stringify(applied));
    const project = applied.project;
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        project.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    project.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
    });
    const exported = createDesignNetlistExport(project, { format: "spice" });
    expect(exported.status).toBe("ready");
    if (exported.status !== "ready") return;
    expect(exported.file.text.match(/\.subckt leaf A/gu)).toHaveLength(1);
    const folder = createSimulationFolder({
      id: "sections",
      name: "Sections",
      engine: "ngspice",
      profileId: "ngspice",
      documentId: project.topDocumentId,
    });
    const { caps } = nativeSweepFixture();
    const prepared = await prepareNgspiceExecutionInput(project, folder, caps);
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    if (prepared.ok)
      expect(
        prepared.input.files
          .map((f) => f.text)
          .join("\n")
          .match(/\.subckt leaf A/gu),
      ).toHaveLength(1);
  });
  it("resolves a model-owned dependency and corner without copying or editing its source", async () => {
    const initial = createEmptyProject("owned-dependency", "Owned dependency");
    const applied = executeProjectTransaction(initial, {
      projectId: initial.id,
      expectedStructureRevision: 0,
      transactionId: "define",
      actor: { kind: "human", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "native",
            language: "spice",
            entry: "owned/main.spice",
            files: [
              {
                path: "owned/main.spice",
                text: '.lib "../vendor/models.lib" ss\n.subckt native A\nR1 A 0 1k\n.ends native\n',
              },
            ],
            dependencies: [
              {
                id: "models",
                mountPath: "vendor/models.lib",
                sha256: "a".repeat(64),
              },
            ],
            revision: 0,
          },
          definitions: [{ definitionId: "native", entry: "native" }],
        },
      ],
    });
    if (!applied.ok) throw Error(JSON.stringify(applied));
    const project = applied.project;
    project.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        project.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    project.documents[0]!.noConnects.push({
      id: "nc",
      endpoint: { kind: "terminal", instanceId: "X1", pinName: "A" },
    });
    const folder = createSimulationFolder({
      id: "sim",
      name: "Sim",
      engine: "ngspice",
      profileId: "ngspice",
      documentId: project.documents[0]!.id,
    });
    const { caps } = nativeSweepFixture();
    const before = structuredClone(project);
    const nominal = await prepareNgspiceExecutionInput(project, folder, caps);
    const corner = await prepareNgspiceExecutionInput(project, folder, caps, {
      environment: { corner: "ff" },
    });
    expect(nominal.ok && corner.ok, JSON.stringify({ nominal, corner })).toBe(
      true,
    );
    if (!nominal.ok || !corner.ok) return;
    expect(nominal.input.dependencies).toEqual(
      project.modelSources![0]!.dependencies,
    );
    expect(nominal.input.files.map((f) => f.text).join("\n")).toContain(
      '.lib "vendor/models.lib" ss',
    );
    expect(corner.input.files.map((f) => f.text).join("\n")).toContain(
      '.lib "vendor/models.lib" ff',
    );
    expect(corner.input.inputRevision).not.toBe(nominal.input.inputRevision);
    expect(project).toEqual(before);
  });
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

  it("names the drawn circuit in the netlist digest, apart from the testbench (#1243)", async () => {
    const { project, folder, caps } = nativeSweepFixture();
    const digests = async (prepared: {
      input: { netlist: string; testbench: string; preparedDeck: string };
    }) =>
      createSimulationInputMetadata({
        netlist: prepared.input.netlist,
        testbench: prepared.input.testbench,
        deck: prepared.input.preparedDeck,
      });
    const nominal = await prepareNgspiceExecutionInput(project, folder, caps);
    if (!nominal.ok) throw Error(JSON.stringify(nominal));
    const [generated] = nominal.generated;
    const circuit = nominal.input.files.find(
      (file) => file.path === generated!.path,
    )!;
    // The circuit file as sent, which the run's catalog lists by digest.
    expect(nominal.input.netlist).toBe(circuit.text);
    const before = await digests(nominal);
    expect(circuit.text).not.toBe("");
    // Only the drawing changes: one device width.
    const instance = project.documents
      .flatMap((document) => document.instances)
      .find((item) => item.netlist?.parameters.w)!;
    instance.netlist!.parameters.w = "33u";
    const edited = await prepareNgspiceExecutionInput(project, folder, caps);
    if (!edited.ok) throw Error(JSON.stringify(edited));
    const after = await digests(edited);
    expect(after.netlistSha256).not.toBe(before.netlistSha256);
    expect(after.testbenchSha256).toBe(before.testbenchSha256);
    // A second copy that would take the serialized input past the budget
    // stays unsent: the files alone still run.
    const withoutCopy = new TextEncoder().encode(
      JSON.stringify({ ...edited.input, netlist: "" }),
    ).length;
    const tight = await prepareNgspiceExecutionInput(project, folder, {
      ...caps,
      maxInputBytes: withoutCopy,
    });
    if (!tight.ok) throw Error(JSON.stringify(tight));
    expect(tight.input.netlist).toBe("");
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
