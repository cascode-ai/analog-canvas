import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  lookupNativeHelp,
  nativeHelpInsertion,
  nativeAuthoringHelp,
  inspectNativeLanguage,
  nativeControlContext,
  nativeVoltageSelectorNode,
} from "./vacask-language.js";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";

describe("native language helpers", () => {
  it("shares inspectable postprocess helpers without evaluating or inventing measurements", () => {
    const help = nativeAuthoringHelp({ name: "embed", context: "circuit" });
    expect(help).toHaveLength(1);
    const text = nativeHelpInsertion(
      lookupNativeHelp("embed", "circuit")!,
      "Title\n",
    );
    expect(help[0]!.source).toBe(text);
    expect(text).toContain("def report_measurement(");
    expect(text).toContain("def report_plot(");
    expect(text).toContain('# report_measurement("gain"');
    expect(
      inspectNativeLanguage("run.sim", `Title\n${text}`, true).diagnostics,
    ).toEqual([]);
    expect(nativeAuthoringHelp({ name: "postprocess" })[0]!.source).toBe(
      'postprocess(PYTHON, "reports.py")',
    );
    expect(nativeAuthoringHelp({ name: "meas" })).toEqual([]);
    expect(
      nativeAuthoringHelp({ context: "control" }).every(
        (h) => h.context === "control",
      ),
    ).toBe(true);
    expect(help[0]!.reference).toMatch(
      /^https:\/\/codeberg.org\/.*\/input-embed.md$/u,
    );
  });
  it("does not skip the first declaration of an included file when allocating names", () => {
    const help = lookupNativeHelp("voltage source", "circuit")!;
    expect(
      nativeHelpInsertion(help, "model __vsource1 vsource\n", false),
    ).toContain("model __vsource2 vsource");
  });
  it("maps selectors to exact native node identity, not a lowercased display alias", () => {
    expect(nativeVoltageSelectorNode("v('X1:Out')")).toBe("X1:Out");
    expect(nativeVoltageSelectorNode("dv('X1:Out')")).toBe("X1:Out");
    expect(nativeVoltageSelectorNode("v('x1:out')")).toBe("x1:out");
    expect(nativeVoltageSelectorNode("v('a''b')")).toBe("a'b");
    expect(nativeVoltageSelectorNode("p(X1,gm)")).toBeUndefined();
    expect(nativeVoltageSelectorNode("v(out)\nclear saves")).toBeUndefined();
  });
  it("allocates case-sensitive analysis identities without inserting electrical defaults", () => {
    const help = lookupNativeHelp("analysis ac", "control")!;
    expect(
      nativeHelpInsertion(
        help,
        "Title\ncontrol\nanalysis AC1 ac\nanalysis ac1 ac\nendc",
      ),
    ).toBe("analysis ac2 ac ");
    expect(
      nativeHelpInsertion(help, "Title\ncontrol\nanalysis AC1 ac\nendc"),
    ).toBe("analysis ac1 ac ");
  });
  it("checks proven argument errors without rejecting unfamiliar native programs", () => {
    expect(
      inspectNativeLanguage("run.sim", "Title\ncontrol\nanalysis\nendc", true)
        .diagnostics,
    ).toMatchObject([{ code: "VACASK_COMMAND_ARGUMENTS" }]);
    expect(
      inspectNativeLanguage(
        "run.sim",
        "Title\ncontrol\nvar x = unknown_function(3)\nanalysis custom future_type\nendc",
        true,
      ).diagnostics,
    ).toEqual([]);
  });
  it("does not treat quoted/commented or embedded control words as boundaries", () => {
    expect(
      nativeControlContext("Title\n/* control */\nmodel control resistor"),
    ).toBe(false);
    expect(nativeControlContext('Title\ncontrol\nvar text="endc"')).toBe(true);
    expect(
      nativeControlContext('Title\nembed "file" <<<CODE\ncontrol\n>>>CODE'),
    ).toBe(false);
  });
});

it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
  "runs helper-authored sources, RCL, OP/AC/TRAN/Noise and a DC sweep in native VACASK",
  () => {
    let source = "Native helper qualification\n";
    const add = (name: string, nodes: string, value: string) => {
      const skeleton = nativeHelpInsertion(
        lookupNativeHelp(name, "circuit")!,
        source,
      );
      source += skeleton.replace("()", `(${nodes})`) + value + "\n";
    };
    add("voltage source", "in 0", '1 mag=1 type="dc"');
    add("current source", "out 0", "0");
    add("resistor", "in out", "1k");
    add("resistor", "out 0", "1k");
    add("capacitor", "out 0", "1n");
    add("resistor", "in aux", "1k");
    add("inductor", "aux 0", "1u");
    source += 'control\nabort always\noptions rawfile="ascii"\nsave default\n';
    for (const [type, args] of [
      ["op", ""],
      ["ac", 'from=1 to=1k mode="dec" points=3'],
      ["tran", "stop=10u step=1n maxstep=100n"],
      ["noise", 'out="out" in="V1" from=1 to=1k mode="dec" points=3'],
    ]) {
      if (type === "tran")
        source +=
          'alter instance("V1") type="pulse" val0=0 val1=1 delay=0 rise=1n fall=1n width=20u period=40u\n';
      source +=
        nativeHelpInsertion(
          lookupNativeHelp(`analysis ${type}`, "control")!,
          source,
        ) +
        args +
        "\n";
    }
    // Native pulse OP uses val0, not dc. Verify the distinction instead of
    // claiming SPICE's independent DC/TRAN semantics were preserved.
    source += 'analysis pulseop op\nalter instance("V1") type="dc"\n';
    source +=
      nativeHelpInsertion(lookupNativeHelp("sweep", "control")!, source) +
      'bias instance="V1" parameter="dc" from=0 to=1 step=0.5\nanalysis scan op\nendc\n';
    const cwd = mkdtempSync(join(tmpdir(), "icm-native-language-"));
    writeFileSync(join(cwd, "run.sim"), source);
    const startup = join(cwd, "startup.toml");
    writeFileSync(startup, "# controlled native language qualification\n");
    const run = spawnSync(
      process.env.VACASK_BIN!,
      ["--tomlfile", startup, "-n", "1", "-b", "1", "run.sim"],
      {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, SIM_MODULE_PATH: process.env.VACASK_MODULES },
      },
    );
    writeFileSync(join(cwd, "stdout.log"), run.stdout ?? "");
    writeFileSync(join(cwd, "stderr.log"), run.stderr ?? "");
    expect(run.error, cwd).toBeUndefined();
    expect(run.status, `${cwd}\n${run.stdout}\n${run.stderr}`).toBe(0);
    const values = (file: string, name: string) => {
      const parsed = parseVacaskRawfile(readFileSync(join(cwd, file), "utf8"));
      if (!parsed.ok) throw Error(parsed.error.message);
      const vector = parsed.plots[0]!.vectors.find(
        (v) => v.variable.name === name,
      )!;
      expect(vector, `${file}: ${name}`).toBeDefined();
      return vector.real;
    };
    expect(values("op1.raw", "out")[0]).toBeCloseTo(0.5, 10);
    expect(values("pulseop.raw", "out")[0]).toBeCloseTo(0, 10);
    expect(values("ac1.raw", "out")[0]).toBeCloseTo(0.5, 8);
    expect(values("tran1.raw", "out").at(-1)).toBeCloseTo(0.5, 6);
    expect(values("noise1.raw", "onoise")[0]).toBeGreaterThan(0);
    expect(values("scan.raw", "out")).toEqual([0, 0.25, 0.5]);
  },
);
