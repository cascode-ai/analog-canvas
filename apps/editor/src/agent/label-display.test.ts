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

const place = (symbol: string, id: string, x: number, reference?: string) => ({
  kind: "place-component" as const,
  symbol,
  id,
  position: { x, y: 0 },
  ...(reference ? { reference } : {}),
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
        (annotation.kind === "instance-label" ||
          annotation.kind === "power-label") &&
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === objectId,
    )!;
  const restyle = (annotation: Annotation, look: RichTextDocument) => ({
    kind: "edit-text" as const,
    target: { kind: "annotation" as const, id: annotation.id },
    text: look,
  });
  return { ...live, apply, document, labelOf, restyle };
}

/** A Net named `name` by a label on the wire between R1 and R2. */
async function labelledNet(name: string) {
  const live = await editor();
  await live.apply(
    place("resistor", "r1", 0, "R1"),
    place("resistor", "r2", 200, "R2"),
    {
      kind: "connect",
      from: { kind: "pin", instance: "R1", pin: "2" },
      to: { kind: "pin", instance: "R2", pin: "1" },
    },
    {
      kind: "add-label",
      target: { kind: "pin", instance: "R1", pin: "2" },
      text: name,
    },
  );
  const label = () =>
    live
      .document()
      .annotations.find((annotation) => annotation.kind === "net-label")!;
  const netName = () =>
    live
      .document()
      .connectivityEvidence.find((evidence) => evidence.kind === "name-claim")
      ?.name;
  return { ...live, label, netName };
}

describe("an Agent sets how a name label looks (#1881)", () => {
  it("shows a Reference or an alias as written, its name kept across a rename", async () => {
    const { apply, document, labelOf, restyle } = await editor();
    await apply(
      place("capacitor", "cv1", 0, "CV1"),
      place("resistor", "rl", 200, "R_L"),
      place("opamp", "amp", 400),
      {
        kind: "set-display-alias",
        target: { kind: "instance", id: "amp" },
        text: "AMP1",
      },
    );
    const reference = (id: string) =>
      document().instances.find((instance) => instance.id === id)!.reference;
    // The standard looks: C over a V1 subscript, AMP over a 1 subscript.
    expect(labelOf("cv1").formatOverride?.runs).toHaveLength(2);
    expect(labelOf("amp").content?.runs).toHaveLength(2);

    await apply(
      restyle(labelOf("cv1"), asWritten("CV1")),
      // R over an L subscript, written out with its `_`.
      restyle(labelOf("rl"), asWritten("R_L")),
      restyle(labelOf("amp"), asWritten("AMP1")),
    );
    expect(labelOf("cv1").formatOverride).toEqual(asWritten("CV1"));
    expect(labelOf("rl").formatOverride).toEqual(asWritten("R_L"));
    expect(labelOf("amp").content).toEqual(asWritten("AMP1"));
    expect(labelOf("amp").binding).toBeUndefined();
    expect([reference("cv1"), reference("rl"), reference("amp")]).toEqual([
      "CV1",
      "R_L",
      "X1",
    ]);

    // A rename keeps the author's styling around the new text.
    await apply({
      kind: "set-reference",
      target: { kind: "instance", id: "cv1" },
      reference: "CV2",
    });
    expect(labelOf("cv1").formatOverride).toEqual(asWritten("CV2"));
  });

  it("gives a Cell Pin its own look and refuses one that does not spell its name, naming the rule", async () => {
    const { apply, client, document, labelOf, restyle } = await editor();
    await apply(place("port", "pin", 0, "Vin"));
    const look: RichTextDocument = {
      runs: [text("V"), script("superscript", "in")],
    };
    await apply(restyle(labelOf("pin"), look));
    expect(labelOf("pin").formatOverride).toEqual(look);
    expect(document().netlist!.terminals.map((t) => t.name)).toEqual(["Vin"]);

    const before = document().revision;
    const refused = await client.applyActions([
      restyle(labelOf("pin"), {
        runs: [text("V"), script("subscript", "out")],
      }),
    ]);
    expect(refused.ok).toBe(false);
    expect(refused.message).toContain(
      'A label\'s display must spell its name "Vin"',
    );
    expect(document().revision).toBe(before);
  });

  it("restyles a Net label, the `_` before a subscript left out, and keeps the look across a rename", async () => {
    const { apply, label, netName, restyle } = await labelledNet("V_in");
    const look: RichTextDocument = {
      runs: [text("V"), script("subscript", "in")],
    };
    await apply(restyle(label(), look));
    expect(label().formatOverride).toEqual(look);
    expect(netName()).toBe("V_in");

    await apply({
      kind: "edit-text",
      target: { kind: "annotation", id: label().id },
      text: "V_out",
    });
    expect(netName()).toBe("V_out");
    expect(label().formatOverride).toEqual({
      runs: [text("V"), script("subscript", "out")],
    });
  });

  it("raises a Net label's differential sign or shows the name as written", async () => {
    const { apply, label, netName, restyle } = await labelledNet("Vin+");
    // The standard look keeps the sign in the subscript.
    const raised: RichTextDocument = {
      runs: [text("V"), script("subscript", "in"), script("superscript", "+")],
    };
    await apply(restyle(label(), raised));
    expect(label().formatOverride).toEqual(raised);
    expect(netName()).toBe("Vin+");

    // One text run that spells the name is the label as written, not a name
    // to draw in its standard look.
    await apply(restyle(label(), asWritten("Vin+")));
    expect(label().formatOverride).toEqual(asWritten("Vin+"));
    expect(netName()).toBe("Vin+");
  });

  it("shows a drawn supply rail's label as written", async () => {
    const { apply, document, restyle } = await editor();
    await apply({
      kind: "add-power-rail",
      name: "VDD",
      start: { x: 100, y: 100 },
      end: { x: 300, y: 100 },
    });
    const label = () =>
      document().annotations.find(
        (annotation) => annotation.kind === "power-label",
      )!;
    // V over a DD subscript.
    expect(label().formatOverride?.runs).toHaveLength(2);
    await apply(restyle(label(), asWritten("VDD")));
    expect(label().formatOverride).toEqual(asWritten("VDD"));
  });
});
