import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";
import { SimulationSourceInputSchema, SourceSpanSchema } from "@icm/model";
import {
  inspectVacaskSource,
  inspectVacaskSourceGraph,
} from "./vacask-source.js";

function graph(files: Record<string, string>, extra: object = {}) {
  return inspectVacaskSourceGraph(
    SimulationSourceInputSchema.parse({
      kind: "source",
      entry: "tb/run.sim",
      configPath: "experiment.json",
      files: Object.entries(files).map(([path, text]) => ({ path, text })),
      circuitBindings: [],
      dependencies: [],
      ...extra,
    }),
  );
}
describe("native VACASK lexical source ownership", () => {
  it("preserves case, mixed identifiers, comments, bracketed newlines and source offsets", () => {
    const text =
      "Title\r\n  X'1' (\r\n Out /* comment */ out 'v''dd'\r\n) DUT p=(1 +\r\n 2) // ignored\r\nparameters scale=$scale \\\r\n other=3\r\n";
    const parsed = inspectVacaskSource("run.sim", text, true);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.statements).toHaveLength(2);
    const first = parsed.statements[0]!;
    expect(first.tokens.map((t) => t.value)).toEqual([
      "X1",
      "(",
      "Out",
      "out",
      "v'dd",
      ")",
      "DUT",
      "p",
      "=",
      "(",
      "1",
      "+",
      "2",
      ")",
    ]);
    expect(first.sourceRef.start).toEqual({ offset: 9, line: 2, column: 3 });
    for (const s of parsed.statements) {
      expect(SourceSpanSchema.safeParse(s.sourceRef).success).toBe(true);
      expect(text.slice(s.sourceRef.start.offset, s.sourceRef.end.offset)).toBe(
        s.rawText,
      );
      for (const t of s.tokens) expect(text.slice(t.start, t.end)).not.toBe("");
    }
    expect(parsed.statements[1]!.tokens.map((t) => t.value)).toContain("other");
  });
  it("does not inspect includes inside comments, short strings or embedded programs", () => {
    const result = graph({
      "tb/run.sim":
        'Title\n/* include "bad1" */\nparameters msg="include \\"bad2\\""\nembed "script.py" <<<PY\ninclude "bad3"\n>>>PY\ninclude "ok.inc" // include "bad4"\n',
      "tb/ok.inc": "R (Out 0) resistance r=1k\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.paths).toEqual(["tb/run.sim", "tb/ok.inc"]);
    expect(
      result.statements.find((s) => s.statement.tokens[0]?.value === "embed")
        ?.statement.tokens[2]?.value,
    ).toContain('include "bad3"');
  });
  it("decodes file string escapes and preserves first-line fragments and repeated includes", () => {
    const result = graph({
      "tb/run.sim": 'Title\ninclude "a\\056inc"\ninclude "a.inc"\n',
      "tb/a.inc": "R (a 0) resistance r=1k\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.paths).toEqual(["tb/run.sim", "tb/a.inc", "tb/a.inc"]);
    expect(
      result.statements.filter((s) => s.statement.tokens[0]?.value === "R"),
    ).toHaveLength(2);
  });
  it("selects case-sensitive sections and does not inspect inactive dependencies", () => {
    const result = graph({
      "tb/run.sim": 'Title\ninclude "../models.inc" section=TT\n',
      "models.inc":
        'section TT\ninclude "good.inc"\nendsection\nsection tt\ninclude "missing.inc"\nendsection\n',
      "good.inc": "parameters W=1u\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.paths).toEqual(["tb/run.sim", "models.inc", "good.inc"]);
    const wrong = graph({
      "tb/run.sim": 'Title\ninclude "../models.inc" section=Tt\n',
      "models.inc": "section TT\nendsection\n",
    });
    expect(wrong.diagnostics.map((d) => d.code)).toEqual([
      "SIMULATION_LIBRARY_SECTION_MISSING",
    ]);
  });
  it("uses owner-relative files before the run-root fallback, never host search paths", () => {
    const files = {
      "tb/run.sim": 'Title\ninclude "local.inc"\ninclude "shared.inc"\n',
      "tb/local.inc": "parameters local=1\n",
      "local.inc": "parameters WRONG=1\n",
      "shared.inc": "parameters shared=1\n",
    };
    expect(graph(files).paths).toEqual([
      "tb/run.sim",
      "tb/local.inc",
      "shared.inc",
    ]);
    expect(graph(files).diagnostics).toEqual([]);
  });
  it("retains opaque generated and model owners without pretending to parse their bytes", () => {
    const result = graph(
      {
        "tb/run.sim":
          'Title\ninclude "../circuit.inc"\ninclude "../models.inc" section=TT\n',
      },
      {
        circuitBindings: [
          {
            id: "b",
            documentId: "dut",
            emission: "subcircuit",
            path: "circuit.inc",
          },
        ],
        dependencies: [
          { id: "m", mountPath: "models.inc", sha256: "a".repeat(64) },
        ],
      },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.paths).toEqual(["tb/run.sim", "circuit.inc", "models.inc"]);
  });
  it("reports cycles, missing files, path escapes and config includes with source locations", () => {
    const result = graph({
      "tb/run.sim":
        'Title\ninclude "run.sim"\ninclude "missing.inc"\ninclude "../../escape"\ninclude "../experiment.json"\n',
      "experiment.json": "{}",
    });
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "SIMULATION_INCLUDE_CYCLE",
      "SIMULATION_FILE_MISSING",
      "SIMULATION_INCLUDE_PATH",
      "SIMULATION_INCLUDE_CONFIG",
    ]);
    expect(result.diagnostics.every((d) => d.sourceRef)).toBe(true);
  });
  it.each([
    'include "unfinished',
    "/* unfinished",
    "parameters x=(1+2",
    'parameters x="unfinished',
    "R'bad name (a 0) r",
    'embed "x" <<<END\nunclosed',
  ])("retains lexical failure diagnostics for %s", (source) => {
    expect(
      graph({ "tb/run.sim": `Title\n${source}\n` }).diagnostics.some(
        (d) => d.code === "VACASK_SOURCE_SYNTAX",
      ),
    ).toBe(true);
  });
  it("does not silently interpret SPICE or foreign-language includes as native input", () => {
    for (const source of [
      '.include "model.spice"',
      'include "model.spice" lang=ngspice',
      "include variable",
    ]) {
      const result = graph({ "tb/run.sim": `Title\n${source}\n` });
      expect(
        result.diagnostics.some((d) => d.code === "VACASK_SOURCE_SYNTAX"),
      ).toBe(true);
      expect(result.includes).toEqual([]);
    }
  });
  it("retains unfamiliar native programs without imposing a small supported-command whitelist", () => {
    const result = graph({
      "tb/run.sim":
        'Title\ncontrol\nvar answer = custom(1, [2, 3])\npostprocess(PYTHON, "work.py")\nendc\n',
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.statements).toHaveLength(4);
  });
  it("does not confuse quoted identifiers with include or section keywords", () => {
    const result = graph({
      "tb/run.sim":
        "Title\n'include' (a 0) source\nin'clude' (b 0) source\n'section' (c 0) source\n'.device' (d 0) source\n",
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.includes).toEqual([]);
    expect(result.statements).toHaveLength(4);
  });
  it("does not unquote an already decoded filename a second time", () => {
    const result = graph({
      "tb/run.sim": `Title\ninclude "'model.inc'"\n`,
      "tb/'model.inc'": "parameters x=1\n",
      "tb/model.inc": 'include "wrong.inc"\n',
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.paths).toEqual(["tb/run.sim", "tb/'model.inc'"]);
  });
  it("reads only the first selected native section", () => {
    const result = graph({
      "tb/run.sim": 'Title\ninclude "models.inc" section=TT\n',
      "tb/models.inc":
        'section FF\ninclude "missing1"\nendsection\nsection TT\nparameters x=1\nendsection\nsection TT\ninclude "missing2"\nendsection\n',
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.statements.map((s) => s.statement.rawText)).toEqual([
      'include "models.inc" section=TT',
      "parameters x=1",
    ]);
  });
  it.each([
    ['include "models.inc"', "section TT\nparameters x=1\nendsection\n"],
    ['include "models.inc"', "endsection\n"],
    [
      'include "models.inc" section=TT',
      "section TT\nsection NESTED\nendsection\nendsection\n",
    ],
    ['include "models.inc" section=TT', "section TT\nparameters x=1\n"],
  ])("rejects invalid native section lifetime: %s / %s", (include, library) => {
    const result = graph({
      "tb/run.sim": `Title\n${include}\n`,
      "tb/models.inc": library,
    });
    expect(result.diagnostics.map((d) => d.code)).toContain(
      "SIMULATION_LIBRARY_SECTION_INVALID",
    );
  });
  it.each(["'TT'", "T'T'", "1TT", "TT.foo"])(
    "rejects non-bare native section selector %s",
    (name) => {
      const result = graph({
        "tb/run.sim": `Title\ninclude "models.inc" section=${name}\n`,
      });
      expect(result.diagnostics.map((d) => d.code)).toEqual([
        "VACASK_SOURCE_SYNTAX",
      ]);
      expect(result.includes).toEqual([]);
    },
  );
  it("keeps malformed EOF spans inside their source bytes", () => {
    const text = 'Title\nparameters x=("unfinished\\';
    const parsed = inspectVacaskSource("run.sim", text, true);
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    for (const d of parsed.diagnostics) {
      expect(d.sourceRef!.end.offset).toBeLessThanOrEqual(text.length);
      expect(SourceSpanSchema.safeParse(d.sourceRef).success).toBe(true);
    }
  });
});

// Explicit kernel evidence; no fake success when the pinned runtime is absent.
it.skipIf(!process.env.VACASK_BIN)(
  "matches native section/include semantics in the actual kernel",
  () => {
    const body =
      '\nground 0\nmodel voltage vsource\nV (Out 0) voltage dc=level\ncontrol\nabort always\noptions rawfile="ascii" strictsave=2\nsave default\nanalysis proof op\nendc\n';
    const variants = [
      {
        name: "valid",
        include: 'include "models.inc" section=TT',
        library:
          'section tt\ninclude "missing.inc"\nendsection\nsection TT\ninclude "\'value.inc\'"\nendsection\nsection TT\ninclude "missing-again.inc"\nendsection\n',
        ok: true,
      },
      {
        name: "unselected",
        include: 'include "models.inc"',
        library: "section TT\nparameters level=3\nendsection\n",
        ok: false,
      },
      {
        name: "unclosed",
        include: 'include "models.inc" section=TT',
        library: "section TT\nparameters level=3\n",
        ok: false,
      },
      {
        name: "nested",
        include: 'include "models.inc" section=TT',
        library:
          "section TT\nsection nested\nparameters level=3\nendsection\nendsection\n",
        ok: false,
      },
    ];
    for (const variant of variants) {
      const files = {
        "tb/run.sim": `Source graph kernel proof\n${variant.include}\n${body}`,
        "tb/models.inc": variant.library,
        "tb/'value.inc'": "parameters level=3\n",
      };
      expect(graph(files).diagnostics.length === 0, variant.name).toBe(
        variant.ok,
      );
      const cwd = mkdtempSync(
        join(tmpdir(), `icm-native-source-${variant.name}-`),
      );
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), text);
      }
      const startup = join(cwd, "vacaskrc.toml");
      writeFileSync(startup, "# controlled source-graph qualification\n");
      const run = spawnSync(
        process.env.VACASK_BIN!,
        ["--tomlfile", startup, "-n", "1", "-b", "1", "tb/run.sim"],
        {
          cwd,
          encoding: "utf8",
          windowsHide: true,
          timeout: 15000,
        },
      );
      writeFileSync(join(cwd, "stdout.log"), run.stdout ?? "");
      writeFileSync(join(cwd, "stderr.log"), run.stderr ?? "");
      expect(run.error, cwd).toBeUndefined();
      expect(run.status === 0, `${cwd}\n${run.stdout}\n${run.stderr}`).toBe(
        variant.ok,
      );
      if (variant.ok) {
        const raw = parseVacaskRawfile(
          readFileSync(join(cwd, "proof.raw"), "utf8"),
        );
        if (!raw.ok) throw new Error(raw.error.message);
        expect(
          raw.plots[0]!.vectors.find((v) => v.variable.name === "Out")!.real[0],
        ).toBe(3);
      }
    }
  },
);
