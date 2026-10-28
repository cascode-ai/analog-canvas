import { describe, expect, it } from "vitest";
import {
  type Annotation,
  type RichTextDocument,
  type RichTextRun,
} from "@icm/model";

import { liveAgentEditor } from "./live-agent-editor.test-support";

/**
 * An Agent stores how a bound name label looks with `edit-text` and RichText
 * that spells the name, as the label editor does: the display is the
 * author's, the name stays (#1881).
 */
const text = (value: string): RichTextRun => ({ kind: "text", value });
const script = (
  style: "subscript" | "superscript",
  value: string,
): RichTextRun => ({ kind: "span", style, children: [text(value)] });
const asWritten = (value: string): RichTextDocument => ({
  runs: [text(value)],
});

async function editor() {
  const live = liveAgentEditor();
  await live.client.connect("session-1.code");
  type Action = Parameters<typeof live.client.applyActions>[0][number];
  /** Each action in its own call, as a drawer sends them. */
  const apply = async (...actions: Action[]) => {
    for (const action of actions) {
      const report = await live.client.applyActions([action]);
      expect(report.ok, report.message).toBe(true);
    }
  };
  const document = () => live.controller.document;
  const labelOf = (objectId: string): Annotation =>
    document().annotations.find(
      (annotation) =>
        annotation.kind === "instance-label" &&
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === objectId,
    )!;
  return { ...live, apply, document, labelOf };
}

describe("an Agent sets how a name label looks (#1881)", () => {
  it("restyles a Reference, alias, Cell Pin and Net label without renaming, and keeps the look across a rename", async () => {
    const { apply, document, labelOf } = await editor();
    const place = (symbol: string, id: string, x: number, y: number) => ({
      kind: "place-component" as const,
      symbol,
      id,
      position: { x, y },
    });
    await apply(
      { ...place("capacitor", "cv1", 0, 0), reference: "CV1" },
      place("opamp", "amp", 300, 0),
      { ...place("port", "pin", -200, 200), reference: "Vin" },
      { ...place("resistor", "r1", 0, 300), reference: "R1" },
      { ...place("resistor", "r2", 200, 300), reference: "R2" },
      { ...place("resistor", "rl", 400, 300), reference: "R_L" },
      {
        kind: "set-display-alias",
        target: { kind: "instance", id: "amp" },
        text: "AMP1",
      },
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "pin", instance: "R2", pin: "1" },
      },
      {
        kind: "add-label",
        target: { kind: "pin", instance: "R1", pin: "2" },
        text: "V_in",
      },
    );
    const netLabel = () =>
      document().annotations.find(
        (annotation) => annotation.kind === "net-label",
      )!;
    const netName = () =>
      document().connectivityEvidence.find(
        (evidence) => evidence.kind === "name-claim",
      )?.name;
    // The standard looks: C over a V1 subscript, AMP over a 1 subscript.
    expect(labelOf("cv1").formatOverride?.runs).toHaveLength(2);
    expect(labelOf("amp").content?.runs).toHaveLength(2);
    expect(netName()).toBe("V_in");

    const pinLook: RichTextDocument = {
      runs: [text("V"), script("superscript", "in")],
    };
    const netLook: RichTextDocument = {
      runs: [text("V"), script("subscript", "in")],
    };
    await apply(
      // Shown as written.
      {
        kind: "edit-text",
        target: { kind: "annotation", id: labelOf("cv1").id },
        text: asWritten("CV1"),
      },
      {
        kind: "edit-text",
        target: { kind: "annotation", id: labelOf("amp").id },
        text: asWritten("AMP1"),
      },
      // R_L drawn R over an L subscript, now written out with its `_`.
      {
        kind: "edit-text",
        target: { kind: "annotation", id: labelOf("rl").id },
        text: asWritten("R_L"),
      },
      // The Pin's own look, its name kept.
      {
        kind: "edit-text",
        target: { kind: "annotation", id: labelOf("pin").id },
        text: pinLook,
      },
      // The `_` before a subscript may be left out: V_in keeps its name.
      {
        kind: "edit-text",
        target: { kind: "annotation", id: netLabel().id },
        text: netLook,
      },
    );
    expect(labelOf("cv1").formatOverride).toEqual(asWritten("CV1"));
    expect(document().instances.find((i) => i.id === "cv1")!.reference).toBe(
      "CV1",
    );
    expect(labelOf("amp").content).toEqual(asWritten("AMP1"));
    expect(labelOf("rl").formatOverride).toEqual(asWritten("R_L"));
    expect(document().instances.find((i) => i.id === "rl")!.reference).toBe(
      "R_L",
    );
    expect(labelOf("amp").binding).toBeUndefined();
    expect(labelOf("pin").formatOverride).toEqual(pinLook);
    expect(document().netlist!.terminals.map((t) => t.name)).toEqual(["Vin"]);
    expect(netLabel().formatOverride).toEqual(netLook);
    expect(netName()).toBe("V_in");

    // A rename keeps the author's styling around the new text.
    await apply(
      {
        kind: "set-reference",
        target: { kind: "instance", id: "cv1" },
        reference: "CV2",
      },
      {
        kind: "edit-text",
        target: { kind: "annotation", id: netLabel().id },
        text: "V_out",
      },
    );
    expect(labelOf("cv1").formatOverride).toEqual(asWritten("CV2"));
    expect(netName()).toBe("V_out");
    expect(netLabel().formatOverride).toEqual({
      runs: [text("V"), script("subscript", "out")],
    });
  });

  it("refuses a Cell Pin display that does not spell its name, naming the rule", async () => {
    const { apply, client, document, labelOf } = await editor();
    await apply({
      kind: "place-component",
      symbol: "port",
      id: "pin",
      reference: "Vin",
      position: { x: 0, y: 0 },
    });
    const before = document().revision;
    const refused = await client.applyActions([
      {
        kind: "edit-text",
        target: { kind: "annotation", id: labelOf("pin").id },
        text: { runs: [text("V"), script("subscript", "out")] },
      },
    ]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain(
      "A label's display must spell its name Vin",
    );
    expect(document().revision).toBe(before);
  });
});
