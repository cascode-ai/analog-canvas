import { describe, expect, it } from "vitest";
import {
  currentControlOptions,
  currentControlPair,
  currentTerminalKey,
} from "./current-control-options";

describe("current terminal lists", () => {
  const devices = [
    { id: "r", reference: "R1", symbolId: "resistor", placement: null },
    { id: "m", reference: "M1", symbolId: "nmos", placement: null },
  ];
  const options = currentControlOptions(devices, (i) =>
    i.id === "r" ? ["1", "2", "1"] : ["D", "G", "S", "B"],
  );
  it("deduplicates pins and uses the same two-terminal / MOS D-S pairs as Pick", () => {
    expect(options.map((o) => o.label)).toEqual([
      "R1.1",
      "R1.2",
      "M1.D",
      "M1.S",
    ]);
    expect(options[0]?.partners).toEqual([currentTerminalKey("r", "2")]);
    expect(options[2]?.partners).toEqual([currentTerminalKey("m", "S")]);
  });
  it("projects polarity without rewriting the measured terminal", () => {
    expect(
      currentControlPair(options, {
        instanceId: "m",
        pinName: "D",
        direction: "into",
      }),
    ).toEqual({
      positive: currentTerminalKey("m", "D"),
      negative: currentTerminalKey("m", "S"),
    });
    expect(
      currentControlPair(options, {
        instanceId: "m",
        pinName: "D",
        direction: "out",
      }),
    ).toEqual({
      positive: currentTerminalKey("m", "S"),
      negative: currentTerminalKey("m", "D"),
    });
    expect(currentControlPair(options, undefined)).toEqual({
      positive: "",
      negative: "",
    });
    expect(
      currentControlPair(options, {
        instanceId: "deleted",
        pinName: "D",
        direction: "into",
      }),
    ).toEqual({ positive: "", negative: "" });
  });
});
