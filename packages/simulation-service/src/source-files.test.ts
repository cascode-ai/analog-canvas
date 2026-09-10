import { describe, expect, it } from "vitest";
import { sha256 } from "./content-digest.js";
import { planSimulationSourceChanges } from "./source-files.js";

describe("atomic source text changes", () => {
  it("applies all UTF-16 patches to the same original text and retains CRLF", async () => {
    const text = "* 中文 🧪\r\nR1 a b 1k\r\nR2 b 0 2k\r\n";
    const textDigest = await sha256(text);
    const current = [{ path: "tb.spice", text }];
    const result = await planSimulationSourceChanges(current, {
      writes: [],
      removes: [],
      patches: ["1k", "2k"].map((value, index) => ({
        path: "tb.spice",
        textDigest,
        startOffset: text.indexOf(value),
        endOffset: text.indexOf(value) + 2,
        text: `${index + 3}k`,
      })),
    });
    expect(result).toEqual({
      ok: true,
      files: [
        {
          path: "tb.spice",
          text: text.replace("1k", "3k").replace("2k", "4k"),
        },
      ],
    });
    expect(current[0]!.text).toBe(text);
  });

  it("rejects a whole batch when one file digest is stale", async () => {
    const current = [{ path: "run.cir", text: "op\n" }];
    const result = await planSimulationSourceChanges(current, {
      removes: [],
      writes: [{ path: "experiment.json", text: "{" }],
      patches: [
        {
          path: "run.cir",
          textDigest: "a".repeat(64),
          startOffset: 0,
          endOffset: 2,
          text: "ac",
        },
      ],
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_TEXT_REVISION_CONFLICT",
        stage: "input",
        recovery: "fix-input",
      },
    });
    expect(current).toEqual([{ path: "run.cir", text: "op\n" }]);
  });

  it("rejects generated/dependency writes and unsafe removes", async () => {
    expect(
      await planSimulationSourceChanges(
        [],
        {
          writes: [{ path: "circuit.spice", text: "M1 0 0 0 0 n" }],
          removes: [],
          patches: [],
        },
        ["circuit.spice"],
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_GENERATED_FILE_READ_ONLY" },
    });
    expect(
      await planSimulationSourceChanges([], {
        writes: [],
        removes: ["../a"],
        patches: [],
      }),
    ).toMatchObject({ ok: false, error: { code: "SIMULATION_FILE_INVALID" } });
  });

  it("accepts atomic rename and intentionally invalid syntax without running it", async () => {
    const result = await planSimulationSourceChanges(
      [{ path: "old.cir", text: "op" }],
      {
        writes: [{ path: "new.cir", text: ".control\nac dec" }],
        removes: ["old.cir"],
        patches: [],
      },
    );
    expect(result).toEqual({
      ok: true,
      files: [{ path: "new.cir", text: ".control\nac dec" }],
    });
  });

  it("rejects overlapping ranges and edits that split a surrogate pair", async () => {
    const text = "x🧪y";
    const textDigest = await sha256(text);
    const patch = {
      path: "run.cir",
      textDigest,
      startOffset: 1,
      endOffset: 3,
      text: "z",
    };
    const current = [{ path: "run.cir", text }];
    expect(
      await planSimulationSourceChanges(current, {
        writes: [],
        removes: [],
        patches: [patch, patch],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_FILE_OVERLAPPING_EDIT" },
    });
    expect(
      await planSimulationSourceChanges(current, {
        writes: [],
        removes: [],
        patches: [{ ...patch, startOffset: 2 }],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_TEXT_RANGE_INVALID" },
    });
    expect(
      await planSimulationSourceChanges(current, {
        writes: current,
        removes: [],
        patches: [patch],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_FILE_OVERLAPPING_EDIT" },
    });
  });
});
