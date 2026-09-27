import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  roleLabelFormat,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";

import { resetLabelLookEdits } from "./reset-label-look";

const anchor = { kind: "free" as const, position: { x: 40, y: 20 } };

function drawing(annotations: Annotation[]): SchematicDocument {
  const document = createEmptyDocument("reset", "Reset");
  return {
    ...document,
    instances: [
      {
        id: "RE1",
        reference: "RE1",
        symbolId: "resistor",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      } as SchematicDocument["instances"][number],
    ],
    annotations,
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

const upserted = (edits: ReturnType<typeof resetLabelLookEdits>) =>
  edits.flatMap((edit) =>
    edit.kind === "upsert_schematic_annotation" ? [edit.annotation] : [],
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

  it("leaves labels already in their standard look, locked ones, and free text", () => {
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
      sizeScale: 2,
    };
    expect(resetLabelLookEdits(drawing([standard, marker]))).toEqual([]);
    expect(
      resetLabelLookEdits(drawing([reference({ sizeScale: 2, locked: true })])),
    ).toEqual([]);
  });
});
