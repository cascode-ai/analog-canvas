import { LegacyProjectSimulationSetupSchema } from "@icm/model";
import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  ProjectSimulationFolderSchema,
  type ProjectSimulationFolder,
} from "@icm/model";
import {
  migrateSimulationSetupToSource,
  locateSimulationText,
} from "@icm/netlist";
import {
  currentFiveTransistorOtaCircuitSource,
  legacyFiveTransistorOta as ota,
} from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
const legacySetups = () =>
  ota.simulationSetups.map((s) => LegacyProjectSimulationSetupSchema.parse(s));
import profile from "../../../containers/ngspice/hosted-sky130-profile.json";
import { CapabilitiesSchema, ProblemSchema } from "./contract.js";
import { prepareSourceExecutionInput } from "./prepare-source.js";

const project = () =>
  CircuitProjectSchema.parse(currentFiveTransistorOtaCircuitSource());
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
  return ProjectSimulationFolderSchema.parse({
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
function setConfig(folder: ProjectSimulationFolder, changes: object) {
  const file = folder.input.files.find(
    (file) => file.path === folder.input.configPath,
  )!;
  file.text = JSON.stringify({ ...JSON.parse(file.text), ...changes });
}
describe("source execution preparation", () => {
  it("returns source locations tied to exact authored bytes, shared by GUI and MCP", async () => {
    const folder = native();
    folder.input.files[0]!.text =
      '* error 🧪\r\n.include "missing.cir"\r\n.end\r\n';
    const result = await prepareSourceExecutionInput(project(), folder, caps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.error.diagnostics!.find(
      (d) => d.code === "SIMULATION_FILE_MISSING",
    )!;
    expect(diagnostic.source).toMatchObject({
      scope: "authored",
      path: "run.cir",
      line: 2,
      column: 1,
    });
    expect(diagnostic.source?.textDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      folder.input.files[0]!.text.slice(
        diagnostic.source!.startOffset,
        diagnostic.source!.endOffset,
      ),
    ).toContain('.include "missing.cir"');
    expect(ProblemSchema.safeParse(result.error).success).toBe(true);
  });
  it("includes actual managed corner/temperature/parameter projection in run identity, not nominal source storage", async () => {
    const circuit = project();
    const folder = migrateSimulationSetupToSource(
      circuit,
      legacySetups()[0]!,
    ).folder;
    const before = structuredClone(folder);
    const nominal = await prepareSourceExecutionInput(circuit, folder, caps);
    const hot = await prepareSourceExecutionInput(circuit, folder, caps, {
      environment: { corner: "ss", temperatureC: 125 },
    });
    const same = await prepareSourceExecutionInput(circuit, folder, caps, {
      environment: { corner: "ss", temperatureC: 125 },
    });
    expect(nominal.ok && hot.ok && same.ok).toBe(true);
    if (!nominal.ok || !hot.ok || !same.ok) return;
    expect(hot.input.preparedDeck).toContain('.lib "icm-models.lib" ss');
    expect(
      hot.input.files
        ?.map((f) => f.text)
        .join("\n")
        .match(/\.temp\s+125/gu),
    ).toHaveLength(1);
    expect(hot.digest).not.toBe(nominal.digest);
    expect(hot.input.inputRevision).not.toBe(nominal.input.inputRevision);
    expect(hot.digest).toBe(same.digest);
    expect(hot.authoredFiles).toEqual(before.input.files);
    expect(folder).toEqual(before);
  });
  it("preserves native input exactly and records the declared collection in its digest", async () => {
    const folder = native();
    const before = structuredClone(folder);
    const a = await prepareSourceExecutionInput(project(), folder, caps);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.input.testbench).toBe(folder.input.files[0]!.text);
    expect(a.input.collection).toEqual({ rawfile: "out.raw" });
    expect(a.input.dependencies).toEqual([]);
    expect(a.authoredFiles).toEqual(folder.input.files);
    expect(folder).toEqual(before);
    setConfig(folder, { collection: { rawfile: null } });
    const b = await prepareSourceExecutionInput(project(), folder, caps);
    expect(b.ok && b.digest).not.toBe(a.digest);
    expect(b.ok && b.input.collection).toEqual({ rawfile: null });
  });
  it("prepares the saved OTA sources with digest-addressed models and complete text mappings", async () => {
    const circuit = project();
    for (const original of legacySetups()) {
      const folder = migrateSimulationSetupToSource(circuit, original).folder;
      const result = await prepareSourceExecutionInput(circuit, folder, caps);
      expect(result.ok, JSON.stringify(result.ok ? [] : result.error)).toBe(
        true,
      );
      if (!result.ok) continue;
      expect(Object.keys(result.signalTargets).length).toBeGreaterThan(0);
      expect(Object.keys(result.signalTargets)).toEqual(
        Object.keys(result.signalNames),
      );
      for (const targets of Object.values(result.signalTargets)) {
        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) {
          const document = circuit.documents.find(
            (d) => d.id === target.documentId,
          );
          expect(document?.nets.some((net) => net.id === target.netId)).toBe(
            true,
          );
        }
      }
      expect(result.input.dependencies).toContainEqual({
        id: profile.models.id,
        sha256: profile.models.contentSha256,
        mountPath: "icm-models.lib",
      });
      expect(result.input.preparedDeck).toContain(
        `.lib "icm-models.lib" ${original.input.environment.corner ?? "tt"}`,
      );
      expect(result.input.preparedDeck).not.toContain("/not-a-client-path/");
      const source = folder.input.files.find(
        (file) => file.path === folder.input.entry,
      )!;
      const map = result.sourceMaps.find(
        (item) => item.path === folder.input.entry,
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
    const folder = migrateSimulationSetupToSource(
      circuit,
      legacySetups()[0]!,
    ).folder;
    const a = await prepareSourceExecutionInput(circuit, folder, caps);
    if (!a.ok) throw Error(a.error.message);
    const moved = structuredClone(circuit);
    moved.structureRevision++;
    const instance = moved.documents
      .flatMap((doc) => doc.instances)
      .find((instance) => instance.placement)!;
    instance.placement!.position.x += 20;
    const b = await prepareSourceExecutionInput(moved, folder, caps);
    expect(b.ok && b.input.inputRevision).toBe(a.input.inputRevision);
    const resized = structuredClone(circuit);
    const mos = resized.documents
      .flatMap((doc) => doc.instances)
      .find((instance) => instance.netlist?.parameters.w)!;
    mos.netlist!.parameters.w = "25u";
    const c = await prepareSourceExecutionInput(resized, folder, caps);
    expect(c.ok, JSON.stringify(c)).toBe(true);
    expect(c.ok && c.input.inputRevision).not.toBe(a.input.inputRevision);
  });
  it("resolves nested entries and does not duplicate a matching authored model load", async () => {
    const circuit = project();
    const folder = migrateSimulationSetupToSource(
      circuit,
      legacySetups()[0]!,
    ).folder;
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    )!;
    folder.input.entry = entry.path = "tb/run.cir";
    entry.text = entry.text.replace('"circuit.spice"', '"../circuit.spice"');
    setConfig(folder, { variables: [] });
    const automatic = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(automatic.ok && automatic.input.preparedDeck).toContain(
      '.lib "../icm-models.lib" tt',
    );
    folder.input.dependencies.push({
      id: profile.models.id,
      sha256: profile.models.contentSha256,
      mountPath: "models/library.lib",
    });
    entry.text = entry.text.replace(
      ".control",
      '.lib "../models/library.lib" tt\n.control',
    );
    const authored = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(authored.ok, JSON.stringify(authored)).toBe(true);
    if (!authored.ok) return;
    expect(authored.input.preparedDeck.match(/\.lib /gu)).toHaveLength(1);
    expect(authored.input.dependencies).toEqual(folder.input.dependencies);
    entry.text = entry.text.replace('library.lib" tt', 'library.lib" ff');
    const conflict = await prepareSourceExecutionInput(circuit, folder, caps);
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
    folder.input.files.find(
      (file) => file.path === folder.input.configPath,
    )!.text = JSON.stringify({
      version: 2,
      environment: { profileId: profile.id },
    });
    const nativeBefore = JSON.stringify(folder);
    const nativeCorner = await prepareSourceExecutionInput(
      circuit,
      folder,
      caps,
    );
    expect(nativeCorner.ok, JSON.stringify(nativeCorner)).toBe(true);
    if (nativeCorner.ok) {
      expect(nativeCorner.input.environment?.corner).toBe("ff");
      expect(nativeCorner.input.preparedDeck.match(/\.lib /gu)).toHaveLength(1);
    }
    expect(JSON.stringify(folder)).toBe(nativeBefore);
  });
  it("returns located diagnostics for invalid drafts and capability problems without mutating them", async () => {
    const folder = native();
    folder.input.files[0]!.text = "title\n.include missing.inc\n.end";
    const invalid = await prepareSourceExecutionInput(project(), folder, caps);
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
