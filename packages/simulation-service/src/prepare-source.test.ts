import { describe, expect, it } from "vitest";
import {
  CircuitProjectSchema,
  LegacyProjectSimulationSetupSchema,
  createSimulationFolder,
} from "@icm/model";
import {
  migrateSimulationSetupToSource,
  locateSimulationText,
} from "@icm/netlist";
import {
  currentFiveTransistorOtaCircuitSource,
  legacyFiveTransistorOta as ota,
} from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { CapabilitiesSchema, ProblemSchema } from "./contract.js";
import { prepareSourceExecutionInput } from "./prepare-source.js";

const project = () =>
  CircuitProjectSchema.parse(currentFiveTransistorOtaCircuitSource());
const caps = CapabilitiesSchema.parse({
  configured: true,
  rawfileCollection: "native-multi-ascii",
  maxInputFiles: 24,
  inputs: ["source"],
  analyses: ["op", "dc", "ac", "tran", "noise"],
  parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
  profiles: [
    {
      id: "candidate",
      corners: ["tt", "ff", "ss"],
      dependencies: [{ id: "models", sha256: "a".repeat(64) }],
      modelLibrary: { dependencyId: "models", defaultSection: "tt" },
    },
  ],
  maxInputBytes: 2 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxTimeoutMs: 120000,
  cancel: true,
});
function native(bound = false) {
  const circuit = project();
  const folder = createSimulationFolder({
    id: "native",
    name: "Native",
    profileId: "candidate",
  });
  folder.input.entry = "tb/run.sim";
  folder.input.files = [
    {
      path: folder.input.entry,
      text: bound
        ? 'Canvas preparation\r\ninclude "../circuit.inc"\r\ncontrol\r\nanalysis bias op\r\nendc\r\n'
        : 'Native input\r\nmodel voltage vsource\r\nmodel resistance resistor\r\nV1 (Input 0) voltage dc=1\r\nR1 (Input 0) resistance r=1k\r\ncontrol\r\noptions rawfile="ascii"\r\nsave v(Input)\r\nanalysis bias op\r\nendc\r\n',
    },
    {
      path: folder.input.configPath,
      text: JSON.stringify({
        version: 2,
        environment: { profileId: "candidate" },
      }),
    },
  ];
  folder.input.circuitBindings = bound
    ? [
        {
          id: "canvas",
          documentId: circuit.documents[0]!.id,
          path: "circuit.inc",
          emission: "top-level",
        },
      ]
    : [];
  return { circuit, folder, entry: folder.input.files[0]! };
}

