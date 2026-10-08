import { describe, expect, it } from "vitest";
import {
  canonicalPortTextDocument,
  createRoutePath,
  roleLabelFormat,
  type Annotation,
  type CircuitProject,
} from "@icm/model";
import {
  createLabelClearanceContext,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import { AgentCommandPlanningError } from "@icm/agent-adapter";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { callTool } from "../../../mcp-server/src/tools";
import { arrangeInstanceLabels } from "../features/instance-display/arrange-instance-labels";
import { defaultInstanceDisplayAnnotations } from "../features/instance-display/default-instance-display";
import { planBrowserAgentCommand } from "./browser-agent-command";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "./live-agent-editor.test-support";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * A figure drawn with default labels: NMOS M1 with its W/L crossed by a
 * wire, a resistor RL whose value a wire crosses and whose name has no look
 * of its own yet (a drawing older than the role looks), a current source
 * ISS, a three-terminal NMOS and a DMOS, and a PMOS M2 and resistor RB
 * whose values a person hid.
 */
function figure(): CircuitProject {
  const project = emptyAgentProject("Textbook");
  const document = project.documents[0]!;
  const profile = resolveDocumentStyleProfile(document.presentation);
  const part = (
    reference: string,
    symbolId: string,
    x: number,
    parameters: Record<string, string>,
    symbolVariantId?: string,
  ) => {
    const instance = {
      id: reference.toLowerCase(),
      reference,
      symbolId,
      ...(symbolVariantId ? { symbolVariantId } : {}),
      placement: {
        position: { x, y: symbolId === "resistor" ? 0 : -40 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: { parameters },
    };
    document.instances.push(instance);
    document.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        document,
        instance,
        resolver,
        profile,
        { showValue: true },
      ),
    );
  };
  const wire = (id: string, y: number, from: number, to: number) => {
    document.nets.push({ id: `${id}-net`, terminals: [] });
    document.junctions.push(
      { id: `${id}-a`, netId: `${id}-net`, position: { x: from, y } },
      { id: `${id}-b`, netId: `${id}-net`, position: { x: to, y } },
    );
    document.routes.push(
      createRoutePath({
        id,
        netId: `${id}-net`,
        start: { kind: "junction", junctionId: `${id}-a` },
        end: { kind: "junction", junctionId: `${id}-b` },
        bends: [],
        modes: ["manual"],
      }),
    );
  };
  part("M1", "nmos", 90, { w: "10u", l: "0.5u" });
  part("RL", "resistor", -260, { value: "10k" });
  part("ISS", "current-source", 400, { dc: "1m" });
  part("M2", "pmos", 600, { w: "20u", l: "0.5u" });
  part("RB", "resistor", 800, { value: "5k" });
  part("M3", "nmos", 1000, { w: "4u", l: "1u" }, "textbook-3terminal");
  part("M4", "ndmos", 1200, { w: "40u", l: "2u" });
  wire("tail", -20, 60, 200);
  wire("cross", 24, -260, -140);
  for (const annotation of document.annotations) {
    if (annotation.binding?.kind === "instance-reference")
      if (annotation.binding.instanceId === "rl")
        delete annotation.formatOverride;
    if (
      annotation.binding?.kind === "instance-value" &&
      ["m2", "rb"].includes(annotation.binding.instanceId)
    )
      annotation.visible = false;
  }
  return project;
}

function label(
  annotations: readonly Annotation[],
  kind: "instance-reference" | "instance-value",
  instanceId: string,
) {
  return annotations.find(
    (annotation) =>
      annotation.binding?.kind === kind &&
      annotation.binding.instanceId === instanceId,
  );
}

const shown = (annotations: readonly Annotation[]) =>
  annotations
    .filter((annotation) => annotation.visible !== false)
    .map((annotation) => annotation.id)
    .sort();

async function editor(project = figure()) {
  const live = liveAgentEditor({ project });
  await live.client.connect("session-1.code");
  return live;
}

describe("apply-label-preset textbook (#1350)", () => {
  it("gives a whole Cell a textbook figure's labels in one undo", async () => {
    const { client, controller } = await editor();
    const before = structuredClone(controller.document);
    const ids = before.instances.map((instance) => instance.id);
    // M1's W/L lies on the tail wire, RL's value on the other one. Arranged
    // as they are, M1's name would move with its W/L to clear it.
    const crossed = createLabelClearanceContext(before, resolver);
    expect(
      crossed.conflicts(label(before.annotations, "instance-value", "m1")!),
    ).toEqual(["tail"]);
    expect(
      crossed.conflicts(label(before.annotations, "instance-value", "rl")!),
    ).toEqual(["cross"]);
    expect(
      arrangeInstanceLabels(before, resolver, ["m1"], {}).map((edit) =>
        edit.kind === "upsert_schematic_annotation" ? edit.annotation.id : "",
      ),
    ).toContain(label(before.annotations, "instance-reference", "m1")!.id);

    const report = await client.applyActions([
      { kind: "apply-label-preset", preset: "textbook" },
    ]);
    expect(report.ok, report.message).toBe(true);
    const after = controller.document;
    // One transaction.
    expect(after.revision).toBe(before.revision + 1);
    expect(after.instances).toEqual(before.instances);
    expect(after.nets).toEqual(before.nets);
    expect(after.routes).toEqual(before.routes);

    // Every MOS hides its W/L, three-terminal and DMOS too; the other values
    // stay as they were, and nothing hidden is shown.
    for (const id of ["m1", "m2", "m3", "m4"])
      expect(label(after.annotations, "instance-value", id)?.visible, id).toBe(
        false,
      );
    expect(label(after.annotations, "instance-value", "rl")?.visible).not.toBe(
      false,
    );
    expect(label(after.annotations, "instance-value", "iss")?.visible).not.toBe(
      false,
    );
    expect(label(after.annotations, "instance-value", "rb")?.visible).toBe(
      false,
    );
    const hidden = ["m1", "m3", "m4"].map(
      (id) => label(before.annotations, "instance-value", id)!.id,
    );
    expect(shown(after.annotations)).toEqual(
      shown(before.annotations).filter((id) => !hidden.includes(id)),
    );

    // Names in their role look: RL, plain before, is R_L now.
    for (const [id, reference] of [
      ["m1", "M1"],
      ["rl", "RL"],
      ["iss", "ISS"],
    ] as const)
      expect(
        label(after.annotations, "instance-reference", id)?.formatOverride,
        reference,
      ).toEqual(canonicalPortTextDocument(reference));

    // Arranged with the W/L already hidden: M1's name stays where it stood,
    // RL's labels leave the wire, and no label is left that arrange-labels
    // would still move.
    expect(
      label(after.annotations, "instance-reference", "m1")?.anchor,
    ).toEqual(label(before.annotations, "instance-reference", "m1")?.anchor);
    const context = createLabelClearanceContext(after, resolver);
    for (const annotation of after.annotations)
      if (
        annotation.visible !== false &&
        (annotation.binding?.kind === "instance-reference" ||
          annotation.binding?.kind === "instance-value")
      )
        expect(context.conflicts(annotation), annotation.id).toEqual([]);
    expect(
      arrangeInstanceLabels(after, resolver, ids, {
        referenceStyle: "first-letter-subscript",
      }),
    ).toEqual([]);

    // Applied again, it finds nothing to change.
    const again = await client.applyActions([
      { kind: "apply-label-preset", preset: "textbook" },
    ]);
    expect(again).toMatchObject({ ok: true, applied: false });
    // It says so, never a bare ok (#1525).
    expect(JSON.stringify(again)).toContain("NOTHING_CHANGED");
    expect(controller.document.revision).toBe(before.revision + 1);

    // One undo takes it all back.
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.annotations).toEqual(before.annotations);
  });

  it("keeps a multiplier other than 1 on show as ×m once its W/L is hidden (#1423)", async () => {
    const project = figure();
    const document = project.documents[0]!;
    document.instances.find((item) => item.id === "m1")!.netlist!.parameters.m =
      "4";
    for (const [reference, m, x] of [
      ["Q1", "1", 1400],
      ["Q2", "8", 1600],
    ] as const) {
      const instance = {
        id: reference.toLowerCase(),
        reference,
        symbolId: "npn",
        placement: {
          position: { x, y: -40 },
          rotation: 0 as const,
          mirror: "none" as const,
        },
        netlist: { parameters: { m } },
      };
      document.instances.push(instance);
      document.annotations.push(
        ...defaultInstanceDisplayAnnotations(
          document,
          instance,
          resolver,
          resolveDocumentStyleProfile(document.presentation),
          { showValue: true },
        ),
      );
    }
    const { client, controller } = await editor(project);

    const result = await client.applyActions([
      { kind: "apply-label-preset", preset: "textbook" },
    ]);

    expect(result.ok, result.message).toBe(true);
    expect(
      controller.document.annotations
        .flatMap((annotation) =>
          annotation.binding?.kind === "instance-value" &&
          annotation.binding.parameter === "m" &&
          annotation.visible !== false
            ? [annotation.binding.instanceId]
            : [],
        )
        .sort(),
    ).toEqual(["m1", "q2"]);
    expect(
      label(controller.document.annotations, "instance-value", "m1"),
    ).toMatchObject({ visible: false });
  });

  it("applies it to the parts named, through circuit_text", async () => {
    const { client, controller } = await editor();
    const before = structuredClone(controller.document);
    const answer = await callTool(
      "circuit_text",
      {
        actions: [
          {
            kind: "apply-label-preset",
            preset: "textbook",
            targets: [
              { kind: "instance", reference: "M1" },
              { kind: "instance", reference: "M3" },
            ],
          },
        ],
      },
      { client },
    );
    const content = answer.content[0];
    if (content?.type !== "text") throw new Error("Expected a text receipt");
    const result = JSON.parse(content.text!);
    expect(result.ok, content.text).toBe(true);
    expect(controller.document.revision).toBe(before.revision + 1);
    const after = controller.document.annotations;
    expect(label(after, "instance-value", "m1")?.visible).toBe(false);
    expect(label(after, "instance-value", "m3")?.visible).toBe(false);
    // The parts not named keep every label as it was: M4 its W/L, RL its
    // plain name and its value on the wire.
    for (const id of ["m4", "rl", "iss"])
      for (const kind of ["instance-reference", "instance-value"] as const)
        expect(label(after, kind, id), `${id} ${kind}`).toEqual(
          label(before.annotations, kind, id),
        );
  });

  it("refuses an unknown part and changes nothing", async () => {
    const { client, controller } = await editor();
    const before = structuredClone(controller.document);
    const unknownId = await client.applyActions([
      {
        kind: "apply-label-preset",
        preset: "textbook",
        instanceIds: ["m1", "missing"],
      },
    ]);
    expect(unknownId).toMatchObject({ ok: false });
    expect(unknownId.message).toContain("Instance not found: missing");
    const unknownReference = await client.applyActions([
      {
        kind: "apply-label-preset",
        preset: "textbook",
        targets: [{ kind: "instance", reference: "M9" }],
      },
    ]);
    expect(unknownReference).toMatchObject({ ok: false });
    expect(unknownReference.message).toContain('Reference "M9"');
    expect(controller.document).toEqual(before);
  });

  it("names the leading parts that fit when it exceeds the edit limit", () => {
    const project = figure();
    const command = {
      kind: "apply-label-preset" as const,
      preset: "textbook" as const,
    };
    // Hiding the W/L of M1, M3 and M4 and moving RL's two labels: five
    // edits, two more than a limit of three.
    const plan = (limit: number, instanceIds?: string[]) =>
      planBrowserAgentCommand(
        project,
        "main",
        resolver,
        instanceIds ? { ...command, instanceIds } : command,
        limit,
      );
    expect((plan(5) as { edits: unknown[] }).edits).toHaveLength(5);
    let refusal: unknown;
    try {
      plan(3);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(AgentCommandPlanningError);
    const { message, detail } = refusal as AgentCommandPlanningError;
    expect(detail).toEqual({
      code: "LIMIT_EXCEEDED",
      parameters: {
        expandedEdits: 5,
        maxTransactionEdits: 3,
        selectedParts: 7,
        fittingParts: 5,
      },
    });
    expect(message).toBe(
      "actions[0]: apply-label-preset expands to 5 edits, and one transaction takes at most 3. The first 5 of its 7 parts fit (M1, RL, ISS, M2, RB): apply it to them in one call and to the rest in another. Nothing was changed.",
    );
    // The count is exact: the parts named fit, one more does not.
    const ids = project.documents[0]!.instances.map((item) => item.id);
    expect(() => plan(3, ids.slice(0, 5))).not.toThrow();
    expect(() => plan(3, ids.slice(0, 6))).toThrow(AgentCommandPlanningError);
  });
});

describe("a placed part's labels (#1435)", () => {
  const placeAt = (
    symbol: string,
    reference: string,
    x: number,
    more: Record<string, unknown> = {},
  ) => ({
    kind: "place-component",
    symbol,
    reference,
    position: { x, y: 0 },
    ...more,
  });

  it("shows a part's name alone unless its placement asks for its value", async () => {
    const { client, controller } = await editor(emptyAgentProject("Placement"));
    const answer = await callTool(
      "circuit_place",
      {
        actions: [
          placeAt("nmos", "M1", 0, { parameters: { w: "10u", l: "1u" } }),
          placeAt("resistor", "R1", 200, { parameters: { value: "10k" } }),
          placeAt("nmos", "M2", 400, {
            parameters: { w: "20u", l: "2u" },
            showValue: true,
          }),
          // Asked for without a size: the catalog default shows.
          placeAt("pmos", "M3", 600, { showValue: true }),
          placeAt("resistor", "R2", 800, {
            parameters: { value: "5k" },
            showReference: false,
            showValue: true,
          }),
        ],
      },
      { client },
    );
    const content = answer.content[0];
    if (content?.type !== "text") throw new Error("Expected a text receipt");
    expect(JSON.parse(content.text!).ok, content.text).toBe(true);
    const visible = (
      kind: "instance-reference" | "instance-value",
      reference: string,
    ) => {
      const id = controller.document.instances.find(
        (item) => item.reference === reference,
      )!.id;
      const annotation = label(controller.document.annotations, kind, id);
      return annotation !== undefined && annotation.visible !== false;
    };
    for (const [reference, name, value] of [
      ["M1", true, false],
      ["R1", true, false],
      ["M2", true, true],
      ["M3", true, true],
      ["R2", false, true],
    ] as const) {
      expect(visible("instance-reference", reference), reference).toBe(name);
      expect(visible("instance-value", reference), reference).toBe(value);
    }
    // Hidden or not, the values given are the part's.
    const m1 = controller.document.instances.find(
      (item) => item.reference === "M1",
    );
    expect(m1?.netlist?.parameters).toMatchObject({ w: "10u", l: "1u" });
  });

  it("refuses the switches on a Cell Pin or ground marker and places nothing", async () => {
    const { client, controller } = await editor(emptyAgentProject("Placement"));
    const before = structuredClone(controller.document);
    const refused = await client.applyActions([
      placeAt("port", "vin", 0, { showValue: true }),
    ]);
    expect(refused).toMatchObject({ ok: false });
    expect(refused.message).toContain(
      "showReference and showValue are for devices",
    );
    expect(controller.document).toEqual(before);
    // The native command says the same for a marker it is given.
    const at = {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    };
    const native = (displays: Record<string, { showValue?: boolean }>) => () =>
      planBrowserAgentCommand(
        controller.project,
        controller.document.id,
        resolver,
        {
          kind: "place-components",
          instances: [{ id: "gnd", symbolId: "ground", placement: at }],
          displays,
        },
      );
    expect(native({ gnd: { showValue: false } })).toThrow(
      "showReference and showValue are for devices",
    );
    // A key that names no part in the call is refused, not ignored.
    expect(native({ r9: { showValue: true } })).toThrow(
      "Display targets an unknown new Instance: r9",
    );
  });
});

describe("a renamed Cell Pin's look (#1419)", () => {
  /**
   * An LNA's RF input Pins, placed as rfp and rfn, whose names have no
   * standard look, so their labels have none; rfn was renamed vrfn before
   * a rename gave a label its new name's look.
   */
  function inputs(): CircuitProject {
    const project = emptyAgentProject("LNA");
    const document = project.documents[0]!;
    const profile = resolveDocumentStyleProfile(document.presentation);
    for (const [index, name] of ["rfp", "rfn"].entries()) {
      const port = {
        id: name,
        symbolId: "port",
        placement: {
          position: { x: 0, y: 80 * index },
          rotation: 0 as const,
          mirror: "none" as const,
        },
      };
      document.instances.push(port);
      document.nets.push({
        id: `net-${name}`,
        terminals: [{ instanceId: name, pinName: "P" }],
      });
      document.netlist!.terminals.push({
        id: `terminal-${name}`,
        name,
        netId: `net-${name}`,
        direction: "input",
        interfaceInstanceIds: [name],
      });
      document.annotations.push(
        ...defaultInstanceDisplayAnnotations(
          document,
          port,
          resolver,
          profile,
          { formalTerminalId: `terminal-${name}`, formalName: name },
        ),
      );
    }
    document.netlist!.terminals[1]!.name = "vrfn";
    return project;
  }

  it("draws a Pin an Agent renames, and one renamed before, in the new name's look", async () => {
    const { client, controller } = await editor(inputs());
    const look = (id: string) =>
      controller.document.annotations.find(
        (annotation) =>
          annotation.binding?.kind === "cell-terminal-name" &&
          annotation.binding.terminalId === `terminal-${id}`,
      )?.formatOverride;
    expect(look("rfp")).toBeUndefined();

    const renamed = await client.advancedTransact({
      command: {
        kind: "rename-cell-terminal",
        terminalId: "terminal-rfp",
        name: "vrfp",
      },
    });
    expect(renamed.ok, renamed.message).toBe(true);
    // Drawn V_rfp, as a Pin placed as vrfp is.
    expect(look("rfp")).toEqual(roleLabelFormat("voltage-node", "vrfp"));

    // vrfn, renamed before, is still plain until the preset restyles it.
    expect(look("rfn")).toBeUndefined();
    const preset = await client.applyActions([
      { kind: "apply-label-preset", preset: "textbook" },
    ]);
    expect(preset.ok, preset.message).toBe(true);
    expect(look("rfn")).toEqual(roleLabelFormat("voltage-node", "vrfn"));
    expect(look("rfp")).toEqual(roleLabelFormat("voltage-node", "vrfp"));
  });
});

describe("labels in a row with their neighbours' (#1412)", () => {
  /**
   * A Chebyshev low-pass ladder: shunt capacitors hanging from a horizontal
   * line to ground, series inductors on the line between them, each label
   * where placement put it. The inductors' names and values stand under the
   * line, on the rows of the capacitors' beside them.
   */
  function ladder(): CircuitProject {
    const project = emptyAgentProject("Ladder");
    const document = project.documents[0]!;
    const profile = resolveDocumentStyleProfile(document.presentation);
    const part = (
      reference: string,
      symbolId: string,
      x: number,
      y: number,
      rotation: 0 | 90,
      value: string,
    ) => {
      const instance = {
        id: reference.toLowerCase(),
        reference,
        symbolId,
        placement: { position: { x, y }, rotation, mirror: "none" as const },
        netlist: { parameters: { value } },
      };
      document.instances.push(instance);
      document.annotations.push(
        ...defaultInstanceDisplayAnnotations(
          document,
          instance,
          resolver,
          profile,
          { showValue: true },
        ),
      );
    };
    // One Net per node, its wires drawn from pin to pin.
    const node = (id: string, ...ends: [string, string][]) => {
      document.nets.push({
        id,
        terminals: ends.map(([instanceId, pinName]) => ({
          instanceId,
          pinName,
        })),
      });
      for (const [index, [instanceId, pinName]] of ends.slice(1).entries())
        document.routes.push(
          createRoutePath({
            id: `${id}-${index}`,
            netId: id,
            start: {
              kind: "terminal",
              instanceId: ends[index]![0],
              pinName: ends[index]![1],
            },
            end: { kind: "terminal", instanceId, pinName },
            bends: [],
            modes: ["manual"],
          }),
        );
    };
    for (const [index, value] of [
      "38.1pF",
      "115nH",
      "68pF",
      "129nH",
      "38.1pF",
    ].entries()) {
      const x = 80 * index;
      if (index % 2) part(`L${index + 1}`, "inductor", x, 0, 90, value);
      else {
        part(`C${index + 1}`, "capacitor", x, 20, 0, value);
        document.instances.push({
          id: `g${index + 1}`,
          symbolId: "ground",
          placement: {
            position: { x, y: 60 },
            rotation: 0,
            mirror: "none",
          },
        });
        node(
          `gnd-${index + 1}`,
          [`c${index + 1}`, "2"],
          [`g${index + 1}`, "0"],
        );
      }
    }
    node("n1", ["c1", "1"], ["l2", "2"]);
    node("n2", ["l2", "1"], ["c3", "1"], ["l4", "2"]);
    node("n3", ["l4", "1"], ["c5", "1"]);
    return project;
  }

  it("puts a ladder's series inductors' labels above the line, clear of its capacitors'", async () => {
    const { client, controller } = await editor(ladder());
    const before = structuredClone(controller.document);
    const context = () =>
      createLabelClearanceContext(controller.document, resolver);
    const owner = (annotation: Annotation) =>
      annotation.anchor.kind === "object" ? annotation.anchor.objectId : "";
    const bounds = (id: string) =>
      context().symbols.find((symbol) => symbol.id === id)!.bounds;
    const labelsOf = (document: typeof before, id: string) =>
      document.annotations.filter(
        (annotation) =>
          annotation.visible !== false && owner(annotation) === id,
      );
    // The inductors' labels stand under the line, beside the capacitors'.
    for (const id of ["l2", "l4"])
      for (const annotation of labelsOf(before, id))
        expect(context().measure(annotation).inkBounds.y).toBeGreaterThan(
          bounds(id).y + bounds(id).height,
        );

    const report = await client.applyActions([
      { kind: "apply-label-preset", preset: "textbook" },
    ]);
    expect(report.ok, report.message).toBe(true);
    const after = controller.document;
    expect(after.revision).toBe(before.revision + 1);

    // Each inductor's name and value went above it, as a textbook draws
    // a series part, and the capacitors' labels kept their place.
    const measured = context();
    for (const id of ["l2", "l4"]) {
      const labels = labelsOf(after, id);
      expect(labels).toHaveLength(2);
      for (const annotation of labels) {
        const ink = measured.measure(annotation).inkBounds;
        expect(ink.y + ink.height, annotation.id).toBeLessThanOrEqual(
          bounds(id).y,
        );
        expect(measured.conflicts(annotation), annotation.id).toEqual([]);
      }
    }
    for (const id of ["c1", "c3", "c5"])
      expect(labelsOf(after, id), id).toEqual(labelsOf(before, id));

    // No two parts' labels run together on one row: on a shared row they
    // stand more than a character, 10 units, apart.
    const shownLabels = measured.visible.map((annotation) => ({
      owner: owner(annotation),
      ink: measured.measure(annotation).inkBounds,
      id: annotation.id,
    }));
    for (const a of shownLabels)
      for (const b of shownLabels) {
        if (a.owner === b.owner) continue;
        const shared =
          Math.min(a.ink.y + a.ink.height, b.ink.y + b.ink.height) -
          Math.max(a.ink.y, b.ink.y);
        if (shared < Math.min(a.ink.height, b.ink.height) / 2) continue;
        const gap = Math.max(
          b.ink.x - a.ink.x - a.ink.width,
          a.ink.x - b.ink.x - b.ink.width,
        );
        expect(gap, `${a.id} and ${b.id}`).toBeGreaterThanOrEqual(10);
      }

    // Applied again, it finds nothing to change.
    const again = await client.applyActions([
      { kind: "apply-label-preset", preset: "textbook" },
    ]);
    expect(again).toMatchObject({ ok: true, applied: false });
  });
});
