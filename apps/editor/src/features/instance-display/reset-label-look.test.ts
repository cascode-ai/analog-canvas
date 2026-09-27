import { describe, expect, it } from "vitest";
import {
  createDraftText,
  createEmptyDocument,
  roleLabelFormat,
  type Annotation,
  type DraftingObject,
  type RichTextDocument,
  type RichTextRun,
  type RichTextStyle,
  type SchematicDocument,
} from "@icm/model";

import { hasResettableLabels, resetLabelLookEdits } from "./reset-label-look";

const anchor = { kind: "free" as const, position: { x: 40, y: 20 } };

function drawing(
  annotations: Annotation[],
  objects: DraftingObject[] = [],
): SchematicDocument {
  const document = createEmptyDocument("reset", "Reset");
  return {
    ...document,
    netlist: {
      name: "reset",
      formalParameters: [],
      terminals: ["CLK", "QA", "EN", "Φ1"].map((name) => ({
        id: `T-${name}`,
        name,
        netId: `N-${name}`,
        direction: "input" as const,
        interfaceInstanceIds: [`P-${name}`],
      })),
    },
    instances: [
      {
        id: "RE1",
        reference: "RE1",
        symbolId: "resistor",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      } as SchematicDocument["instances"][number],
      {
        id: "X2",
        reference: "X2",
        symbolId: "ideal-switch",
        placement: { position: { x: 60, y: 0 }, rotation: 0, mirror: "none" },
      } as SchematicDocument["instances"][number],
    ],
    annotations,
    drafting: { objects },
  };
}

const reference = (overrides: Partial<Annotation> = {}): Annotation => ({
  id: "instance-label-RE1",
  kind: "instance-label",
  binding: { kind: "instance-reference", instanceId: "RE1" },
  anchor,
  alignment: "middle",
  rotation: 0,
  locked: false,
  ...overrides,
});

const pinLabel = (
  name: string,
  formatOverride?: RichTextDocument,
): Annotation => ({
  id: `instance-label-P-${name}`,
  kind: "instance-label",
  binding: { kind: "cell-terminal-name", terminalId: `T-${name}` },
  anchor,
  alignment: "middle",
  rotation: 0,
  locked: false,
  sizeScale: 1,
  ...(formatOverride ? { formatOverride } : {}),
});

const text = (value: string): RichTextRun => ({ kind: "text", value });
const span = (
  style: RichTextStyle,
  ...children: RichTextRun[]
): RichTextRun => ({
  kind: "span",
  style,
  children,
});

const upserted = (edits: ReturnType<typeof resetLabelLookEdits>) =>
  edits.flatMap((edit) =>
    edit.kind === "upsert_schematic_annotation" ? [edit.annotation] : [],
  );

const draftTexts = (edits: ReturnType<typeof resetLabelLookEdits>) =>
  edits.flatMap((edit) =>
    edit.kind === "upsert_drafting_object" && edit.object.kind === "text"
      ? [edit.object]
      : [],
  );

