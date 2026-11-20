import { describe, expect, it } from "vitest";

import { compileSpiceSources } from "./compiler.js";
import { importCompileResult } from "./importer.js";
import { statementLedger } from "./ledger.js";

async function compiled(text: string) {
  return compileSpiceSources(
    [{ path: "top.sp", bytes: new TextEncoder().encode(text) }],
    "top.sp",
  );
}

describe("statement ledger", () => {
  it("gives each statement one fate and calls the ledger complete", async () => {
    const result = await compiled("Title\nR1 a 0 1k\n.op\n.end\n");
    const ledger = statementLedger(result, importCompileResult(result));
    expect(ledger.entries.map(({ line, fate }) => `${line} ${fate}`)).toEqual([
      "1 preserved",
      "2 instance",
      "3 preserved",
      "4 preserved",
    ]);
    expect(ledger.complete).toBe(true);
  });

  it("leaves coverage unknown where a statement was given two fates", async () => {
    const result = await compiled("* one\nR1 a 0 1k\n.end\n");
    const instance = result.statementFates!.find(
      ({ fate }) => fate === "instance",
    )!;
    const doubled = {
      ...result,
      statementFates: [
        ...result.statementFates!,
        { ...instance, fate: "preserved" as const },
      ],
    };
    const ledger = statementLedger(doubled, importCompileResult(result));
    expect(ledger.entries.find(({ line }) => line === 2)).toMatchObject({
      fate: "unknown",
      reason: "given instance and preserved",
    });
    expect(ledger.complete).toBe(false);
  });

  it("leaves coverage unknown where a statement was given none", async () => {
    const result = await compiled("* one\nR1 a 0 1k\n.end\n");
    const ledger = statementLedger(
      {
        ...result,
        statementFates: result.statementFates!.filter(
          ({ fate }) => fate !== "instance",
        ),
      },
      importCompileResult(result),
    );
    expect(ledger.entries.find(({ line }) => line === 2)?.fate).toBe("unknown");
    expect(ledger.complete).toBe(false);
  });
});
