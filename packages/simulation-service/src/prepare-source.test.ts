import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";
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
import { sha256 } from "./content-digest.js";

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
  it("projects a used library's initial scale without rewriting user options or dimensions", async () => {
    const { circuit, folder, entry } = native(true);
    const selected = structuredClone(caps);
    selected.profiles[0]!.modelLibrary!.defaultScale = 1e-6;
    entry.text = entry.text.replace(
      "control",
      "control // authored control\r\noptions scale=2e-6\r\nclear options\r\noptions scale=3e-6",
    );
    const before = structuredClone({ circuit, folder });
    const prepared = await prepareSourceExecutionInput(
      circuit,
      folder,
      selected,
    );
    if (!prepared.ok) throw Error(JSON.stringify(prepared));
    const text = prepared.input.preparedDeck;
    expect(text.indexOf("options scale=0.000001")).toBeLessThan(
      text.indexOf("options scale=2e-6"),
    );
    expect(text).toContain("clear options\r\noptions scale=3e-6");
    expect(text.match(/Profile model scale/g)).toHaveLength(1);
    const map = prepared.sourceMaps.find((m) => m.path === entry.path)!;
    expect(
      locateSimulationText(map, text.indexOf("options scale=0.000001")),
    ).toEqual({ kind: "generated", purpose: "environment" });
    expect(
      locateSimulationText(map, text.indexOf("options scale=2e-6")),
    ).toEqual({
      kind: "authored",
      path: entry.path,
      startOffset: entry.text.indexOf("options scale=2e-6"),
    });
    expect({ circuit, folder }).toEqual(before);
    selected.profiles[0]!.modelLibrary!.defaultScale = 1e-9;
    const other = await prepareSourceExecutionInput(circuit, folder, selected);
    if (!other.ok) throw Error(JSON.stringify(other));
    expect(other.digest).not.toBe(prepared.digest);
    expect(other.input.inputRevision).toBe(prepared.input.inputRevision);
  });
  it("applies the default in the first reached control include, not in every analysis", async () => {
    const { circuit, folder, entry } = native(true);
    entry.text =
      'Included native control\ninclude "../circuit.inc"\ninclude "commands.inc"\n';
    folder.input.files.push({
      path: "tb/commands.inc",
      text: "control\nanalysis a op\nclear options\nanalysis b op\nendc\n",
    });
    const selected = structuredClone(caps);
    selected.profiles[0]!.modelLibrary!.defaultScale = 1e-6;
    const prepared = await prepareSourceExecutionInput(
      circuit,
      folder,
      selected,
    );
    if (!prepared.ok) throw Error(JSON.stringify(prepared));
    expect(prepared.input.preparedDeck).not.toContain("options scale");
    const commands = prepared.input.files!.find(
      (f) => f.path === "tb/commands.inc",
    )!.text;
    expect(commands.match(/options scale/g)).toHaveLength(1);
    expect(commands).toContain("clear options\nanalysis b op");
  });
  it("does not apply model scale to a text-only experiment that never loads that library", async () => {
    const { circuit, folder } = native();
    const selected = structuredClone(caps);
    selected.profiles[0]!.modelLibrary!.defaultScale = 1e-6;
    const prepared = await prepareSourceExecutionInput(
      circuit,
      folder,
      selected,
    );
    if (!prepared.ok) throw Error(JSON.stringify(prepared));
    expect(
      prepared.input.files!.every((f) => !f.text.includes("options scale")),
    ).toBe(true);
  });
  it.each([0, -1, Infinity, NaN])(
    "rejects invalid Profile defaultScale %s",
    (value) => {
      const selected = structuredClone(caps);
      selected.profiles[0]!.modelLibrary!.defaultScale = value;
      expect(CapabilitiesSchema.safeParse(selected).success).toBe(false);
    },
  );
  it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
    "runs ambient points across native option resets and DC sweeps without changing tnom",
    async () => {
      const { circuit, folder, entry } = native();
      entry.text = readFileSync(
        new URL(
          "../../../netlists/vacask-temperature/run.sim",
          import.meta.url,
        ),
        "utf8",
      );
      const before = structuredClone({ circuit, folder });
      for (const temperatureC of [undefined, 0, 125]) {
        const point = await prepareSourceExecutionInput(
          circuit,
          folder,
          caps,
          temperatureC === undefined
            ? undefined
            : { environment: { temperatureC } },
        );
        if (!point.ok) throw Error(JSON.stringify(point));
        const cwd = mkdtempSync(join(tmpdir(), "icm-native-temperature-"));
        for (const file of point.input.files) {
          mkdirSync(dirname(join(cwd, file.path)), { recursive: true });
          writeFileSync(join(cwd, file.path), file.text);
        }
        const startup = join(cwd, "startup.toml");
        writeFileSync(startup, "# controlled ambient-temperature proof\n");
        const run = spawnSync(
          process.env.VACASK_BIN!,
          ["--tomlfile", startup, "-n", "1", "-b", "1", point.input.entryPath!],
          {
            cwd,
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
            env: {
              ...process.env,
              SIM_MODULE_PATH: process.env.VACASK_MODULES,
            },
          },
        );
        expect(run.error, cwd).toBeUndefined();
        expect(run.status, `${cwd}\n${run.stdout}\n${run.stderr}`).toBe(0);
        for (const [name, nominal] of [
          ["first", 27],
          ["second", 80],
        ] as const) {
          const raw = parseVacaskRawfile(
            readFileSync(join(cwd, `${name}.raw`), "utf8"),
          );
          if (!raw.ok) throw Error(raw.error.message);
          const vectors = new Map(
            raw.plots[0]!.vectors.map((v) => [v.variable.name, v.real]),
          );
          expect(new Set(vectors.get("Ambient"))).toEqual(
            new Set([temperatureC ?? nominal]),
          );
          expect(new Set(vectors.get("Nominal"))).toEqual(new Set([25]));
          if (name === "second") expect(vectors.get("Swept")).toEqual([0, 1]);
        }
        expect(point.input.environment.temperatureC).toBe(temperatureC);
        expect(point.authoredFiles).toEqual(folder.input.files);
        expect({ circuit, folder }).toEqual(before);
      }
    },
  );

  it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
    "executes prepared Profile corner points with actual native section-dependent numbers",
    async () => {
      const { circuit, folder, entry } = native();
      entry.text = readFileSync(
        new URL(
          "../../../netlists/vacask-profile-section/run.sim",
          import.meta.url,
        ),
        "utf8",
      );
      // Entry lives in tb/, so model resolution is deliberately root-relative.
      const model = readFileSync(
        new URL(
          "../../../netlists/vacask-profile-section/sections.inc",
          import.meta.url,
        ),
        "utf8",
      );
      const digest = await sha256(model);
      const localCaps = structuredClone(caps);
      localCaps.profiles[0]!.dependencies = [{ id: "models", sha256: digest }];
      folder.input.dependencies = [
        { id: "models", sha256: digest, mountPath: "models/sections.inc" },
      ];
      const before = structuredClone({ circuit, folder });
      for (const [corner, current] of [
        ["tt", -0.001],
        ["ff", -0.0005],
      ] as const) {
        const point = await prepareSourceExecutionInput(
          circuit,
          folder,
          localCaps,
          { environment: { corner } },
        );
        if (!point.ok) throw Error(JSON.stringify(point));
        const cwd = mkdtempSync(join(tmpdir(), "icm-native-section-"));
        for (const file of [
          ...point.input.files,
          { path: "models/sections.inc", text: model },
        ]) {
          mkdirSync(dirname(join(cwd, file.path)), { recursive: true });
          writeFileSync(join(cwd, file.path), file.text);
        }
        const startup = join(cwd, "startup.toml");
        writeFileSync(startup, "# controlled native section proof\n");
        const run = spawnSync(
          process.env.VACASK_BIN!,
          ["--tomlfile", startup, "-n", "1", "-b", "1", point.input.entryPath!],
          {
            cwd,
            encoding: "utf8",
            windowsHide: true,
            timeout: 15000,
            env: {
              ...process.env,
              SIM_MODULE_PATH: process.env.VACASK_MODULES,
            },
          },
        );
        expect(run.error, cwd).toBeUndefined();
        expect(run.status, `${cwd}\n${run.stdout}\n${run.stderr}`).toBe(0);
        const raw = parseVacaskRawfile(
          readFileSync(join(cwd, "bias.raw"), "utf8"),
        );
        if (!raw.ok) throw Error(raw.error.message);
        const branch = raw.plots[0]!.vectors.find(
          (v) => v.variable.name === "V1:flow(br)",
        )!;
        expect(branch.real[0]).toBeCloseTo(current, 12);
        expect({ circuit, folder }).toEqual(before);
      }
    },
  );

  it.each([true, false])(
    "projects a corner onto only the declared Profile dependency (bound=%s)",
    async (bound) => {
      const { circuit, folder, entry } = native(bound);
      folder.input.dependencies = [
        {
          id: "models",
          sha256: "a".repeat(64),
          mountPath: "models/library.inc",
        },
      ];
      folder.input.files.push({
        path: "other.inc",
        text: "section ss\n// unrelated section\nendsection\n",
      });
      entry.text = entry.text.replace(
        "control",
        'parameters BIAS=0.9\r\ninclude "../other.inc" section=ss\r\ninclude "../models/library.inc" section=ss // nominal corner\r\ncontrol',
      );
      const before = structuredClone({ circuit, folder });
      const nominal = await prepareSourceExecutionInput(circuit, folder, caps);
      const point = await prepareSourceExecutionInput(circuit, folder, caps, {
        environment: { corner: "ff" },
        variables: [{ variableId: "BIAS", value: "0.123456789" }],
      });
      if (!nominal.ok || !point.ok)
        throw Error(JSON.stringify({ nominal, point }));
      expect(point.input.environment.corner).toBe("ff");
      expect(nominal.input.environment.corner).toBe("ss");
      expect(point.input.preparedDeck).toContain(
        'include "../other.inc" section=ss',
      );
      expect(point.input.preparedDeck).toContain(
        'include "../models/library.inc" section=ff // nominal corner',
      );
      expect(point.authoredFiles).toEqual(folder.input.files);
      expect(point.input.inputRevision).not.toBe(nominal.input.inputRevision);
      expect(point.digest).not.toBe(nominal.digest);
      const map = point.sourceMaps.find((m) => m.path === entry.path)!;
      expect(
        locateSimulationText(
          map,
          point.input.preparedDeck.indexOf("section=ff") + 8,
        ),
      ).toEqual({
        kind: "generated",
        purpose: "run-variant",
        nominal: {
          path: entry.path,
          startOffset: entry.text.lastIndexOf("section=ss") + 8,
          endOffset: entry.text.lastIndexOf("section=ss") + 10,
        },
      });
      expect(
        locateSimulationText(map, point.input.preparedDeck.indexOf("control")),
      ).toEqual({
        kind: "authored",
        path: entry.path,
        startOffset: entry.text.indexOf("control"),
      });
      expect({ circuit, folder }).toEqual(before);
      const again = await prepareSourceExecutionInput(circuit, folder, caps, {
        environment: { corner: "ff" },
        variables: [{ variableId: "BIAS", value: "0.123456789" }],
      });
      expect(again.ok && again.digest).toBe(point.digest);
    },
  );

  it("adds a section once to a repeatedly reached include and preserves offsets after length changes", async () => {
    const { circuit, folder, entry } = native();
    folder.input.dependencies = [
      { id: "models", sha256: "a".repeat(64), mountPath: "models/library.inc" },
    ];
    const include = {
      path: "shared.inc",
      text: 'include "models/library.inc" // keep this comment\n',
    };
    folder.input.files.push(include);
    entry.text = entry.text.replace(
      "control",
      'include "../shared.inc"\r\ninclude "../shared.inc"\r\ncontrol',
    );
    const before = structuredClone(folder);
    const point = await prepareSourceExecutionInput(circuit, folder, caps, {
      environment: { corner: "ff" },
    });
    if (!point.ok) throw Error(JSON.stringify(point));
    const file = point.input.files.find((f) => f.path === include.path)!;
    expect(file.text).toBe(
      'include "models/library.inc" section=ff // keep this comment\n',
    );
    expect(point.input.preparedDeck).toBe(entry.text);
    const map = point.sourceMaps.find((m) => m.path === include.path)!;
    expect(locateSimulationText(map, file.text.indexOf("// keep"))).toEqual({
      kind: "authored",
      path: include.path,
      startOffset: include.text.indexOf("// keep"),
    });
    expect(folder).toEqual(before);
  });

  it("selects the run corner for an automatically included Profile and preserves nominal input", async () => {
    const { circuit, folder } = native(true);
    const before = structuredClone(folder);
    const point = await prepareSourceExecutionInput(circuit, folder, caps, {
      environment: { corner: "ff" },
    });
    if (!point.ok) throw Error(JSON.stringify(point));
    expect(point.input.environment.corner).toBe("ff");
    expect(point.input.preparedDeck).toContain(
      'include "../icm-models.inc" section=ff',
    );
    expect(folder).toEqual(before);
  });

  it("refuses unsupported or unused corner targets and retains conflicting-include diagnostics", async () => {
    const { circuit, folder, entry } = native(true);
    for (const corner of ["unknown", 'tt\nload "extra"']) {
      expect(
        await prepareSourceExecutionInput(circuit, folder, caps, {
          environment: { corner },
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_CORNER_UNSUPPORTED", recovery: "fix-input" },
      });
    }
    const withoutPolicy = structuredClone(caps);
    delete withoutPolicy.profiles[0]!.modelLibrary;
    expect(
      await prepareSourceExecutionInput(circuit, folder, withoutPolicy, {
        environment: { corner: "ff" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_CORNER_UNAVAILABLE" },
    });
    const codeOnly = native();
    expect(
      await prepareSourceExecutionInput(
        codeOnly.circuit,
        codeOnly.folder,
        caps,
        { environment: { corner: "ff" } },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_CORNER_UNAVAILABLE" },
    });
    folder.input.dependencies = [
      { id: "models", sha256: "a".repeat(64), mountPath: "models/library.inc" },
    ];
    entry.text = entry.text.replace(
      "control",
      'parameters BIAS=1\r\ninclude "../models/library.inc" section=ss\r\ninclude "../models/library.inc" section=tt\r\ncontrol',
    );
    expect(
      await prepareSourceExecutionInput(circuit, folder, caps, {
        environment: { corner: "ff" },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "SIMULATION_MODEL_CORNER_CONFLICT" }),
        ]),
      },
    });
    const conflict = await prepareSourceExecutionInput(circuit, folder, caps, {
      environment: { corner: "ff" },
      variables: [{ variableId: "BIAS", value: "0.123456789" }],
    });
    if (conflict.ok)
      throw Error("Conflicting nominal sections must stay diagnosable");
    expect(conflict.error.diagnostics?.[0]?.source?.startOffset).toBe(
      entry.text.indexOf('include "../models/library.inc"'),
    );
  });

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

  it("records authored temperature and parameter changes and applies a run-only temperature point", async () => {
    const { circuit, folder, entry } = native();
    const nominal = await prepareSourceExecutionInput(circuit, folder, caps);
    expect(nominal.ok, JSON.stringify(nominal)).toBe(true);
    if (!nominal.ok) return;
    entry.text = entry.text
      .replace("dc=1", "dc=2")
      .replace("analysis bias op", "options temp=125\r\nanalysis bias op");
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
    const point = await prepareSourceExecutionInput(circuit, folder, caps, {
      environment: { temperatureC: 135 },
    });
    if (!point.ok) throw Error(JSON.stringify(point));
    expect(point.input.preparedDeck).toContain(
      "options temp=125\r\noptions temp=135\r\nanalysis bias op",
    );
    expect(point.input.environment.temperatureC).toBe(135);
    expect(point.input.inputRevision).not.toBe(hot.input.inputRevision);
    expect(point.authoredFiles).toEqual(folder.input.files);
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
      // Dialect rejection is tested with a selected, advertised native Profile;
      // an unknown historical Profile now correctly fails selection first.
      const configFile = folder.input.files.find(
        (f) => f.path === folder.input.configPath,
      )!;
      const config = JSON.parse(configFile.text);
      config.environment.profileId = caps.profiles[0]!.id;
      configFile.text = JSON.stringify(config);
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