describe("source execution preparation", () => {
  it("returns source locations tied to exact authored bytes, shared by GUI and MCP", async () => {
    const { circuit, folder, entry } = native();
    entry.text = 'Error 🧪\r\ninclude "missing.inc"\r\n';
    const before = structuredClone(folder);
    const result = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.error.diagnostics!.find(
      (d) => d.code === "SIMULATION_FILE_MISSING",
    )!;
    expect(diagnostic.source).toMatchObject({
      scope: "authored",
      path: entry.path,
      line: 2,
      column: 1,
    });
    expect(diagnostic.source?.textDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      entry.text.slice(
        diagnostic.source!.startOffset,
        diagnostic.source!.endOffset,
      ),
    ).toContain('include "missing.inc"');
    expect(ProblemSchema.safeParse(result.error).success).toBe(true);
    expect(folder).toEqual(before);
  });

  it("records authored temperature and parameter changes, refusing hidden JSON run overrides", async () => {
    const { circuit, folder, entry } = native();
    const nominal = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(nominal.ok, JSON.stringify(nominal)).toBe(true);
    if (!nominal.ok) return;
    entry.text = entry.text
      .replace("dc=1", "dc=2")
      .replace("analysis bias op", "analysis bias op temp=125");
    const before = structuredClone(folder);
    const hot = await prepareSourceExecutionInput(circuit, folder, caps);
    const same = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(hot.ok && same.ok).toBe(true);
    if (!hot.ok || !same.ok) return;
    expect(hot.input.preparedDeck).toBe(entry.text);
    expect(hot.digest).not.toBe(nominal.digest);
    expect(hot.input.inputRevision).not.toBe(nominal.input.inputRevision);
    expect(hot.digest).toBe(same.digest);
    expect(hot.authoredFiles).toEqual(before.input.files);
    expect(
      await prepareSourceExecutionInput(circuit, folder, caps, {
        environment: { temperatureC: 125 },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        diagnostics: [{ code: "SIMULATION_NATIVE_VARIANT_UNSUPPORTED" }],
      },
    });
    expect(folder).toEqual(before);
  });

  it("preserves native bytes and changes identity with native analyses, not a saved collection sidecar", async () => {
    const { circuit, folder, entry } = native();
    const before = structuredClone(folder);
    const a = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    if (!a.ok) return;
    expect(a.input.testbench).toBe(entry.text);
    expect(a.input.collection).toEqual({ kind: "native-multi-ascii" });
    expect(a.input.dependencies).toEqual([]);
    expect(a.authoredFiles).toEqual(folder.input.files);
    expect(folder).toEqual(before);
    entry.text = entry.text.replace(
      "analysis bias op",
      "analysis other op write=0",
    );
    const b = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(b.ok && b.digest).not.toBe(a.digest);
    expect(b.ok && b.input.preparedDeck).toBe(entry.text);
    folder.input.files[1]!.text = JSON.stringify({
      version: 2,
      environment: { profileId: "candidate" },
      collection: { rawfile: "out.raw" },
    });
    expect(
      await prepareSourceExecutionInput(circuit, folder, caps),
    ).toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "SIMULATION_CONFIG_INVALID" }),
        ]),
      },
    });
  });

  it("keeps legacy OTA programs intact and refuses to relabel them as executable native experiments", async () => {
    const circuit = project();
    for (const source of ota.simulationSetups) {
      const legacy = LegacyProjectSimulationSetupSchema.parse(source);
      const folder = migrateSimulationSetupToSource(circuit, legacy).folder;
      const before = structuredClone(folder);
      expect(
        await prepareSourceExecutionInput(circuit, folder, caps),
      ).toMatchObject({
        ok: false,
        error: {
          recovery: "fix-input",
          diagnostics: [{ code: "SIMULATION_LEGACY_SOURCE" }],
        },
      });
      expect(folder).toEqual(before);
    }
    expect(circuit).toEqual(project());
  });

  it("prepares bound Canvas topology with complete target and generated/authored text mappings", async () => {
    const { circuit, folder, entry } = native(true);
    const before = structuredClone({ circuit, folder });
    const result = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.signalTargets).length).toBeGreaterThan(0);
    expect(Object.keys(result.signalTargets)).toEqual(
      Object.keys(result.signalNames),
    );
    for (const targets of Object.values(result.signalTargets)) {
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        expect(
          circuit.documents
            .find((d) => d.id === target.documentId)
            ?.nets.some((n) => n.id === target.netId),
        ).toBe(true);
      }
    }
    const map = result.sourceMaps.find((m) => m.path === entry.path)!;
    expect(
      locateSimulationText(map, result.input.preparedDeck.indexOf("control")),
    ).toEqual({
      kind: "authored",
      path: entry.path,
      startOffset: entry.text.indexOf("control"),
    });
    expect(
      result.input.files.every((file) =>
        result.sourceMaps.some((map) => map.path === file.path),
      ),
    ).toBe(true);
    expect({ circuit, folder }).toEqual(before);
  });

  it("uses electrical and authored identity, not layout or unrelated Project revisions", async () => {
    const { circuit, folder } = native(true);
    const a = await prepareSourceExecutionInput(circuit, folder, caps);
    if (!a.ok) throw Error(JSON.stringify(a.error));
    const moved = structuredClone(circuit);
    moved.structureRevision++;
    moved.documents
      .flatMap((doc) => doc.instances)
      .find((i) => i.placement)!.placement!.position.x += 20;
    const b = await prepareSourceExecutionInput(moved, folder, caps);
    expect(b.ok && b.input.inputRevision).toBe(a.input.inputRevision);
    expect(b.ok && b.digest).toBe(a.digest);
    const resized = structuredClone(circuit);
    resized.documents
      .flatMap((doc) => doc.instances)
      .find((i) => i.netlist?.parameters.w)!.netlist!.parameters.w = "25u";
    const c = await prepareSourceExecutionInput(resized, folder, caps);
    expect(c.ok, JSON.stringify(c)).toBe(true);
    expect(c.ok && c.input.inputRevision).not.toBe(a.input.inputRevision);
  });

  it("includes actual native corner in the prepared digest without copying it into config", async () => {
    const { circuit, folder, entry } = native(true);
    const nominal = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(nominal.ok).toBe(true);
    folder.input.dependencies = [
      { id: "models", sha256: "a".repeat(64), mountPath: "models/library.inc" },
    ];
    entry.text = entry.text.replace(
      "control",
      'include "../models/library.inc" section=ss\r\ncontrol',
    );
    const before = structuredClone(folder);
    const authored = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(authored.ok, JSON.stringify(authored)).toBe(true);
    if (!authored.ok || !nominal.ok) return;
    expect(authored.input.preparedDeck).toBe(entry.text);
    expect(authored.input.environment.corner).toBe("ss");
    expect(authored.digest).not.toBe(nominal.digest);
    expect(folder).toEqual(before);
    entry.text = entry.text.replace(
      "control",
      'include "../models/library.inc" section=tt\r\ncontrol',
    );
    expect(
      await prepareSourceExecutionInput(circuit, folder, caps),
    ).toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: "SIMULATION_MODEL_CORNER_CONFLICT",
            path: entry.path,
          }),
        ]),
      },
    });
  });

  it("refuses drafts and unavailable/limited runtimes without mutating saved input", async () => {
    const { circuit, folder, entry } = native();
    folder.input.drafts = [
      { path: entry.path, base: entry.text, text: "unfinished" },
    ];
    const draftBefore = structuredClone(folder);
    expect(
      await prepareSourceExecutionInput(circuit, folder, caps),
    ).toMatchObject({
      ok: false,
      error: {
        recovery: "fix-input",
        diagnostics: [{ code: "SIMULATION_SOURCE_DRAFT_PENDING" }],
      },
    });
    expect(folder).toEqual(draftBefore);
    folder.input.drafts = [];
    const before = structuredClone(folder);
    for (const [changed, code] of [
      [
        { ...caps, rawfileCollection: undefined },
        "SIMULATION_NATIVE_RUNTIME_UNAVAILABLE",
      ],
      [{ ...caps, maxInputFiles: 0 }, "SIMULATION_INPUT_FILE_LIMIT"],
      [{ ...caps, maxInputBytes: 1 }, "SIMULATION_INPUT_BYTE_LIMIT"],
    ] as const) {
      expect(
        await prepareSourceExecutionInput(circuit, folder, changed),
      ).toMatchObject({ ok: false, error: { code } });
    }
    expect(folder).toEqual(before);
    expect((await prepareSourceExecutionInput(circuit, folder, caps)).ok).toBe(
      true,
    );
  });
});
