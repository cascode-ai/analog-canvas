import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  type RichTextDocument,
  type RichTextRun,
  type RichTextStyle,
} from "@icm/model";

import { drawnSwitchPhase } from "./drawn-switch.js";

const text = (value: string): RichTextRun => ({ kind: "text", value });
const span = (
  style: RichTextStyle,
  ...children: RichTextRun[]
): RichTextRun => ({
  kind: "span",
  style,
  children,
});

/** The phase an Open switch S1 reads from its name label. */
function phaseOf(content: RichTextDocument) {
  const document = createEmptyProject("project", "Project").documents[0]!;
  const instance = {
    id: "S1",
    symbolId: "ideal-switch",
    placement: null,
    reference: "S1",
    netlist: { parameters: {} },
  };
  document.instances.push(instance);
  document.annotations.push({
    id: "label-S1",
    kind: "instance-label",
    anchor: {
      kind: "object",
      objectId: "S1",
      localOffset: { x: 20, y: 0 },
      fallbackPosition: { x: 20, y: 0 },
    },
    content,
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  return drawnSwitchPhase(document, instance);
}

describe("drawnSwitchPhase", () => {
  it("complements the phase when the bar covers only some characters", () => {
    expect(
      phaseOf({
        runs: [span("overbar", text("Φ")), span("subscript", text("1"))],
      }),
    ).toEqual({ name: "Φ1", complement: true, barredNet: "Φ_1_bar" });
  });

  it("does not complement the phase for a bar over no text", () => {
    expect(phaseOf({ runs: [text("EN"), span("overbar", text(" "))] })).toEqual(
      { name: "EN", complement: false },
    );
  });
});
