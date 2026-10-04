import { describe, expect, it } from "vitest";
import {
  createDraftText,
  createEmptyDocument,
  defaultDraftTextDocument,
  flattenRichText,
  type Annotation,
  type RichTextDocument,
  type SchematicDocument,
} from "@icm/model";

import type { AgentCommandPlan } from "@icm/agent-adapter";
import { planAddText, planSetText } from "./text-command";

/** A text plan is always Document edits. */
function edits(plan: AgentCommandPlan): unknown[] {
  if (!("edits" in plan)) throw new Error("expected Document edits");
  return [...plan.edits];
}

function noteDocument(
  content: RichTextDocument,
  styleOverride?: { weight?: "normal"; sizeScale?: number },
): SchematicDocument {
  const document = createEmptyDocument("main", "Main");
  document.drafting = {
    objects: [
      {
        ...createDraftText({ id: "note", position: { x: 20, y: 20 }, content }),
        ...(styleOverride ? { styleOverride } : {}),
      },
    ],
  };
  return document;
}

const note = { kind: "drafting" as const, id: "note" };

describe("set-text edits text as the canvas editor does", () => {
  it("keeps GUI-authored bold spans and an explicit unbold when replacing text", () => {
    const document = noteDocument(defaultDraftTextDocument("Bias branch"), {
      weight: "normal",
      sizeScale: 1.5,
    });
    const [edit] = edits(
      planSetText(document, {
        kind: "set-text",
        target: note,
        text: "Input branch",
      }),
    ) as [Record<string, unknown>];
    expect(edit).toMatchObject({
      kind: "upsert_drafting_object",
      object: {
        content: defaultDraftTextDocument("Input branch"),
        styleOverride: { weight: "normal", sizeScale: 1.5 },
      },
    });
    expect(
      planSetText(document, {
        kind: "set-text",
        target: note,
        text: "Bias branch",
      }),
    ).toEqual({ edits: [] });
    const explicit = { runs: [{ kind: "text" as const, value: "Plain" }] };
    expect(
      edits(
        planSetText(document, {
          kind: "set-text",
          target: note,
          text: explicit,
        }),
      ),
    ).toMatchObject([
      {
        object: {
          content: explicit,
          styleOverride: { weight: "normal", sizeScale: 1.5 },
        },
      },
    ]);
  });

  it("asks for RichText to replace a formula without losing its structure", () => {
    const fraction = {
      runs: [
        {
          kind: "fraction" as const,
          numerator: { runs: [{ kind: "text" as const, value: "a" }] },
          denominator: { runs: [{ kind: "text" as const, value: "b" }] },
        },
      ],
    };
    const document = noteDocument(fraction);
    expect(() =>
      planSetText(document, { kind: "set-text", target: note, text: "c/d" }),
    ).toThrow("explicit RichText");
    expect(
      planSetText(document, {
        kind: "set-text",
        target: note,
        text: flattenRichText(fraction),
      }),
    ).toEqual({ edits: [] });
    expect(
      edits(
        planSetText(document, {
          kind: "set-text",
          target: note,
          text: { runs: [{ kind: "text", value: "c/d" }] },
        }),
      ),
    ).toHaveLength(1);
  });

  it("restyles a bound Cell Pin or Value label and changes neither its name nor its value", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "P1",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      {
        id: "R1",
        symbolId: "resistor",
        reference: "R1",
        placement: { position: { x: 100, y: 0 }, rotation: 0, mirror: "none" },
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "RL" },
        },
      },
    );
    document.nets.push({
      id: "net-vbp",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "pin-1",
      name: "VBP",
      netId: "net-vbp",
      direction: "passive",
      interfaceInstanceIds: ["P1"],
    });
    const label = (id: string, binding: Annotation["binding"]): Annotation =>
      ({
        id,
        kind: id === "value-name" ? "instance-value" : "instance-label",
        binding,
        anchor: { kind: "free", position: { x: 0, y: 0 } },
        alignment: "start",
        rotation: 0,
        locked: false,
      }) as Annotation;
    document.annotations.push(
      label("pin-name", { kind: "cell-terminal-name", terminalId: "pin-1" }),
      label("value-name", { kind: "instance-value", instanceId: "R1" }),
    );
    const styled = (head: string, tail: string) => ({
      runs: [
        { kind: "text" as const, value: head },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: tail }],
        },
      ],
    });
    for (const [id, text] of [
      ["pin-name", styled("V", "BP")],
      ["value-name", styled("R", "L")],
    ] as const) {
      const target = { kind: "annotation" as const, id };
      const [edit] = edits(
        planSetText(document, { kind: "set-text", target, text }),
      ) as [Record<string, { content?: unknown }>];
      expect(edit).toMatchObject({
        kind: "upsert_schematic_annotation",
        annotation: { id, formatOverride: text },
      });
      expect(edit.annotation!.content).toBeUndefined();
      // The same characters as a plain string leave the standard look.
      expect(
        planSetText(document, {
          kind: "set-text",
          target,
          text: flattenRichText(text),
        }),
      ).toEqual({ edits: [] });
    }
    expect(() =>
      planSetText(document, {
        kind: "set-text",
        target: { kind: "annotation", id: "pin-name" },
        text: "CHANGED",
      }),
    ).toThrow("rename the Pin with set-properties reference");
  });
});

describe("add-text places a note as the Text tool does", () => {
  it("keeps the text as written, plain or structured", () => {
    const structured = {
      runs: [
        { kind: "text" as const, value: "V" },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "out" }],
        },
      ],
    };
    for (const content of [
      "Design note",
      defaultDraftTextDocument("Vx"),
      structured,
    ]) {
      expect(
        planAddText({
          kind: "add-text",
          id: "note-1",
          position: { x: 10, y: 20 },
          text: content,
        }),
      ).toEqual({
        edits: [
          {
            kind: "upsert_drafting_object",
            object: createDraftText({
              id: "note-1",
              position: { x: 10, y: 20 },
              content,
            }),
          },
        ],
      });
    }
  });
});
