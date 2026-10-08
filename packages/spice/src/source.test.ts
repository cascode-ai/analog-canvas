import { describe, expect, it } from "vitest";

import { createSourceBundle } from "./source.js";

const encoder = new TextEncoder();
const input = (path: string, text: string) => ({
  path,
  bytes: encoder.encode(text),
});

describe("SPICE SourceBundle", () => {
  it("retains exact text and source spans across continuations", async () => {
    const text =
      "\ufeff.subckt cell A B\r\nR0 A B 1k\r\n+ tc=1\r\n.ends cell\r\n";
    const bundle = await createSourceBundle(
      [{ path: "circuit.spi", bytes: encoder.encode(text) }],
      "circuit.spi",
    );
    expect(bundle.diagnostics).toEqual([]);
    expect(bundle.files[0]!.encoding).toBe("utf-8-bom");
    const entry = bundle.files.find((file) => file.id === bundle.entryFileId);
    expect(entry?.text).toBe(text.slice(1));
    const resistor = bundle.syntaxFiles[0]!.logicalLines[1]!;
    expect(resistor.text).toBe("R0 A B 1k tc=1");
    expect(resistor.rawText).toBe("R0 A B 1k\r\n+ tc=1");
    expect(resistor.physicalLines).toEqual([2, 3]);
    expect(resistor.sourceRef).toEqual({
      fileId: bundle.entryFileId,
      start: { offset: 18, line: 2, column: 1 },
      end: { offset: 35, line: 3, column: 7 },
    });
  });

  it("resolves local includes and suppresses duplicates", async () => {
    const bundle = await createSourceBundle(
      [
        input("circuit.spi", '.include "models.inc"\n.include models.inc\n'),
        input("models.inc", ".model dtest D (is=1e-15)\n"),
        input("unused.spi", ".subckt unused A B\n.ends unused\n"),
      ],
      "circuit.spi",
    );
    expect(bundle.files.map((file) => file.path)).toEqual([
      "circuit.spi",
      "models.inc",
    ]);
    expect(bundle.dependencies.map((item) => item.status)).toEqual([
      "resolved",
      "duplicate",
    ]);
    expect(bundle.diagnostics.map((item) => item.code)).toEqual([
      "SPICE_SOURCE_INCLUDE_DUPLICATE",
    ]);
  });

  it("reports missing, cyclic, and root-escaping includes", async () => {
    const missing = await createSourceBundle(
      [input("circuit.spi", ".include absent.inc\n")],
      "circuit.spi",
    );
    expect(missing.dependencies[0]!.status).toBe("missing");
    expect(missing.diagnostics[0]!.sourceRef?.start.line).toBe(1);

    const cycle = await createSourceBundle(
      [input("a.spi", ".include b.spi\n"), input("b.spi", ".include a.spi\n")],
      "a.spi",
    );
    expect(cycle.dependencies.map((item) => item.status)).toEqual([
      "resolved",
      "cycle",
    ]);
    expect(
      cycle.diagnostics.some(
        (item) => item.code === "SPICE_SOURCE_INCLUDE_CYCLE",
      ),
    ).toBe(true);

    const denied = await createSourceBundle(
      [
        input("root/circuit.spi", ".include ../outside.inc\n"),
        input("outside.inc", ".model dtest D\n"),
      ],
      "root/circuit.spi",
    );
    expect(denied.dependencies[0]!.status).toBe("denied");
    expect(denied.files.map((file) => file.path)).toEqual(["root/circuit.spi"]);
  });
});
