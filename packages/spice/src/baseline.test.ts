import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { compileSourceBundle } from "./compiler.js";
import {
  evaluateSpiceExpression,
  expressionIsStructurallyValid,
  parseSpiceNumber,
} from "./expression.js";
import { importCompileResult } from "./importer.js";
import { createSourceBundle } from "./source.js";
import type { SpiceSourceFile } from "./source-types.js";
import { parseSpiceSource } from "./syntax.js";

const encoder = new TextEncoder();
const fixture = (name: string): string =>
  readFileSync(resolve(process.cwd(), "fixtures/spice-baseline", name), "utf8");

describe("ngspice 46 core structural baseline", () => {
  it("round-trips exact source and elaborates every core connectivity family", async () => {
    const core = fixture("core.cir");
    const models = fixture("models.lib");
    const bundle = await createSourceBundle(
      [
        { path: "core.cir", bytes: encoder.encode(core) },
        { path: "models.lib", bytes: encoder.encode(models) },
      ],
      "core.cir",
    );

    expect(
      new Map(bundle.files.map((source) => [source.path, source.text])),
    ).toEqual(
      new Map([
        ["core.cir", core],
        ["models.lib", models],
      ]),
    );
    for (const syntaxFile of bundle.syntaxFiles) {
      expect(syntaxFile.statements).toHaveLength(
        syntaxFile.logicalLines.length,
      );
    }
    const matrix = JSON.parse(fixture("ngspice-46-core.json")) as {
      deviceFamilies: Record<string, string>;
    };
    const requiredPrefixes = Object.entries(matrix.deviceFamilies)
      .filter(([, status]) => status.startsWith("typed-"))
      .map(([prefix]) => prefix)
      .sort();
    const projectedPrefixes = [
      ...new Set(
        bundle.syntaxFiles
          .flatMap((file) => file.statements)
          .filter((statement) => statement.kind === "instance")
          .map((statement) => statement.name[0]!.toUpperCase()),
      ),
    ].sort();
    expect(projectedPrefixes).toEqual(requiredPrefixes);
    expect(bundle.dependencies).toMatchObject([
      { status: "resolved", section: "TT" },
    ]);

    const result = compileSourceBundle(bundle);
    expect(result.successful).toBe(true);
    expect(result.dialectEvidence).toMatchObject({
      dialect: "ngspice-46-core",
      confidence: "high",
    });
    expect(result.ir).not.toBeNull();
    const ir = result.ir!;
    const coreCell = ir.cells.find((cell) => cell.name === "core")!;
    expect(
      new Set(coreCell.instances.map((instance) => instance.target.kind)),
    ).toEqual(new Set(["primitive", "model", "subcircuit"]));
    expect(coreCell.instances.map((instance) => instance.name)).toContain(
      "RSELECT",
    );
    expect(coreCell.instances.map((instance) => instance.name)).not.toContain(
      "RSELECT_OFF",
    );
    expect(coreCell.instances).toHaveLength(26);
    expect(ir.models.map((model) => model.name)).toEqual([
      "DMOD",
      "QMOD",
      "JMOD",
      "ZMOD",
      "MMOD",
      "SMOD",
      "WMOD",
      "OMOD",
      "PMOD",
      "UMOD",
      "YMOD",
    ]);
    expect(
      ir.preservedStatements.filter(
        (statement) => statement.kind === "control",
      ),
    ).toHaveLength(4);
    expect(ir.unresolvedStatements).toEqual([]);

    const imported = importCompileResult(result);
    expect(imported.successful).toBe(false);
    expect(imported.project).toBeNull();
    expect(
      imported.diagnostics.filter(
        (item) => item.code === "SPICE_IMPORT_UNSUPPORTED_SYMBOL",
      ).length,
    ).toBeGreaterThan(0);
    expect(imported.diagnostics.map((item) => item.code)).toContain(
      "SPICE_IMPORT_NON_VISUAL_INSTANCE",
    );
  });

  it("recognizes every matrix dot command without turning it opaque", () => {
    const matrix = JSON.parse(fixture("ngspice-46-core.json")) as {
      dotCommands: string[];
    };
    const samples: Record<string, string[]> = {
      control: [".control", "run", ".endc"],
      else: [".if (1)", ".else", ".endif"],
      elseif: [".if (0)", ".elseif (1)", ".endif"],
      endc: [".control", ".endc"],
      endif: [".if (1)", ".endif"],
      ends: [".subckt x a", ".ends x"],
      func: [".func twice(x) {2*x}"],
      global: [".global VDD"],
      if: [".if (1)", ".endif"],
      include: [".include child.inc"],
      incpslt: [".incpslt child.lib"],
      lib: [".lib models.lib TT"],
      model: [".model DMOD D"],
      param: [".param X=1"],
      subckt: [".subckt x a", ".ends x"],
    };
    for (const command of matrix.dotCommands) {
      const lines = samples[command] ?? [`.${command} structural arguments`];
      const source: SpiceSourceFile = {
        id: `source-${command}`,
        path: `${command}.cir`,
        hash: "sha256:test",
        encoding: "utf-8",
        text: `${lines.join("\n")}\n`,
      };
      const syntax = parseSpiceSource(source);
      expect(
        syntax.statements.some((statement) => statement.kind === "opaque"),
        command,
      ).toBe(false);
    }
  });

  it("keeps excluded vendor surfaces recoverable and diagnostic", async () => {
    const text = fixture("vendor-extension.cir");
    const bundle = await createSourceBundle(
      [{ path: "vendor-extension.cir", bytes: encoder.encode(text) }],
      "vendor-extension.cir",
    );
    const result = compileSourceBundle(bundle, {
      dialect: "ngspice-46-core",
    });
    expect(result.successful).toBe(true);
    expect(result.dialectEvidence.confidence).toBe("explicit");
    expect(result.ir?.unresolvedStatements).toHaveLength(3);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "SPICE_SYNTAX_OPAQUE",
      "SPICE_SYNTAX_OPAQUE",
      "SPICE_SYNTAX_OPAQUE",
    ]);
    expect(bundle.files[0]!.text).toBe(text);
  });

  it("parses official scale factors and evaluates structural condition expressions", () => {
    expect(parseSpiceNumber("1Meg")?.value).toBe(1e6);
    expect(parseSpiceNumber("2kHz")?.value).toBe(2e3);
    expect(parseSpiceNumber("3m")?.value).toBe(3e-3);
    expect(parseSpiceNumber("4mil")?.value).toBeCloseTo(101.6e-6);
    expect(parseSpiceNumber("2K7")).toBeNull();
    expect(
      evaluateSpiceExpression("{SELECT == 1 && 2*BASE >= 2k}", {
        select: 1,
        base: 1e3,
      }),
    ).toBe(1);
    expect(expressionIsStructurallyValid("sqrt(4) + 2^3")).toBe(true);
    expect(expressionIsStructurallyValid("(1 + 2")).toBe(false);

    const parameterSource: SpiceSourceFile = {
      id: "source-parameters",
      path: "parameters.cir",
      hash: "sha256:test",
      encoding: "utf-8",
      text: ".param A = 1k B = {2 * A}\nV1 OUT 0 pulse (0 1 1n 1n 1n 5n 10n)\n",
    };
    const statements = parseSpiceSource(parameterSource).statements;
    const parameter = statements[0];
    const source = statements[1];
    expect(parameter).toMatchObject({
      kind: "parameter",
      parameters: [
        { name: "A", rawText: "1k" },
        { name: "B", rawText: "{2 * A}" },
      ],
    });
    expect(source).toMatchObject({
      kind: "instance",
      parameters: [{ name: "value", rawText: "pulse (0 1 1n 1n 1n 5n 10n)" }],
    });
  });

  it("retains plus and shell-style continuation spelling", () => {
    const text =
      [
        "Continuation fixture",
        "R1 A B 1k \\\\",
        " tc=1m",
        "C1 A B 2p",
        "+ ic=0",
        ".end",
      ].join("\n") + "\n";
    const source: SpiceSourceFile = {
      id: "source-continuation",
      path: "continuation.cir",
      hash: "sha256:test",
      encoding: "utf-8",
      text,
    };
    const syntax = parseSpiceSource(source);
    expect(syntax.logicalLines.map((line) => line.physicalLines)).toEqual([
      [1],
      [2, 3],
      [4, 5],
      [6],
    ]);
    expect(source.text).toBe(text);
  });

  it("terminates and preserves exact text for a deterministic fuzz corpus", () => {
    let state = 0x5eed1234;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,+-*/={}()_$;";
    for (let sample = 0; sample < 256; sample += 1) {
      const length = next() % 96;
      let text = "";
      for (let index = 0; index < length; index += 1) {
        text += alphabet[next() % alphabet.length];
      }
      text += sample % 2 === 0 ? "\n" : "\r\n";
      const source: SpiceSourceFile = {
        id: `source-fuzz-${sample}`,
        path: `fuzz-${sample}.cir`,
        hash: "sha256:test",
        encoding: "utf-8",
        text,
      };
      expect(() => parseSpiceSource(source)).not.toThrow();
      expect(source.text).toBe(text);
    }
  });
});
