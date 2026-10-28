import { describe, expect, it } from "vitest";
import {
  createLabelClearanceContext,
  diagnoseLabelClearance,
  diagnoseVisualQuality,
} from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "./live-agent-editor.test-support";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** The label findings the diagnostics report, as code and label ID. */
function labelFindings(document: SchematicDocument): string[][] {
  return [
    ...diagnoseLabelClearance(document, resolver),
    ...diagnoseVisualQuality(document, resolver).filter(
      (finding) => finding.code === "VISUAL_LABEL_OVERLAP",
    ),
  ].map((finding) => [finding.code, finding.objectIds[0]!]);
}

async function editor() {
  const live = liveAgentEditor({ project: emptyAgentProject("Labels") });
  await live.client.connect("session-1.code");
  return live;
}

/** An NMOS showing its name and W/L, at (x, y). */
const transistor = (reference: string, x: number, y: number, rotation = 0) => ({
  kind: "place-component",
  symbol: "nmos",
  reference,
  position: { x, y },
  ...(rotation ? { rotation } : {}),
  showValue: true,
});

describe("labels an Agent's placement puts clear of its neighbours (#1836)", () => {
  // In a stack drawn a grid step off true, M1's W/L, under its name beside
  // it, reaches down over M2's body; in a row of sideways switches 40
  // apart, M1's W/L ends a few units before M2's and the two read as one.
  it.each([
    ["one call", [[transistor("M1", 0, 0), transistor("M2", 10, 60)]]],
    [
      "the lower part first",
      [[transistor("M2", 10, 60)], [transistor("M1", 0, 0)]],
    ],
    [
      "the upper part first",
      [[transistor("M1", 0, 0)], [transistor("M2", 10, 60)]],
    ],
    ["a row", [[transistor("M1", 0, 0, 90), transistor("M2", 40, 0, 90)]]],
  ])("leaves no label finding, placed in %s", async (_, calls) => {
    const { client, controller } = await editor();
    for (const actions of calls) {
      const report = await client.applyActions(actions);
      expect(report.ok, report.message).toBe(true);
    }
    expect(labelFindings(controller.document)).toEqual([]);
  });

  it("keeps a neighbour's label it moves where a later arrangement still moves it", async () => {
    // M2, placed over M1's W/L, moves it to another side's rows, not off
    // them: a wire drawn later across it and the textbook preset still
    // clear it.
    const { client, controller } = await editor();
    await client.applyActions([transistor("M1", 0, 0)]);
    await client.applyActions([transistor("M2", 10, 60)]);
    const value = controller.document.annotations.find(
      (annotation) =>
        annotation.binding?.kind === "instance-value" &&
        annotation.binding.instanceId ===
          controller.document.instances.find((i) => i.reference === "M1")!.id,
    )!;
    const ink = createLabelClearanceContext(
      controller.document,
      resolver,
    ).measure(value).inkBounds;
    const y = Math.ceil(ink.y / 10) * 10;
    const across = await client.applyActions([
      {
        kind: "connect",
        from: { kind: "point", x: Math.floor(ink.x / 10) * 10 - 10, y },
        to: {
          kind: "point",
          x: Math.ceil((ink.x + ink.width) / 10) * 10 + 10,
          y,
        },
      },
    ]);
    expect(across.ok, across.message).toBe(true);
    expect(labelFindings(controller.document)).toContainEqual([
      "VISUAL_LABEL_CLEARANCE",
      value.id,
    ]);
    const preset = await client.applyActions([
      { kind: "apply-label-preset", preset: "textbook" },
    ]);
    expect(preset.ok, preset.message).toBe(true);
    expect(labelFindings(controller.document)).toEqual([]);
  });
});
