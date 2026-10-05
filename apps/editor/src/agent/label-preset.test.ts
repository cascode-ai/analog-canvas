import { describe, expect, it } from "vitest";
import {
  canonicalPortTextDocument,
  createRoutePath,
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
    expect(controller.document.revision).toBe(before.revision + 1);

    // One undo takes it all back.
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.annotations).toEqual(before.annotations);
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
