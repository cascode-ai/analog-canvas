import { describe, expect, it } from "vitest";

import { importSpiceSources } from "./importer.js";

const wide = (count: number) =>
  Array.from({ length: count }, (_, index) => `p${index}`).join(" ");

/** A call of `count` terminals to a subcircuit of as many Pins. */
async function imported(count: number) {
  const text = [
    "* wide",
    `.subckt big ${wide(count)}`,
    "R1 p0 p1 1k",
    ".ends big",
    `.subckt top ${wide(count)}`,
    `X1 ${wide(count)} big`,
    ".ends top",
  ].join("\n");
  return importSpiceSources(
    [{ path: "top.sp", bytes: new TextEncoder().encode(text) }],
    "top.sp",
  );
}

describe("what a Project holds of one part", () => {
  it("refuses a call with more terminals than a part takes, by name and line, and takes exactly as many", async () => {
    const result = await imported(130);
    expect(result.successful).toBe(false);
    expect(
      result.diagnostics.filter(({ severity }) => severity === "error"),
    ).toEqual([
      expect.objectContaining({
        code: "SPICE_IMPORT_LIMIT",
        message:
          "X1 has 130 terminals; a part takes at most 128, so the design cannot be imported as it is",
        sourceRef: expect.objectContaining({
          start: expect.objectContaining({ line: 6 }),
        }),
      }),
    ]);
    expect(
      (await imported(128)).diagnostics.filter(
        ({ code }) => code === "SPICE_IMPORT_LIMIT",
      ),
    ).toEqual([]);
  });
});
