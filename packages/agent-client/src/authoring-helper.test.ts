import { describe, expect, it } from "vitest";
import {
  ActionCompileError,
  compileActions,
  type CompiledTransaction,
} from "./authoring-helper.js";
import { testSnapshot } from "./test-support/snapshot-fixture.js";
import type { AgentSessionSnapshot } from "@icm/agent-adapter";

let idCounter = 0;
const allocateId = (prefix: string) => `${prefix}-alloc-${(idCounter += 1)}`;

function compile(
  actions: unknown[],
  snapshot: AgentSessionSnapshot = testSnapshot(),
): CompiledTransaction[] {
  return compileActions(actions, {
    snapshot,
    allocateId,
  });
}

function expectCompileError(actions: unknown[], fragment: string): void {
  try {
    compile(actions);
    expect.unreachable("expected ActionCompileError");
  } catch (error) {
    expect(error).toBeInstanceOf(ActionCompileError);
    expect((error as Error).message).toContain(fragment);
  }
}

describe("authoring helper compilation", () => {
  it("compiles place-component into a catalog-validated add_instance edit", () => {
    const [transaction] = compile([
      {
        kind: "place-component",
        symbol: "capacitor",
        reference: "C1",
        position: { x: 600, y: 300 },
        parameters: { c: "1p" },
      },
    ]);
    expect(transaction?.form).toBe("edits");
    const edit = transaction?.edits?.[0];
    expect(edit?.kind).toBe("add_instance");
    if (edit?.kind === "add_instance") {
      expect(edit.instance.symbolId).toBe("capacitor");
      expect(edit.instance.reference).toBe("C1");
      expect(edit.instance.netlist?.parameters).toEqual({ c: "1p" });
      expect(edit.instance.placement).toEqual({
        position: { x: 600, y: 300 },
        rotation: 0,
        mirror: "none",
      });
      expect(edit.instance.id).toMatch(/^instance-alloc-/);
    }
  });

  it("rejects vdd and unknown symbols at the human-fact boundary", () => {
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "vdd",
          reference: "V1",
          position: { x: 0, y: 0 },
        },
      ],
      "add-power-rail",
    );
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "some-pdk-nmos",
          reference: "M9",
          position: { x: 0, y: 0 },
        },
      ],
      "reviewed built-in catalog",
    );
  });

  it("rejects duplicate Instance References", () => {
    expectCompileError(
      [
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "M1",
          position: { x: 0, y: 0 },
        },
      ],
      "already exists",
    );
  });

  it("compiles add-power-rail and reuses the existing global VDD net", () => {
    const [transaction] = compile([
      {
        kind: "add-power-rail",
        start: { x: 100, y: 80 },
        end: { x: 500, y: 80 },
      },
    ]);
    const edit = transaction?.edits?.[0];
    expect(edit?.kind).toBe("add_power_rail");
    if (edit?.kind === "add_power_rail") {
      expect(edit.netId).toBe("net-vdd");
      expect(edit).toMatchObject({
        netName: "VDD",
        scope: "global",
        powerDomain: "vdd",
      });
      expect(edit.routeId).not.toBe(edit.netId);
      expect(edit.startJunctionId).not.toBe(edit.endJunctionId);
    }
  });

  it("compiles vertical Power Rails and rejects diagonal geometry", () => {
    const [transaction] = compile([
      {
        kind: "add-power-rail",
        start: { x: 40, y: 0 },
        end: { x: 40, y: 160 },
      },
    ]);
    expect(transaction?.edits?.[0]).toMatchObject({
      kind: "add_power_rail",
      start: { x: 40, y: 0 },
      end: { x: 40, y: 160 },
    });
    expectCompileError(
      [
        {
          kind: "add-power-rail",
          start: { x: 0, y: 0 },
          end: { x: 100, y: 40 },
        },
      ],
      "horizontal or vertical",
    );
  });

  it("compiles pin-to-pin connect into one visible wire intent with waypoints", () => {
    const [transaction] = compile([
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "pin", instance: "M1", pin: "S" },
        via: [
          { x: 460, y: 220 },
          { x: 300, y: 220 },
        ],
      },
    ]);
    expect(transaction?.form).toBe("wire-intent");
    expect(transaction?.wireIntent).toMatchObject({
      from: {
        kind: "endpoint",
        endpoint: {
          kind: "terminal",
          instanceId: "instance-2",
          pinName: "2",
        },
      },
      to: {
        kind: "endpoint",
        endpoint: {
          kind: "terminal",
          instanceId: "instance-1",
          pinName: "S",
        },
      },
      waypoints: [
        { x: 460, y: 220 },
        { x: 300, y: 220 },
      ],
    });
  });

  it("uses a free point, not the page origin, when attaching it to a Net", () => {
    const [transaction] = compile([
      {
        kind: "connect",
        from: { kind: "point", x: 480, y: 160 },
        to: { kind: "net", net: "Vout" },
      },
    ]);
    expect(transaction?.wireIntent?.to).toEqual({
      kind: "route-segment",
      routeId: "route-1",
      legId: testSnapshot().document.routes[0]!.legs[1]!.id,
      point: { x: 460, y: 160 },
    });
  });

  it("keeps endpoint identity in the visible pin-to-pin wire intent", () => {
    const [transaction] = compile([
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "pin", instance: "M1", pin: "S" },
      },
    ]);
    if (transaction?.wireIntent?.from.kind === "endpoint") {
      expect(transaction.wireIntent.from.endpoint).toEqual({
        kind: "terminal",
        instanceId: "instance-2",
        pinName: "2",
      });
    }
    if (transaction?.wireIntent?.to.kind === "endpoint") {
      expect(transaction.wireIntent.to.endpoint).toEqual({
        kind: "terminal",
        instanceId: "instance-1",
        pinName: "S",
      });
    }
  });

  it("compiles pin-to-net connect into a wire intent anchored on the nearest route segment", () => {
    const [transaction] = compile([
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "net", net: "Vout" },
      },
    ]);
    expect(transaction?.form).toBe("wire-intent");
    const intent = transaction?.wireIntent;
    expect(intent?.from).toEqual({
      kind: "endpoint",
      endpoint: { kind: "terminal", instanceId: "instance-2", pinName: "2" },
    });
    expect(intent?.to.kind).toBe("route-segment");
    if (intent?.to.kind === "route-segment") {
      expect(intent.to.routeId).toBe("route-1");
      // R1 pin 2 sits at (460,180); nearest point on the polyline is the
      // (460,160) corner reached on segment index 1.
      expect(intent.to.point).toEqual({ x: 460, y: 160 });
      expect(intent.to.legId).toBe(
        testSnapshot().document.routes[0]!.legs[1]!.id,
      );
    }
  });

  it("falls back to the nearest junction when the net has no routes", () => {
    const [transaction] = compile([
      {
        kind: "connect",
        from: { kind: "pin", instance: "M1", pin: "D" },
        to: { kind: "net", net: "VDD" },
      },
    ]);
    const intent = transaction?.wireIntent;
    expect(intent?.to).toEqual({
      kind: "endpoint",
      endpoint: { kind: "junction", junctionId: "junction-1" },
    });
  });

  it("refuses net targets without attachable geometry", () => {
    const bare = testSnapshot();
    bare.document.nets[0]!.routeIds = [];
    bare.document.nets[0]!.junctionIds = [];
    try {
      compileActions(
        [
          {
            kind: "connect",
            from: { kind: "pin", instance: "R1", pin: "2" },
            to: { kind: "net", net: "Vout" },
          },
        ],
        { snapshot: bare, allocateId },
      );
      expect.unreachable("expected ActionCompileError");
    } catch (error) {
      expect(error).toBeInstanceOf(ActionCompileError);
      expect((error as Error).message).toContain(
        "no route or junction geometry",
      );
    }
  });

  it("refuses pin targets the snapshot does not report", () => {
    expectCompileError(
      [
        {
          kind: "connect",
          from: { kind: "pin", instance: "M1", pin: "X" },
          to: { kind: "pin", instance: "R1", pin: "1" },
        },
      ],
      'no pin "X"',
    );
  });

  it("compiles disconnect for pins and routes", () => {
    const [transaction] = compile([
      { kind: "disconnect", target: { kind: "pin", instance: "R1", pin: "2" } },
      { kind: "disconnect", target: { kind: "route", route: "route-1" } },
    ]);
    expect(transaction?.edits?.[0]).toMatchObject({
      kind: "disconnect_endpoint",
    });
    expect(transaction?.edits?.[1]).toMatchObject({
      kind: "cut_connection",
      routeId: "route-1",
    });
  });

  it("compiles move, rotate, and mirror for instances and junctions", () => {
    const [transaction] = compile([
      {
        kind: "move",
        target: { kind: "instance", reference: "M1" },
        position: { x: 10, y: 20 },
      },
      {
        kind: "move",
        target: { kind: "junction", id: "junction-1" },
        position: { x: 1, y: 2 },
      },
      {
        kind: "rotate",
        target: { kind: "instance", id: "instance-2" },
        rotation: 90,
      },
      {
        kind: "mirror",
        target: { kind: "instance", reference: "M1" },
        mirror: "x",
      },
    ]);
    expect(transaction?.edits).toEqual([
      {
        kind: "move_instance",
        instanceId: "instance-1",
        position: { x: 10, y: 20 },
      },
      {
        kind: "move_junction",
        junctionId: "junction-1",
        position: { x: 1, y: 2 },
      },
      { kind: "rotate_instance", instanceId: "instance-2", rotation: 90 },
      { kind: "mirror_instance", instanceId: "instance-1", mirror: "x" },
    ]);
  });

  it("compiles set-reference as a typed reference edit", () => {
    const [transaction] = compile([
      {
        kind: "set-reference",
        target: { kind: "instance", reference: "M1" },
        reference: "MN0",
      },
    ]);
    const edit = transaction?.edits?.[0];
    expect(edit).toEqual({
      kind: "set_instance_reference",
      instanceId: "instance-1",
      reference: "MN0",
    });
  });

  it("compiles set-property and rejects spice.* keys", () => {
    const [transaction] = compile([
      {
        kind: "set-property",
        target: { kind: "instance", reference: "M1" },
        set: { w: "4u" },
        unset: ["note"],
      },
    ]);
    expect(transaction?.edits?.[0]).toEqual({
      kind: "patch_instance_netlist_parameters",
      instanceId: "instance-1",
      set: { w: "4u" },
      unset: ["note"],
    });
    expectCompileError(
      [
        {
          kind: "set-property",
          target: { kind: "instance", reference: "M1" },
          set: { "spice.model": "nch" },
        },
      ],
      "spice.*",
    );
  });

  it("compiles add-label with a derived position from net geometry", () => {
    const [transaction] = compile([
      {
        kind: "add-label",
        target: { kind: "net", name: "Vout" },
        text: "Vout",
      },
    ]);
    const edit = transaction?.edits?.[0];
    expect(edit?.kind).toBe("upsert_schematic_annotation");
    if (edit?.kind === "upsert_schematic_annotation") {
      expect(edit.annotation.kind).toBe("net-label");
      expect(edit.annotation.netId).toBe("net-vout");
      // midpoint of route-1 polyline ((460,160)), lifted 20 above
      expect(edit.annotation.anchor).toEqual({
        kind: "free",
        position: { x: 460, y: 140 },
      });
    }
  });

  it("labels supply nets as power-labels", () => {
    const [transaction] = compile([
      {
        kind: "add-label",
        target: { kind: "net", name: "VDD" },
        text: "VDD",
        position: { x: 5, y: 5 },
      },
    ]);
    const edit = transaction?.edits?.[0];
    expect(edit?.kind).toBe("upsert_schematic_annotation");
    if (edit?.kind === "upsert_schematic_annotation") {
      expect(edit.annotation.kind).toBe("power-label");
    }
  });

  it("compiles annotate into a drafting text object and edit-text onto it", () => {
    const [annotated] = compile([
      { kind: "annotate", text: "Bias branch", position: { x: 50, y: 400 } },
    ]);
    const edit = annotated?.edits?.[0];
    expect(edit?.kind).toBe("upsert_drafting_object");
    if (edit?.kind === "upsert_drafting_object") {
      expect(edit.object.kind).toBe("text");
      const text = edit.object as { content: { runs: { value?: string }[] } };
      expect(text.content.runs[0]?.value).toBe("Bias branch");
    }

    const [edited] = compile([
      {
        kind: "edit-text",
        target: { kind: "annotation", id: "label-1" },
        text: "Vout node",
      },
    ]);
    const annotationEdit = edited?.edits?.[0];
    expect(annotationEdit?.kind).toBe("upsert_schematic_annotation");
    if (annotationEdit?.kind === "upsert_schematic_annotation") {
      expect(annotationEdit.annotation.id).toBe("label-1");
      expect(annotationEdit.annotation.content!.runs[0]).toEqual({
        kind: "text",
        value: "Vout node",
      });
    }
  });

  it("preserves structured RichText instead of flattening it", () => {
    const content = {
      runs: [
        { kind: "text" as const, value: "V" },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "out" }],
        },
      ],
    };
    const [annotated] = compile([
      { kind: "annotate", text: content, position: { x: 50, y: 400 } },
    ]);
    const edit = annotated?.edits?.[0];
    if (
      edit?.kind === "upsert_drafting_object" &&
      edit.object.kind === "text"
    ) {
      expect(edit.object.content).toEqual(content);
    } else {
      expect.unreachable("expected drafting text edit");
    }
  });

  it("compiles arrange into align_instances with resolved ids", () => {
    const [transaction] = compile([
      {
        kind: "arrange",
        instances: [
          { kind: "instance", reference: "M1" },
          { kind: "instance", reference: "R1" },
        ],
        axis: "x",
        coordinate: 240,
      },
    ]);
    expect(transaction?.edits?.[0]).toEqual({
      kind: "align_instances",
      instanceIds: ["instance-1", "instance-2"],
      axis: "x",
      coordinate: 240,
    });
  });

  it("compiles delete for supported kinds and refuses nets", () => {
    const [transaction] = compile([
      { kind: "delete", target: { kind: "instance", reference: "R1" } },
      { kind: "delete", target: { kind: "route", id: "route-1" } },
      { kind: "delete", target: { kind: "annotation", id: "label-1" } },
    ]);
    expect(transaction?.edits?.map((edit) => edit.kind)).toEqual([
      "remove_instance",
      "cut_connection",
      "remove_schematic_annotation",
    ]);
    expectCompileError(
      [{ kind: "delete", target: { kind: "net", name: "Vout" } }],
      "disconnect",
    );
  });

  it("groups consecutive edits and keeps wire intents as separate transactions", () => {
    const transactions = compile([
      {
        kind: "move",
        target: { kind: "instance", reference: "M1" },
        position: { x: 0, y: 0 },
      },
      {
        kind: "rotate",
        target: { kind: "instance", reference: "M1" },
        rotation: 90,
      },
      {
        kind: "connect",
        from: { kind: "pin", instance: "R1", pin: "2" },
        to: { kind: "net", net: "VDD" },
      },
      {
        kind: "move",
        target: { kind: "instance", reference: "R1" },
        position: { x: 1, y: 1 },
      },
    ]);
    expect(transactions.map((t) => t.form)).toEqual([
      "edits",
      "wire-intent",
      "edits",
    ]);
    expect(transactions[0]?.edits?.length).toBe(2);
    expect(transactions[2]?.edits?.length).toBe(1);
  });

  it("rejects malformed action batches with the failing index", () => {
    expectCompileError(
      [
        {
          kind: "move",
          target: { kind: "instance", reference: "M1" },
          position: { x: 0, y: 0 },
        },
        {
          kind: "rotate",
          target: { kind: "instance", reference: "M1" },
        },
      ],
      "rotation",
    );
  });
});
