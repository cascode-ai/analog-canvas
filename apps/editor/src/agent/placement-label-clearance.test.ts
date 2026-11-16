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
    [
      "the upper part first, the lower with a Pin",
      [
        [transistor("M1", 0, 0)],
        [
          {
            kind: "place-component",
            symbol: "port",
            reference: "IN",
            position: { x: -200, y: 0 },
          },
          transistor("M2", 10, 60),
        ],
      ],
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

describe("the textbook preset keeps a part's name off its own wires (#2346)", () => {
  const part = (
    symbol: string,
    reference: string | null,
    x: number,
    y: number,
    extra: Record<string, unknown> = {},
  ) => ({
    kind: "place-component",
    symbol,
    ...(reference ? { reference } : {}),
    position: { x, y },
    ...extra,
  });
  const mirrored = { mirror: "horizontal" };
  const pin = (instance: string, name: string) => ({
    kind: "pin",
    instance,
    pin: name,
  });
  const at = (x: number, y: number) => ({ kind: "wire-at", point: { x, y } });
  const tie = (gate: string, x: number) => ({
    kind: "connect",
    from: pin(gate, "G"),
    to: at(x, 100),
    via: [
      { x: x + 40, y: 60 },
      { x: x + 40, y: 100 },
    ],
  });

  it("puts a transistor's name a word's space from its drain wire, and a VDD name off the next bar", async () => {
    // Two columns of a comparator's bias, 60 apart: M20 over M21 and M11
    // over M10, each PMOS's gate tied to its drain wire, their sources on
    // VDD markers, M10's gate on to M9's. M21's name beside it fills the
    // row left of M10, and M20's VDD name beside its bar reaches M11's.
    const { client, controller } = await editor();
    for (const actions of [
      [
        part("nmos", "M21", 290, 220),
        part("pmos", "M20", 310, 60, mirrored),
        part("pmos", "M11", 370, 60, mirrored),
        part("nmos", "M10", 370, 220, mirrored),
        part("nmos", "M9", 470, 220),
        ...[300, 360].map((x) =>
          part("vdd-port", null, x, 20, { id: `vdd${x}` }),
        ),
        ...[300, 360, 480].map((x) =>
          part("ground", null, x, 250, { id: `gnd${x}` }),
        ),
      ],
      [
        { kind: "connect", from: pin("M20", "D"), to: pin("M21", "D") },
        tie("M20", 300),
        { kind: "connect", from: pin("M11", "D"), to: pin("M10", "D") },
        tie("M11", 360),
        { kind: "connect", from: pin("M10", "G"), to: pin("M9", "G") },
      ],
      [{ kind: "apply-label-preset", preset: "textbook" }],
    ]) {
      const report = await client.applyActions(actions);
      expect(report.ok, report.message).toBe(true);
    }
    expect(labelFindings(controller.document)).toEqual([]);
    // M10's name stands clear of its drain wire, x = 360, by a word's space.
    const document = controller.document;
    const m10 = document.instances.find((item) => item.reference === "M10")!;
    const name = document.annotations.find(
      (annotation) =>
        annotation.binding?.kind === "instance-reference" &&
        annotation.binding.instanceId === m10.id,
    )!;
    const ink = createLabelClearanceContext(document, resolver).measure(
      name,
    ).inkBounds;
    expect(
      Math.max(ink.x - 360, 360 - ink.x - ink.width),
    ).toBeGreaterThanOrEqual(4);
  });
});
