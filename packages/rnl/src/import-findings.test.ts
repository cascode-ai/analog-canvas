import { describe, expect, it } from "vitest";

import {
  hasForeignDrawing,
  layoutHintFindings,
  runtimeFindings,
} from "./import-findings.js";
import type { RnlSnapshot } from "./rnl-snapshot.js";

type Finding = RnlSnapshot["diagnostics"][number];

const finding = (over: Partial<Finding>): Finding =>
  ({
    severity: "warning",
    code: "RNL4119",
    name: "pin-terminal-not-in-owner",
    file: "rnl-std-spice.rnl",
    full_path: "/rnl-std-spice.rnl",
    file_index: null,
    line: 37,
    col: 54,
    message: "pin 1 of $NMOS_4TERM binds no terminal of #XM1",
    ...over,
  }) as Finding;

describe("RNL's own findings in the import report", () => {
  it("gives one finding per kind and place, with how many there are", () => {
    expect(
      runtimeFindings([
        finding({}),
        finding({ message: "pin 1 of $NMOS_4TERM binds no terminal of #XM2" }),
        finding({ message: "pin 1 of $NMOS_4TERM binds no terminal of #XM3" }),
        finding({
          severity: "error",
          code: "RNL4206",
          name: "wire-no-pin",
          file: "top.sp",
          line: 24,
          col: 5,
          message: "#XM1:2 has no pin in its symbol: the wire fails",
        }),
      ]),
    ).toEqual([
      {
        severity: "warning",
        code: "RNL_IMPORT_RNL_FINDING",
        message:
          "RNL rnl-std-spice.rnl:37:54 RNL4119 pin-terminal-not-in-owner (3 times): pin 1 of $NMOS_4TERM binds no terminal of #XM1",
      },
      {
        severity: "warning",
        code: "RNL_IMPORT_RNL_ERROR",
        message:
          "RNL top.sp:24:5 RNL4206 wire-no-pin: #XM1:2 has no pin in its symbol: the wire fails",
      },
    ]);
  });

  it("leaves out hints and the notes of the tools and the implementation", () => {
    expect(
      runtimeFindings([
        finding({ severity: "hint", code: "RNL9404" }),
        finding({ code: "RNL9001", name: "host-element-unsupported" }),
        finding({ code: "RNL7003", name: "looks-joined" }),
      ]),
    ).toEqual([]);
    expect(
      runtimeFindings([finding({ severity: "violation", code: "RNL6001" })]),
    ).toEqual([expect.objectContaining({ code: "RNL_IMPORT_RNL_FINDING" })]);
  });
});

type Levels = Parameters<typeof layoutHintFindings>[0];
type SnapshotLevels = Parameters<typeof layoutHintFindings>[1]["levels"];

const hint = (kind: string, code: string, line: number, message: string) => ({
  kind,
  code,
  severity: "hint",
  message,
  file: "top.sp",
  file_index: 0,
  line,
});

const placed = { at: { value: [0, 0] }, kind: "instance" };

describe("RNL's layout hints in the import report", () => {
  const level = (title: string, hints: ReturnType<typeof hint>[]) =>
    ({ title, kind: "subckt", hints }) as unknown as Levels[number];
  const snapshot = (canvasWritten: string[], names: string[]) => ({
    levels: names.map((name) => ({
      name,
      kind: "subckt",
      model: {
        objects: [
          placed,
          ...(canvasWritten.includes(name)
            ? [{ kind: "usage", definition: "$CANVAS_TYPESETTING" }]
            : []),
        ],
      },
    })) as unknown as SnapshotLevels,
  });

  it("names each hint by its line, but not on a level Analog Canvas wrote, nor dots or values Analog Canvas draws its own way", () => {
    expect(
      layoutHintFindings(
        [
          level("amp", [
            hint(
              "wire-over-symbol",
              "RNL7013",
              32,
              "the wire of &X runs over the symbol of #M3",
            ),
            hint("no-dot", "RNL7006", 28, "&B joins at (0, 2) without a dot"),
            hint(
              "text-over-text",
              "RNL7012",
              14,
              'the value "1p" of #C1 lies over the value "1n" of #L1',
            ),
          ]),
          level("bias", [
            hint("wire-over-text", "RNL7014", 40, "runs over a name"),
          ]),
        ],
        snapshot(["bias"], ["amp", "bias"]),
      ),
    ).toEqual([
      {
        severity: "warning",
        code: "RNL_IMPORT_LAYOUT_HINT",
        message:
          "RNL top.sp:32 RNL7013 wire-over-symbol: the wire of &X runs over the symbol of #M3",
      },
    ]);
  });

  it("reports at most 30 and counts the rest", () => {
    const many = Array.from({ length: 33 }, (_, index) =>
      hint("crossings", "RNL7001", index + 1, `crossing ${index}`),
    );
    const found = layoutHintFindings(
      [level("amp", many)],
      snapshot([], ["amp"]),
    );
    expect(found).toHaveLength(31);
    expect(found.at(-1)?.message).toBe(
      "3 more layout hints; fix those above and import again",
    );
  });

  it("asks for hints only where a level another tool wrote draws something", () => {
    expect(hasForeignDrawing(snapshot([], ["amp"]))).toBe(true);
    expect(hasForeignDrawing(snapshot(["amp"], ["amp"]))).toBe(false);
  });
});