describe("resetting every label's look", () => {
  it("gives a name its default size and standard look, keeping where it sits", () => {
    const [label] = upserted(
      resetLabelLookEdits(
        drawing([
          reference({
            sizeScale: 1.8,
            textColor: "#aa0000",
            formatOverride: {
              runs: [
                {
                  kind: "span",
                  style: "bold",
                  children: [{ kind: "text", value: "RE1" }],
                },
              ],
            },
          }),
        ]),
      ),
    );
    // R in italic over an upright E1, as a Resistor's Reference is placed.
    expect(label).toEqual({
      ...reference({ textColor: "#aa0000" }),
      formatOverride: roleLabelFormat("device-reference", "RE1", {
        deviceLetter: "R",
      }),
    });
    expect(label).not.toHaveProperty("sizeScale");
  });

  it("leaves labels already in their standard look and locked ones", () => {
    const standard = reference({
      formatOverride: roleLabelFormat("device-reference", "RE1", {
        deviceLetter: "R",
      })!,
    });
    const marker: Annotation = {
      id: "marker",
      kind: "route-marker",
      markerKind: "current",
      content: { runs: [{ kind: "text", value: "I1" }] },
      anchor,
      alignment: "middle",
      rotation: 0,
      locked: false,
    };
    expect(resetLabelLookEdits(drawing([standard, marker]))).toEqual([]);
    const locked = drawing(
      [reference({ sizeScale: 2, locked: true })],
      [
        {
          ...createDraftText({
            id: "phase",
            position: { x: 0, y: 0 },
            content: { runs: [text("Φ"), span("subscript", text("1"))] },
          }),
          locked: true,
        },
      ],
    );
    expect(resetLabelLookEdits(locked)).toEqual([]);
    expect(hasResettableLabels(locked)).toBe(false);
  });

  // A Pin named Φ1 set as Φ₁ once lost its subscript: the rules gave the
  // name no form, so Reset dropped the format and the 1 came back upright.
  it("keeps a Pin's Φ₁ over its subscript", () => {
    const format = roleLabelFormat("voltage-node", "Φ1")!;
    expect(
      resetLabelLookEdits(
        drawing([{ ...pinLabel("Φ1", format), sizeScale: undefined }]),
      ),
    ).toEqual([]);
    const [label] = upserted(resetLabelLookEdits(drawing([pinLabel("Φ1")])));
    expect(label!.formatOverride).toEqual(format);
    expect(label).not.toHaveProperty("sizeScale");
  });

  it("keeps what a format writes beyond italic and bold on a name with no standard form", () => {
    const inverted: RichTextDocument = {
      runs: [span("bold", span("italic", span("overbar", text("CLK"))))],
    };
    const labels = upserted(
      resetLabelLookEdits(
        drawing([
          pinLabel("CLK", inverted),
          pinLabel("QA", { runs: [text("Q"), span("subscript", text("A"))] }),
          pinLabel("EN", { runs: [span("bold", span("italic", text("EN")))] }),
        ]),
      ),
    );
    // The bar stays, a subscript takes the standard look where it was
    // written, and bold italic alone is only a look.
    expect(labels.map((label) => label.formatOverride)).toEqual([
      inverted,
      {
        runs: [
          span("italic", span("bold", text("Q"))),
          span("subscript", span("bold", text("A"))),
        ],
      },
      undefined,
    ]);
  });

  it("gives a part's own words the standard look, keeping which of them are subscripts", () => {
    const alias = (
      id: string,
      runs: RichTextRun[],
      sizeScale?: number,
    ): Annotation => ({
      id,
      kind: "instance-label",
      content: { runs },
      anchor: {
        kind: "object",
        objectId: "X2",
        localOffset: { x: 0, y: -10 },
        fallbackPosition: { x: 60, y: -10 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
      ...(sizeScale === undefined ? {} : { sizeScale }),
    });
    const labels = upserted(
      resetLabelLookEdits(
        drawing([
          alias("phase", [text("Φ"), span("subscript", text("2"))], 1.4),
          alias(
            "gain",
            [
              text("g"),
              span("subscript", text("m")),
              text("v"),
              span("subscript", text("gs")),
            ],
            1.4,
          ),
          alias("plain", [text("OTA")]),
        ]),
      ),
    );
    expect(labels.map((label) => [label.id, label.content])).toEqual([
      ["phase", roleLabelFormat("voltage-node", "Φ2")],
      [
        "gain",
        {
          runs: [
            text("g"),
            span("subscript", text("m")),
            text("v"),
            span("subscript", text("gs")),
          ],
        },
      ],
    ]);
    expect(labels.every((label) => label.sizeScale === undefined)).toBe(true);
  });

  it("sets a route marker's words at the default size", () => {
    const marker: Annotation = {
      id: "marker",
      kind: "route-marker",
      markerKind: "current",
      content: {
        runs: [text("I"), span("subscript", span("italic", text("D")))],
      },
      anchor,
      alignment: "middle",
      rotation: 0,
      locked: false,
      sizeScale: 2,
    };
    const [label] = upserted(resetLabelLookEdits(drawing([marker])));
    expect(label).not.toHaveProperty("sizeScale");
    expect(label!.content).toEqual(roleLabelFormat("voltage-node", "ID"));
  });

  it("restyles a free text that names something as a label does, and leaves other text", () => {
    const free = (
      id: string,
      runs: RichTextRun[],
      extra: Partial<Extract<DraftingObject, { kind: "text" }>> = {},
    ) => ({
      ...createDraftText({ id, position: { x: 0, y: 0 }, content: { runs } }),
      ...extra,
    });
    const document = drawing(
      [],
      [
        free("phase", [text("Φ"), span("subscript", text("1p"))], {
          styleOverride: { sizeScale: 1.2, weight: "normal", color: "#123456" },
        }),
        free("block", [text("OTA")], { styleOverride: { sizeScale: 1.5 } }),
        free("caption", [text("V"), span("subscript", text("out"))], {
          typographyToken: "caption",
        }),
      ],
    );
    expect(hasResettableLabels(document)).toBe(true);
    const [phase, ...rest] = draftTexts(resetLabelLookEdits(document));
    expect(rest).toEqual([]);
    expect(phase).toEqual({
      ...free("phase", []),
      content: roleLabelFormat("voltage-node", "Φ1p"),
      styleOverride: { color: "#123456" },
    });
  });
});
