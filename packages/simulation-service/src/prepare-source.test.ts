import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  ProjectSourceSimulationSetupSchema,
  type ProjectSourceSimulationSetup,
} from "@icm/model";
import {
  migrateSimulationSetupToSource,
  locateSimulationText,
} from "@icm/netlist";
import ota from "../../../apps/editor/src/examples/five-transistor-ota-sky130.icproj.json";
import profile from "../../../containers/ngspice/hosted-sky130-profile.json";
import { CapabilitiesSchema, ProblemSchema } from "./contract.js";
import { prepareSourceExecutionInput } from "./prepare-source.js";

const project = () => CircuitProjectSchema.parse(ota);
const caps = CapabilitiesSchema.parse({
  configured: true,
  rawfileCollection: "declared-single-ascii",
  maxInputFiles: 24,
  inputs: ["raw", "structured"],
  analyses: profile.qualifiedScope.analyses,
  parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
  profiles: [
    {
      id: profile.id,
      corners: profile.qualifiedScope.sections,
      dependencies: [
        { id: profile.models.id, sha256: profile.models.contentSha256 },
      ],
    },
  ],
  modelLibrary: { path: "/not-a-client-path/models.lib", section: "tt" },
  maxInputBytes: 2 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxTimeoutMs: 120000,
  cancel: true,
});
function native() {
  return ProjectSourceSimulationSetupSchema.parse({
    version: 4,
    id: "native",
    name: "Native",
    input: {
      kind: "source",
      entry: "run.cir",
      configPath: "experiment.json",
      circuitBindings: [],
      dependencies: [],
      files: [
        {
          path: "run.cir",
          text: "title\r\nV1 in 0 1\r\nR1 in 0 1k\r\n.control\r\nop\r\nwrite out.raw\r\n.endc\r\n.end",
        },
        {
          path: "experiment.json",
          text: JSON.stringify({
            version: 1,
            environment: { profileId: profile.id },
          }),
        },
      ],
    },
  });
}
function setConfig(setup: ProjectSourceSimulationSetup, changes: object) {
  const file = setup.input.files.find(
    (file) => file.path === setup.input.configPath,
  )!;
  file.text = JSON.stringify({ ...JSON.parse(file.text), ...changes });
}
describe("source execution preparation", () => {
  it("preserves native input exactly and records the declared collection in its digest", async () => {
    const setup = native();
    const before = structuredClone(setup);
    const a = await prepareSourceExecutionInput(project(), setup, caps);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.input.testbench).toBe(setup.input.files[0]!.text);
    expect(a.input.collection).toEqual({ rawfile: "out.raw" });
    expect(a.input.dependencies).toEqual([]);
    expect(a.authoredFiles).toEqual(setup.input.files);
    expect(setup).toEqual(before);
    setConfig(setup, { collection: { rawfile: null } });
    const b = await prepareSourceExecutionInput(project(), setup, caps);
    expect(b.ok && b.digest).not.toBe(a.digest);
    expect(b.ok && b.input.collection).toEqual({ rawfile: null });
  });
  it("prepares the saved OTA sources with digest-addressed models and complete text mappings", async () => {
    const circuit = project();
    for (const original of circuit.simulationSetups) {
      const setup = migrateSimulationSetupToSource(circuit, original).setup;
      const result = await prepareSourceExecutionInput(circuit, setup, caps);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.error)).toBe(
        true,
      );
      if (!result.ok) continue;
      expect(result.input.dependencies).toContainEqual({
        id: profile.models.id,
        sha256: profile.models.contentSha256,
        mountPath: "icm-models.lib",
      });
      expect(result.input.preparedDeck).toContain(
        `.lib "icm-models.lib" ${original.input.environment.corner ?? "tt"}`,
      );
      expect(result.input.preparedDeck).not.toContain("/not-a-client-path/");
      const source = setup.input.files.find(
        (file) => file.path === setup.input.entry,
      )!;
      const map = result.sourceMaps.find(
        (item) => item.path === setup.input.entry,
      )!;
      const control = result.input.preparedDeck.indexOf(".control");
      expect(locateSimulationText(map, control)).toEqual({
        kind: "authored",
        path: source.path,
        startOffset: source.text.indexOf(".control"),
      });
      expect(
        result.input.files.every((file) =>
          result.sourceMaps.some((map) => map.path === file.path),
        ),
      ).toBe(true);
    }
    expect(circuit).toEqual(project());
  });
  it("uses electrical and authored identity, not layout or unrelated Project revisions", async () => {
    const circuit = project();
    const setup = migrateSimulationSetupToSource(
      circuit,
      circuit.simulationSetups[0]!,
    ).setup;
    const a = await prepareSourceExecutionInput(circuit, setup, caps);
    if (!a.ok) throw Error(a.error.message);
    const moved = structuredClone(circuit);
    moved.structureRevision++;
    const instance = moved.documents
      .flatMap((doc) => doc.instances)
      .find((instance) => instance.placement)!;
    instance.placement!.position.x += 20;
    const b = await prepareSourceExecutionInput(moved, setup, caps);
    expect(b.ok && b.input.inputRevision).toBe(a.input.inputRevision);
    const resized = structuredClone(circuit);
    const mos = resized.documents
      .flatMap((doc) => doc.instances)
      .find((instance) => instance.netlist?.parameters.w)!;
    mos.netlist!.parameters.w = "25u";
    const c = await prepareSourceExecutionInput(resized, setup, caps);
    expect(c.ok, JSON.stringify(c)).toBe(true);
    expect(c.ok && c.input.inputRevision).not.toBe(a.input.inputRevision);
  });
  it("resolves nested entries and does not duplicate a matching authored model load", async () => {
    const circuit = project();
    const setup = migrateSimulationSetupToSource(
      circuit,
      circuit.simulationSetups[0]!,
    ).setup;
    const entry = setup.input.files.find(
      (file) => file.path === setup.input.entry,
    )!;
    setup.input.entry = entry.path = "tb/run.cir";
    entry.text = entry.text.replace('"circuit.spice"', '"../circuit.spice"');
    setConfig(setup, { variables: [] });
    const automatic = await prepareSourceExecutionInput(circuit, setup, caps);
    expect(automatic.ok && automatic.input.preparedDeck).toContain(
      '.lib "../icm-models.lib" tt',
    );
    setup.input.dependencies.push({
      id: profile.models.id,
      sha256: profile.models.contentSha256,
      mountPath: "models/library.lib",
    });
    entry.text = entry.text.replace(
      ".control",
      '.lib "../models/library.lib" tt\n.control',
    );
    const authored = await prepareSourceExecutionInput(circuit, setup, caps);
    expect(authored.ok, JSON.stringify(authored)).toBe(true);
    if (!authored.ok) return;
    expect(authored.input.preparedDeck.match(/\.lib /gu)).toHaveLength(1);
    expect(authored.input.dependencies).toEqual(setup.input.dependencies);
    entry.text = entry.text.replace('library.lib" tt', 'library.lib" ff');
    const conflict = await prepareSourceExecutionInput(circuit, setup, caps);
    expect(conflict).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: "SIMULATION_MODEL_CORNER_CONFLICT",
            path: "tb/run.cir",
          }),
        ],
      },
    });
  });
  it("returns located diagnostics for invalid drafts and capability problems without mutating them", async () => {
    const setup = native();
    setup.input.files[0]!.text = "title\n.include missing.inc\n.end";
    const invalid = await prepareSourceExecutionInput(project(), setup, caps);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(ProblemSchema.safeParse(invalid.error).success).toBe(true);
      expect(invalid.error.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "SIMULATION_FILE_MISSING",
          path: "missing.inc",
        }),
      );
    }
    const unavailable = { ...caps };
    delete unavailable.rawfileCollection;
    expect(
      await prepareSourceExecutionInput(project(), native(), unavailable),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_COLLECTION_UNAVAILABLE",
        recovery: "retry-after",
      },
    });
    const collision = native();
    setConfig(collision, { collection: { rawfile: "run.cir" } });
    expect(
      await prepareSourceExecutionInput(project(), collision, caps),
    ).toMatchObject({
      ok: false,
      error: {
        diagnostics: [{ code: "SIMULATION_COLLECTION_INPUT_COLLISION" }],
      },
    });
  });
});
