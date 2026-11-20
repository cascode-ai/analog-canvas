import { describe, expect, it } from "vitest";

import { importSpiceSources } from "./importer.js";

const wide = (count: number) =>
  Array.from({ length: count }, (_, index) => `p${index}`).join(" ");

async function imported(text: string) {
  return importSpiceSources(
    [{ path: "top.sp", bytes: new TextEncoder().encode(text) }],
    "top.sp",
  );
}

describe("what a Project holds of one part", () => {
  it("refuses a call with more terminals than a part takes, by name and line", async () => {
    const result = await imported(
      [
        "* wide",
        `.subckt big ${wide(130)}`,
        "R1 p0 p1 1k",
        ".ends big",
        `.subckt top ${wide(130)}`,
        `X1 ${wide(130)} big`,
        ".ends top",
      ].join("\n"),
    );
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
  });

  it("takes a call of exactly as many terminals as a part holds", async () => {
    const result = await imported(
      [
        "* widest",
        `.subckt big ${wide(128)}`,
        "R1 p0 p1 1k",
        ".ends big",
        `.subckt top ${wide(128)}`,
        `X1 ${wide(128)} big`,
        ".ends top",
      ].join("\n"),
    );
    expect(
      result.diagnostics.filter(({ code }) => code === "SPICE_IMPORT_LIMIT"),
    ).toEqual([]);
  });
});
