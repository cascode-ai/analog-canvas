import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  createRoutePath,
  flattenRichText,
} from "@icm/model";
import {
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
  derivePowerRailComponent,
} from "@icm/derived";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { callTool, type ToolSessionState } from "../../../mcp-server/src/tools";
import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";
import {
  planBrowserAgentCommand,
  type BrowserAgentPlanningContext,
} from "./browser-agent-command";
import type { CircuitProject } from "@icm/model";
import { initialComponentParameterValues } from "../features/component-insert/component-parameters";
import { placedInstanceNetlist } from "../features/component-insert/placed-instance-netlist";
import { createDefaultNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import {
  inferNetlistProcess,
  instanceModelTarget,
  placementModelTarget,
  placementProcessFill,
  processTargetForShortName,
} from "../features/netlist-export/netlist-process";
import { createDesignNetlistExport } from "@icm/netlist";
import { executeProjectTransaction } from "@icm/edit-engine";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";

it.each(["move", "transform"] as const)(
  "moves a pin-connected T junction through MCP %s and restores it with shared history",
  async (kind) => {
    const project = createEmptyProject("project-1", "Junction");
    const document = project.documents[0]!;
    document.nets.push({
      id: "net",
      terminals: [{ instanceId: "RB", pinName: "1" }],
    });
    document.instances.push({
      id: "RB",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    const terminal = {
      kind: "terminal" as const,
      instanceId: "RB",
      pinName: "1",
    };
    const pin = resolveEndpointConnection(
      document,
      new InMemorySymbolResolver(builtInSymbols),
      terminal,
    )!.contactPoint;
    document.instances[0]!.placement!.position = { x: -pin.x, y: 20 - pin.y };
    document.junctions.push(
      { id: "J", netId: "net", position: { x: 0, y: 0 } },
      {
        id: "L",
        netId: "net",
        position: { x: -100, y: 0 },
        role: "route-anchor",
      },
      {
        id: "R",
        netId: "net",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    for (const end of ["L", "R", "B"])
      document.routes.push(
        createRoutePath({
          id: `wire-${end}`,
          netId: "net",
          start: end === "B" ? terminal : { kind: "junction", junctionId: "J" },
          end: { kind: "junction", junctionId: end === "B" ? "J" : end },
          bends: [],
          modes: ["manual"],
        }),
      );
    const { tool, controller, client } = await folder(project);
    const before = structuredClone(controller.document);
    const moved = await tool(
      kind === "move" ? "circuit_transform" : "circuit_selection",
      {
        actions: [
          kind === "move"
            ? {
                kind: "move",
                target: { kind: "junction", id: "J" },
                position: { x: 40, y: 0 },
              }
            : {
                kind: "transform",
                selection: { junctionIds: ["J"] },
                transform: { kind: "translate", delta: { x: 40, y: 0 } },
              },
        ],
      },
    );
    expect(moved.ok, moved.message).toBe(true);
    const after = structuredClone(controller.document);
    expect(after.junctions.find((j) => j.id === "J")?.position).toEqual({
      x: 40,
      y: 0,
    });
    expect(after.nets).toEqual(before.nets);
    expect(after.instances).toEqual(before.instances);
    expect(after.routes).not.toEqual(before.routes);
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.junctions).toEqual(before.junctions);
    expect(controller.document.routes).toEqual(before.routes);
    expect((await client.applyActions([{ kind: "redo" }])).ok).toBe(true);
    expect(controller.document.junctions).toEqual(after.junctions);
    expect(controller.document.routes).toEqual(after.routes);
    const revision = controller.document.revision;
    const noop = await client.applyActions([
      {
        kind: "move",
        target: { kind: "junction", id: "J" },
        position: { x: 40, y: 0 },
      },
    ]);
    expect(noop.ok, noop.message).toBe(true);
    expect(controller.document.revision).toBe(revision);
    const rejected = await client.applyActions([
      {
        kind: "move",
        target: { kind: "junction", id: "J" },
        position: { x: 60, y: 0 },
      },
      {
        kind: "move",
        target: { kind: "junction", id: "missing" },
        position: { x: 80, y: 0 },
      },
    ]);
    expect(rejected.ok).toBe(false);
    expect(controller.document.revision).toBe(revision);
    expect(controller.document.junctions).toEqual(after.junctions);
  },
);

it("gives Agent-placed comparators the same isolated model as GUI placement", async () => {
  const { client, controller } = await folder();
  const placed = await client.applyActions([
    {
      kind: "place-component",
      symbol: "comparator",
      reference: "X1",
      position: { x: 100, y: 100 },
      parameters: { vhigh: "3.3" },
    },
    {
      kind: "place-component",
      symbol: "opamp",
      reference: "X2",
      position: { x: 220, y: 100 },
    },
  ]);
  expect(placed.ok, placed.message).toBe(true);
  expect(controller.document.instances[0]?.netlist).toEqual({
    binding: { kind: "unresolved-subcircuit", name: "icm_ideal_comparator" },
    parameters: { vhigh: "3.3", vlow: "0", vtransition: "1m" },
  });
  expect(controller.document.instances[1]?.netlist).toEqual({
    binding: { kind: "unresolved-subcircuit", name: "opamp" },
    parameters: { gain: "1e6" },
  });
});

it("keeps the native power-label look through a plain-text rename", async () => {
  const { client, controller } = await folder();
  const placed = await client.applyActions([
    {
      kind: "place-component",
      symbol: "vdd-port",
      position: { x: 100, y: 100 },
    },
  ]);
  expect(placed.ok, placed.message).toBe(true);
  expect(
    (
      await client.applyActions([
        {
          kind: "set-vdd-mode",
          instanceId: controller.document.instances[0]!.id,
          mode: "global",
        },
      ])
    ).ok,
  ).toBe(true);
  const label = controller.document.annotations.find(
    (a) => a.kind === "power-label",
  )!;
  expect(label).toBeDefined();
  expect(JSON.stringify(label.formatOverride)).toContain("italic");
  const edited = await client.applyActions([
    {
      kind: "edit-text",
      target: { kind: "annotation", id: label.id },
      text: "VCC",
    },
  ]);
  expect(edited.ok, edited.message).toBe(true);
  const after = controller.document.annotations.find((a) => a.id === label.id)!;
  expect(JSON.stringify(after.formatOverride)).toContain("italic");
  expect(flattenRichText(after.formatOverride!)).toBe("VCC");
});

it.each([0, 90, 180, 270] as const)(
  "moves a mirrored Instance by its pin landing at rotation %s without changing its look or connectivity",
  async (rotation) => {
    const { client, controller, tool } = await folder();
    expect(
      (
        await client.applyActions([
          {
            kind: "place-component",
            symbol: "nmos",
            reference: "M1",
            pinAnchor: { pinName: "G", position: { x: 100, y: 100 } },
            rotation,
            mirror: "horizontal",
          },
        ])
      ).ok,
    ).toBe(true);
    const before = structuredClone(controller.document);
    const instance = controller.document.instances[0]!;
    const moved = await tool("circuit_transform", {
      actions: [
        {
          kind: "move",
          target: { kind: "instance", id: instance.id },
          pinAnchor: { pinName: "D", position: { x: 300, y: 300 } },
        },
      ],
    });
    expect(moved.ok, moved.message).toBe(true);
    expect(
      resolveEndpointConnection(controller.document, controller.resolver, {
        kind: "terminal",
        instanceId: instance.id,
        pinName: "D",
      })?.gridLanding,
    ).toEqual({ x: 300, y: 300 });
    expect(controller.document.instances[0]!.placement).toMatchObject({
      rotation,
      mirror: "horizontal",
    });
    expect(controller.document.nets).toEqual(before.nets);
    expect(
      controller.document.annotations.map((a) => [
        a.id,
        a.binding,
        a.formatOverride,
      ]),
    ).toEqual(
      before.annotations.map((a) => [a.id, a.binding, a.formatOverride]),
    );
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.instances).toEqual(before.instances);
    const rejected = await client.applyActions([
      {
        kind: "move",
        target: { kind: "instance", id: instance.id },
        pinAnchor: { pinName: "missing", position: { x: 300, y: 300 } },
      },
    ]);
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain("missing");
    expect(controller.document.instances).toEqual(before.instances);
    const offGrid = await client.applyActions([
      {
        kind: "move",
        target: { kind: "instance", id: instance.id },
        pinAnchor: { pinName: "G", position: { x: 301, y: 300 } },
      },
    ]);
    expect(offGrid.ok).toBe(false);
    expect(controller.document.instances).toEqual(before.instances);
  },
);

it("copies one side and mirrors the new identity around an explicit axis without linking the originals", async () => {
  const { client, controller, add } = await folder();
  const id = await add();
  const original = structuredClone(controller.document.instances[0]!);
  const copied = await client.applyActions([
    { kind: "copy", selection: { instanceIds: [id] }, offset: { x: 0, y: 0 } },
  ]);
  expect(copied.ok, copied.message).toBe(true);
  const other = controller.document.instances.find((item) => item.id !== id)!;
  expect(other.reference).not.toBe(original.reference);
  const afterCopy = structuredClone(controller.document);
  const mirrored = await client.applyActions([
    {
      kind: "transform",
      selection: { instanceIds: [other.id] },
      transform: { kind: "mirror", axis: "y", center: { x: 200, y: 100 } },
    },
  ]);
  expect(mirrored.ok, mirrored.message).toBe(true);
  expect(controller.document.instances.find((item) => item.id === id)).toEqual(
    original,
  );
  expect(
    controller.document.instances.find((item) => item.id === other.id)
      ?.placement,
  ).toMatchObject({ position: { x: 300, y: 100 }, mirror: "horizontal" });
  expect(controller.document.nets).toEqual(afterCopy.nets);
  expect(
    controller.document.annotations.filter(
      (a) => a.anchor.kind === "object" && a.anchor.objectId === other.id,
    ),
  ).toHaveLength(1);
  expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
  expect(controller.document.instances).toEqual(afterCopy.instances);
  expect(controller.document.annotations).toEqual(afterCopy.annotations);
});

it("translates free drafting text atomically, preserves fine placement, and rejects locked or separately attached text", async () => {
  const { tool, controller, client, add } = await folder();
  const instanceId = await add();
  const added = await tool("circuit_text", {
    actions: [
      { kind: "annotate", text: "Bias branch", position: { x: 303, y: 107 } },
    ],
  });
  expect(added.ok, added.message).toBe(true);
  const text = controller.document.drafting!.objects[0]!;
  const before = structuredClone(controller.project);
  const moved = await tool("circuit_selection", {
    actions: [
      {
        kind: "transform",
        selection: { draftingIds: [text.id] },
        transform: { kind: "translate", delta: { x: 10, y: 20 } },
      },
    ],
  });
  expect(moved.ok, moved.message).toBe(true);
  expect(controller.document.drafting!.objects[0]).toEqual({
    ...text,
    anchor: { kind: "free", position: { x: 313, y: 127 } },
  });
  expect(controller.document.instances).toEqual(before.documents[0]!.instances);
  await client.applyActions([{ kind: "undo" }]);
  expect(controller.document.drafting).toEqual(before.documents[0]!.drafting);
  for (const attached of [false, true]) {
    const object = {
      ...text,
      locked: !attached,
      ...(attached
        ? {
            anchor: {
              kind: "object" as const,
              objectId: instanceId,
              localOffset: { x: 30, y: 10 },
              fallbackPosition: { x: 303, y: 107 },
            },
          }
        : {}),
    };
    const updated = controller.transact([
      { kind: "upsert_drafting_object", object },
    ]);
    expect(updated.ok, JSON.stringify(updated)).toBe(true);
    await client.refreshSnapshot();
    const snapshot = structuredClone(controller.project);
    const result = await tool("circuit_selection", {
      actions: [
        {
          kind: "transform",
          selection: { draftingIds: [text.id], instanceIds: [] },
          transform: { kind: "translate", delta: { x: 10, y: 20 } },
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(controller.project).toEqual(snapshot);
    await client.applyActions([{ kind: "undo" }]);
  }
  expect(
    controller.transact([
      {
        kind: "upsert_drafting_object",
        object: {
          ...text,
          anchor: {
            kind: "object",
            objectId: instanceId,
            localOffset: { x: 30, y: 10 },
            fallbackPosition: { x: 303, y: 107 },
          },
        },
      },
    ]).ok,
  ).toBe(true);
  await client.refreshSnapshot();
  const anchored = structuredClone(controller.document.drafting!.objects[0]!);
  const together = await tool("circuit_selection", {
    actions: [
      {
        kind: "transform",
        selection: { draftingIds: [text.id], instanceIds: [instanceId] },
        transform: { kind: "translate", delta: { x: 10, y: 20 } },
      },
    ],
  });
  expect(together.ok, together.message).toBe(true);
  expect(controller.document.drafting!.objects[0]).toEqual(anchored);
});

it("explains formal Pin disconnection and removes seven terminals atomically instead", async () => {
  const { client, controller, tool } = await folder();
  const placed = await tool("circuit_place", {
    actions: Array.from({ length: 7 }, (_, i) => ({
      kind: "place-component",
      symbol: "port",
      reference: `P${i}`,
      position: { x: i * 100, y: 100 },
    })),
  });
  expect(placed.ok, JSON.stringify(placed)).toBe(true);
  const before = structuredClone(controller.project);
  const terminals = controller.document.netlist!.terminals;
  const rejected = await tool("circuit_wire", {
    actions: [
      {
        kind: "disconnect",
        target: {
          kind: "pin",
          instance: {
            kind: "instance",
            id: terminals[0]!.interfaceInstanceIds[0]!,
          },
          pin: "P",
        },
      },
    ],
  });
  expect(rejected).toMatchObject({ ok: false, actionIndex: 0 });
  expect(rejected.message).toContain("remove-cell-terminal");
  expect(controller.project).toEqual(before);
  const removed = await tool("apply_actions", {
    actions: terminals.map((t) => ({
      kind: "remove-cell-terminal",
      terminalId: t.id,
    })),
  });
  expect(removed.ok, JSON.stringify(removed)).toBe(true);
  expect(controller.document.netlist!.terminals).toEqual([]);
  expect(controller.document.instances).toEqual([]);
  await client.applyActions([{ kind: "undo" }]);
  expect(controller.document.instances).toEqual(before.documents[0]!.instances);
  expect(controller.document.netlist).toEqual(before.documents[0]!.netlist);
});

it("rejects a wrongly classified selection before deleting any valid member", async () => {
  const { tool, controller, client, add } = await folder();
  const id = await add();
  expect(
    (
      await tool("circuit_text", {
        actions: [
          { kind: "annotate", position: { x: 300, y: 100 }, text: "Keep me" },
        ],
      })
    ).ok,
  ).toBe(true);
  const textId = controller.document.drafting!.objects[0]!.id;
  const before = structuredClone(controller.project);
  const rejected = await tool("apply_actions", {
    actions: [
      {
        kind: "delete-selection",
        selection: { instanceIds: [id], annotationIds: [textId] },
      },
    ],
  });
  expect(rejected).toMatchObject({ ok: false });
  expect(rejected.message).toContain("annotationIds");
  expect(rejected.message).toContain(textId);
  expect(rejected.message).toContain("draftingIds");
  expect(controller.project).toEqual(before);
  const accepted = await tool("apply_actions", {
    actions: [
      {
        kind: "delete-selection",
        selection: { instanceIds: [id], draftingIds: [textId] },
      },
    ],
  });
  expect(accepted.ok, accepted.message).toBe(true);
  expect(controller.document.instances).toEqual([]);
  expect(controller.document.drafting?.objects ?? []).toEqual([]);
  await client.applyActions([{ kind: "undo" }]);
  expect(controller.document.instances).toEqual(before.documents[0]!.instances);
  expect(controller.document.drafting).toEqual(before.documents[0]!.drafting);
});

it.each([
  "instanceIds",
  "routeIds",
  "junctionIds",
  "annotationIds",
  "draftingIds",
  "noConnectIds",
])(
  "rejects missing %s in the Agent boundary without creating an undo step",
  async (field) => {
    const { tool, controller, add } = await folder();
    const id = await add();
    const before = structuredClone(controller.project);
    const result = await tool("apply_actions", {
      actions: [
        {
          kind: "delete-selection",
          selection: {
            instanceIds: [id],
            [field]: field === "instanceIds" ? [id, "missing"] : ["missing"],
          },
        },
      ],
    });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain(field);
    expect(controller.project).toEqual(before);
    await tool("apply_actions", { actions: [{ kind: "undo" }] });
    expect(controller.document.instances).toEqual([]);
  },
);

it.each(["connect", "route-net"])(
  "commits %s at drawing scale in one call, then undoes the whole graph",
  async (method) => {
    const { client, controller, tool } = await folder();
    const count = method === "connect" ? 12 : 11;
    const placements = Array.from({ length: count }, (_, i) => [
      {
        kind: "place-component",
        symbol: "resistor",
        reference: `RL${i}`,
        position: { x: 0, y: i * 200 },
        rotation: 270,
      },
      {
        kind: "place-component",
        symbol: "resistor",
        reference: `RR${i}`,
        position: { x: 400, y: i * 200 },
        rotation: 270,
      },
      ...(i < 5
        ? [1, 2].map((j) => ({
            kind: "place-component",
            symbol: "resistor",
            reference: `RT${i}${j}`,
            position: { x: j * 100, y: i * 200 + 100 },
          }))
        : []),
    ]).flat();
    // Placement setup is not the wire-batch assertion; respect the normal
    // per-transaction edit budget (each part also owns display annotations).
    for (let offset = 0; offset < placements.length; offset += 16) {
      const placement = await tool("circuit_place", {
        actions: placements.slice(offset, offset + 16),
      });
      expect(placement.ok, JSON.stringify(placement)).toBe(true);
    }
    const before = structuredClone(controller.document);
    const actions =
      method === "route-net"
        ? Array.from({ length: count }, (_, i) => ({
            kind: "route-net",
            target: {
              kind: "pins",
              pins: [
                [`RL${i}`, "2"],
                [`RR${i}`, "1"],
                ...(i < 5
                  ? [
                      [`RT${i}1`, "1"],
                      [`RT${i}2`, "1"],
                    ]
                  : []),
              ].map(([ref, pinName]) => ({
                instanceId: controller.document.instances.find(
                  (v) => v.reference === ref,
                )!.id,
                pinName,
              })),
            },
            trunk: {
              start: { x: 20, y: i * 200 },
              end: { x: 380, y: i * 200 },
            },
          }))
        : [
            ...Array.from({ length: count }, (_, i) => ({
              kind: "connect",
              from: { kind: "pin", instance: `RL${i}`, pin: "2" },
              to: { kind: "pin", instance: `RR${i}`, pin: "1" },
            })),
            ...Array.from({ length: 5 }, (_, i) =>
              [1, 2].map((j) => ({
                kind: "connect",
                from: { kind: "pin", instance: `RT${i}${j}`, pin: "1" },
                to: { kind: "wire-at", point: { x: j * 100, y: i * 200 } },
              })),
            ).flat(),
          ];
    if (method === "route-net") {
      const rejected = await tool("apply_actions", {
        actions: [
          ...actions,
          {
            kind: "route-net",
            target: { kind: "member", instanceId: "missing", pinName: "1" },
          },
        ],
      });
      expect(rejected).toMatchObject({ ok: false, actionIndex: count });
      expect(controller.document).toEqual(before);
    }
    const result = await tool(
      method === "connect" ? "circuit_wire" : "apply_actions",
      { actions },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(controller.document.revision).toBe(before.revision + 1);
    expect(controller.document.junctions).toHaveLength(10);
    expect(controller.document.nets).toHaveLength(count);
    if (method === "route-net") {
      const after = structuredClone(controller.document);
      const repeated = await tool("apply_actions", { actions });
      expect(repeated.ok, JSON.stringify(repeated)).toBe(true);
      expect(controller.document).toEqual(after);
    }
    for (let i = 0; i < count; i++) {
      const refs = new Map(
        controller.document.instances.map((v) => [v.id, v.reference]),
      );
      const node = controller.document.nets.find((n) =>
        n.terminals.some((t) => refs.get(t.instanceId) === `RL${i}`),
      )!;
      expect(
        node.terminals
          .map((t) => `${refs.get(t.instanceId)}.${t.pinName}`)
          .sort(),
      ).toEqual(
        [
          `RL${i}.2`,
          `RR${i}.1`,
          ...(i < 5 ? [`RT${i}1.1`, `RT${i}2.1`] : []),
        ].sort(),
      );
    }
    await client.applyActions([{ kind: "undo" }]);
    expect(controller.document.routes).toEqual(before.routes);
    expect(controller.document.junctions).toEqual(before.junctions);
    expect(controller.document.nets).toEqual(before.nets);
  },
);

it("arranges default labels through the focused MCP entry in one undo, without changing topology", async () => {
  const { tool, controller, client, add } = await folder();
  const id = await add();
  // MBIAS would already read M_BIAS, its device letter over the rest
  // (#1116); a name that does not start with M still needs the arrangement.
  expect(
    (
      await client.applyActions([
        {
          kind: "set-reference",
          target: { kind: "instance", id },
          reference: "XBIAS",
        },
      ])
    ).ok,
  ).toBe(true);
  const before = structuredClone(controller.document);
  const result = await tool("circuit_text", {
    actions: [
      {
        kind: "arrange-labels",
        instanceIds: [id],
        referenceStyle: "first-letter-subscript",
      },
    ],
  });
  expect(result.ok, result.message).toBe(true);
  expect(controller.document.instances).toEqual(before.instances);
  expect(controller.document.nets).toEqual(before.nets);
  expect(controller.document.revision).toBe(before.revision + 1);
  await client.applyActions([{ kind: "undo" }]);
  expect(controller.document.annotations).toEqual(before.annotations);
  const rejected = await tool("circuit_text", {
    actions: [{ kind: "arrange-labels", instanceIds: [id, "missing"] }],
  });
  expect(rejected.ok).toBe(false);
  expect(controller.document.annotations).toEqual(before.annotations);
});

it("keeps the first supply default in a placement batch and preserves it in later batches", async () => {
  const { client, controller } = await folder();
  for (const references of [
    ["AVDD", "DVDD"],
    ["VDDH", "VDDL"],
  ]) {
    const previous = controller.document.mosBulkDefaults?.pmosNetId;
    const result = await client.applyActions(
      references.map((reference, i) => ({
        kind: "place-component",
        symbol: "vdd-port",
        reference,
        position: { x: 100 + i * 100, y: previous ? 200 : 100 },
      })),
    );
    expect(result.ok, result.message).toBe(true);
    expect(controller.document.mosBulkDefaults?.pmosNetId).toBe(
      previous ??
        controller.document.netlist!.terminals.find((t) => t.name === "AVDD")!
          .netId,
    );
  }
  const result = await client.applyActions([
    { kind: "place-component", symbol: "ground", position: { x: 0, y: 0 } },
  ]);
  expect(result.ok, result.message).toBe(true);
  const ground = controller.document.instances.find(
    (i) => i.symbolId === "ground",
  )!;
  expect(controller.document.mosBulkDefaults?.nmosNetId).toBe(
    controller.document.nets.find((n) =>
      n.terminals.some((p) => p.instanceId === ground.id),
    )!.id,
  );
});

it("places a part with the catalog defaults and the Process model a GUI placement gets", async () => {
  const { controller } = await folder();
  const preferences = createDefaultNetlistExportPreferences();
  expect(preferences.selected).toBe("sky130");
  const context = {
    processModelTarget: (project: CircuitProject, symbolId: string) =>
      placementModelTarget(project, preferences, symbolId),
  };
  const at = (x: number) => ({
    position: { x, y: 100 },
    rotation: 0 as const,
    mirror: "none" as const,
  });
  const plan = planBrowserAgentCommand(
    controller.project,
    controller.document.id,
    controller.resolver,
    {
      kind: "place-components",
      instances: [
        { id: "M1", symbolId: "nmos", reference: "M1", placement: at(100) },
        { id: "R1", symbolId: "resistor", reference: "R1", placement: at(300) },
        {
          id: "R2",
          symbolId: "resistor",
          reference: "R2",
          placement: at(500),
          netlist: { parameters: { value: "4.7k" } },
        },
      ],
    },
    Number.POSITIVE_INFINITY,
    context,
  );
  if (!("edits" in plan)) throw new Error("Expected document edits");
  const placed = new Map(
    plan.edits.flatMap((edit) =>
      edit.kind === "add_instance"
        ? [[edit.instance.id, edit.instance.netlist] as const]
        : [],
    ),
  );
  // What the library or the shapes panel places in this Project.
  const gui = (symbolId: string) =>
    placedInstanceNetlist(
      symbolId,
      initialComponentParameterValues(symbolId),
      context.processModelTarget(controller.project, symbolId),
    );
  expect(placed.get("M1")).toEqual(gui("nmos"));
  expect(placed.get("R1")).toEqual(gui("resistor"));
  expect(placed.get("M1")?.parameters).toMatchObject({ w: "1u", l: "150n" });
  // SKY130's transistor is a reviewed subcircuit: the placement's process
  // fill binds it with its definition, never a model card of that name
  // (#1249). A Process that names a plain model gives it at once.
  expect(context.processModelTarget(controller.project, "nmos")).toBe(
    undefined,
  );
  expect(placed.get("M1")?.binding).toBeUndefined();
  expect(
    placementModelTarget(
      controller.project,
      { ...preferences, selected: "abstract" },
      "nmos",
    ),
  ).toBe("NMOS");
  expect(placed.get("R1")?.parameters).toEqual({ value: "1k" });
  // A value the Agent gives still wins over the default.
  expect(placed.get("R2")?.parameters).toEqual({ value: "4.7k" });
  // Without the editor's Process, the defaults still land.
  const bare = planBrowserAgentCommand(
    controller.project,
    controller.document.id,
    controller.resolver,
    {
      kind: "place-components",
      instances: [
        { id: "R1", symbolId: "resistor", reference: "R1", placement: at(300) },
      ],
    },
  );
  if (!("edits" in bare)) throw new Error("Expected document edits");
  expect(
    bare.edits.flatMap((edit) =>
      edit.kind === "add_instance" ? [edit.instance.netlist?.parameters] : [],
    ),
  ).toEqual([{ value: "1k" }]);
});

it("places a BJT in a SKY130 Project bound to its reviewed subcircuit, count kept (#1251)", async () => {
  const preferences = createDefaultNetlistExportPreferences();
  const { client, controller } = await folder(undefined, {
    processModelTarget: (project, symbolId) =>
      placementModelTarget(project, preferences, symbolId),
    processFill: (project, documentId, edits) =>
      placementProcessFill(project, preferences, documentId, edits),
  });
  const before = controller.document.revision;
  const placed = await client.applyActions([
    {
      kind: "place-component",
      symbol: "pnp",
      reference: "Q1",
      position: { x: 0, y: 0 },
      parameters: { m: "8" },
    },
    {
      kind: "place-component",
      symbol: "npn",
      reference: "Q2",
      position: { x: 400, y: 0 },
    },
    {
      kind: "place-component",
      symbol: "resistor",
      reference: "R1",
      position: { x: 800, y: 0 },
    },
  ]);
  expect(placed.ok, placed.message).toBe(true);
  // One transaction, so one undo takes it all back.
  expect(controller.document.revision).toBe(before + 1);
  const instance = (reference: string) =>
    controller.document.instances.find((item) => item.reference === reference)!;
  const target = (reference: string) =>
    instanceModelTarget(controller.project, instance(reference));
  expect(target("Q1")).toBe("sky130_fd_pr__pnp_05v5_W0p68L0p68");
  expect(instance("Q1").netlist).toMatchObject({
    binding: { kind: "external-subcircuit" },
    parameters: { m: "8" },
  });
  expect(target("Q2")).toBe("sky130_fd_pr__npn_05v5_W1p00L1p00");
  expect(instance("Q2").netlist?.parameters).toEqual({ m: "1" });
  // The NPN's substrate terminal goes to ground, as the Process binds it.
  expect(
    controller.document.nets.some((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instance("Q2").id && terminal.pinName === "S",
      ),
    ),
  ).toBe(true);
  // A part the Process gives no subcircuit is placed exactly as before.
  expect(instance("R1").netlist).toEqual(
    placedInstanceNetlist(
      "resistor",
      initialComponentParameterValues("resistor"),
    ),
  );
  // Give every drawn pin a Net of its own, so the netlist can be read.
  const wired = structuredClone(controller.project);
  for (const [reference, pins] of [
    ["Q1", ["C", "B", "E"]],
    ["Q2", ["C", "B", "E"]],
    ["R1", ["1", "2"]],
  ] as const)
    for (const pinName of pins)
      wired.documents[0]!.nets.push({
        id: `net-${reference}-${pinName}`,
        terminals: [{ instanceId: instance(reference).id, pinName }],
      });
  const exported = createDesignNetlistExport(wired, { format: "spice" });
  const text =
    exported.status === "ready"
      ? exported.file.text
      : JSON.stringify(exported.diagnostics);
  expect(text).toMatch(
    /^XQ1 \S+ \S+ \S+ sky130_fd_pr__pnp_05v5_W0p68L0p68 m=8$/mu,
  );
  expect(text).toMatch(
    /^XQ2 \S+ \S+ \S+ VSS sky130_fd_pr__npn_05v5_W1p00L1p00 m=1$/mu,
  );
  expect(text).not.toContain("MISSING_MODEL_TARGET");
});

it("places SKY130 transistors as their reviewed subcircuits, as a GUI placement and Apply process do (#1249)", async () => {
  const preferences = createDefaultNetlistExportPreferences();
  const { client, controller } = await folder(undefined, {
    processModelTarget: (project, symbolId) =>
      placementModelTarget(project, preferences, symbolId),
    processFill: (project, documentId, edits) =>
      placementProcessFill(project, preferences, documentId, edits),
  });
  const before = controller.document.revision;
  const placed = await client.applyActions([
    {
      kind: "place-component",
      symbol: "nmos",
      reference: "M1",
      position: { x: 0, y: 0 },
    },
    {
      kind: "place-component",
      symbol: "pmos",
      reference: "M2",
      position: { x: 400, y: 0 },
      parameters: { w: "2u", m: "4" },
    },
  ]);
  expect(placed.ok, placed.message).toBe(true);
  expect(controller.document.revision).toBe(before + 1);
  const instance = (reference: string) =>
    controller.document.instances.find((item) => item.reference === reference)!;
  expect(instanceModelTarget(controller.project, instance("M1"))).toBe(
    "sky130_fd_pr__nfet_01v8",
  );
  expect(instanceModelTarget(controller.project, instance("M2"))).toBe(
    "sky130_fd_pr__pfet_01v8",
  );
  expect(instance("M1").netlist?.binding?.kind).toBe("external-subcircuit");
  // The catalog geometry and what the Agent gives stay, in metres.
  expect(instance("M2").netlist?.parameters).toMatchObject({
    w: "2u",
    l: "150n",
    m: "4",
  });
  const wired = structuredClone(controller.project);
  for (const reference of ["M1", "M2"])
    for (const pinName of ["D", "G", "S", "B"])
      wired.documents[0]!.nets.push({
        id: `net-${reference}-${pinName}`,
        terminals: [{ instanceId: instance(reference).id, pinName }],
      });
  const exported = createDesignNetlistExport(wired, { format: "spice" });
  const text =
    exported.status === "ready"
      ? exported.file.text
      : JSON.stringify(exported.diagnostics);
  // X lines in micrometres, which the SKY130 simulation profile runs; no
  // M card names the subcircuit as a model.
  expect(text).toMatch(
    /^XM1 \S+ \S+ \S+ \S+ sky130_fd_pr__nfet_01v8 .*\bl=0\.15\b.*\bw=1\b/mu,
  );
  expect(text).toMatch(
    /^XM2 \S+ \S+ \S+ \S+ sky130_fd_pr__pfet_01v8 .*\bw=2\b.*\bm=4\b/mu,
  );
  expect(text).not.toMatch(/^M\S* .*sky130_fd_pr__/mu);
});

it("reports a Cell's unbound BJT in the Cell's own diagnostics (#1251)", async () => {
  // No Process in hand, so nothing binds it.
  const { client, tool } = await folder();
  const placed = await client.applyActions([
    {
      kind: "place-component",
      symbol: "pnp",
      reference: "Q1",
      position: { x: 0, y: 0 },
    },
  ]);
  expect(placed.ok, placed.message).toBe(true);
  const diagnostics = await tool("inspect", {
    target: { kind: "diagnostics" },
    detail: "full",
    refresh: true,
  });
  expect(JSON.stringify(diagnostics)).toContain("MISSING_MODEL_TARGET");
  const verified = await tool("verify", {});
  expect(verified.errors).toBeGreaterThan(0);
});

it("reads a SKY130 short device name as its reviewed target in a SKY130 Project", async () => {
  const { controller } = await folder();
  const preferences = createDefaultNetlistExportPreferences();
  const context = {
    processModelTarget: (project: CircuitProject, symbolId: string) =>
      placementModelTarget(project, preferences, symbolId),
    processTargetForShortName: (
      project: CircuitProject,
      symbolId: string,
      name: string,
    ) => processTargetForShortName(project, preferences, symbolId, name),
  };
  const placed = planBrowserAgentCommand(
    controller.project,
    controller.document.id,
    controller.resolver,
    {
      kind: "place-components",
      instances: [
        {
          id: "M1",
          symbolId: "nmos",
          reference: "M1",
          placement: {
            position: { x: 100, y: 100 },
            rotation: 0,
            mirror: "none",
          },
        },
      ],
    },
    Number.POSITIVE_INFINITY,
    context,
  );
  if (!("edits" in placed)) throw new Error("Expected document edits");
  expect(controller.transact([...placed.edits]).ok).toBe(true);
  // nfet_01v8_lvt is how the Netlist panel lists sky130_fd_pr__nfet_01v8_lvt.
  const plan = planBrowserAgentCommand(
    controller.project,
    controller.document.id,
    controller.resolver,
    { kind: "set-model", instanceId: "M1", model: "nfet_01v8_lvt" },
    Number.POSITIVE_INFINITY,
    context,
  );
  if (!("structureEdits" in plan)) throw new Error("Expected a model plan");
  const result = executeProjectTransaction(controller.project, {
    transactionId: "set-model",
    projectId: controller.project.id,
    expectedStructureRevision: controller.project.structureRevision,
    actor: { kind: "agent", id: "test" },
    edits: [...plan.structureEdits],
  });
  if (!result.ok) throw new Error(result.error.message);
  const m1 = result.project.documents[0]!.instances.find(
    (instance) => instance.id === "M1",
  )!;
  expect(instanceModelTarget(result.project, m1)).toBe(
    "sky130_fd_pr__nfet_01v8_lvt",
  );
  // The Project stays in SKY130 rather than turning Custom.
  expect(inferNetlistProcess(result.project, "sky130")).toBe("sky130");
  // Outside SKY130 a name is taken as written: it may be the author's model.
  const empty = createEmptyProject("abstract", "Abstract");
  expect(
    processTargetForShortName(
      empty,
      { ...preferences, selected: "abstract" },
      "nmos",
      "nfet_01v8",
    ),
  ).toBeUndefined();
  expect(
    processTargetForShortName(empty, preferences, "nmos", "nfet_01v8"),
  ).toBe("sky130_fd_pr__nfet_01v8");
  expect(
    processTargetForShortName(empty, preferences, "nmos", "pfet_01v8"),
  ).toBeUndefined();
});

it("says how far a placement batch over the edit limit expands and how much of it fits", async () => {
  const { client, controller } = await folder();
  const actions = [
    ...Array.from({ length: 20 }, (_, index) => ({
      kind: "place-component" as const,
      symbol: "nmos",
      reference: `M${index + 1}`,
      position: { x: (index % 5) * 100, y: Math.floor(index / 5) * 100 },
      parameters: { w: "1u", l: "150n" },
    })),
    {
      kind: "place-component" as const,
      symbol: "vdd-port",
      position: { x: 0, y: -100 },
    },
    {
      kind: "place-component" as const,
      symbol: "ground",
      position: { x: 0, y: 500 },
    },
  ];
  const before = controller.document.revision;
  const rejected = await client.applyActions(actions);
  expect(rejected).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
  expect(controller.document.revision).toBe(before);
  const limit = rejected.diagnostics?.[0]?.parameters as
    | {
        expandedEdits: number;
        maxTransactionEdits: number;
        fittingPlacements: number;
      }
    | undefined;
  expect(limit?.maxTransactionEdits).toBe(64);
  expect(limit?.expandedEdits).toBeGreaterThan(64);
  expect(rejected.message).toContain(
    `22 placements expand to ${limit?.expandedEdits} edits, and one transaction takes at most 64. The first ${limit?.fittingPlacements} fit`,
  );
  // Split there, both calls succeed: the count is exact, not a guess.
  const fitting = limit!.fittingPlacements;
  expect(fitting).toBeGreaterThan(10);
  const first = await client.applyActions(actions.slice(0, fitting));
  expect(first.ok, first.message).toBe(true);
  const rest = await client.applyActions(actions.slice(fitting));
  expect(rest.ok, rest.message).toBe(true);
  expect(controller.document.instances).toHaveLength(22);
  // One more placement in the first call would not have fitted.
  const { client: again } = await folder();
  expect(await again.applyActions(actions.slice(0, fitting + 1))).toMatchObject(
    { ok: false, code: "LIMIT_EXCEEDED" },
  );
});

it("explains how to split an over-limit delete selection", async () => {
  const project = createEmptyProject("project-1", "Delete limit");
  const document = project.documents[0]!;
  document.nets.push({ id: "delete-net", terminals: [] });
  document.junctions.push(
    ...Array.from({ length: 70 }, (_, index) => ({
      id: `delete-junction-${index}`,
      netId: "delete-net",
      position: { x: index * 10, y: 0 },
      role: "route-anchor" as const,
    })),
  );
  const { client, controller } = await folder(project);
  const junctionIds = controller.document.junctions.map(
    (junction) => junction.id,
  );
  const rejected = await client.applyActions([
    {
      kind: "delete-selection",
      selection: { junctionIds },
    },
  ]);
  expect(rejected).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
  const limit = rejected.diagnostics?.[0]?.parameters as
    | {
        expandedEdits: number;
        maxTransactionEdits: number;
        selectedJunctions: number;
        fittingJunctions: number;
      }
    | undefined;
  expect(limit).toMatchObject({
    maxTransactionEdits: 64,
    selectedJunctions: 70,
  });
  expect(limit?.expandedEdits).toBeGreaterThan(64);
  expect(rejected.message).toContain(
    `The first ${limit?.fittingJunctions} junctions fit: delete them in one call`,
  );
  expect(controller.document.junctions).toHaveLength(70);
});

it("names the part of an over-limit delete that fits, and both calls succeed", async () => {
  // #1269: the Agent split 14 parts, 16 wires and 12 junctions by trial.
  const { client, controller, tool } = await folder();
  const placements = Array.from({ length: 12 }, (_, i) =>
    ["RL", "RR"].map((side, column) => ({
      kind: "place-component",
      symbol: "resistor",
      reference: `${side}${i}`,
      position: { x: column * 400, y: i * 200 },
      rotation: 270,
    })),
  ).flat();
  for (let offset = 0; offset < placements.length; offset += 12) {
    const placed = await tool("circuit_place", {
      actions: placements.slice(offset, offset + 12),
    });
    expect(placed.ok, JSON.stringify(placed)).toBe(true);
  }
  const wired = await tool("circuit_wire", {
    actions: Array.from({ length: 12 }, (_, i) => ({
      kind: "connect",
      from: { kind: "pin", instance: `RL${i}`, pin: "2" },
      to: { kind: "pin", instance: `RR${i}`, pin: "1" },
    })),
  });
  expect(wired.ok, JSON.stringify(wired)).toBe(true);
  const selection = {
    instanceIds: controller.document.instances.map((item) => item.id),
    routeIds: controller.document.routes.map((item) => item.id),
    junctionIds: controller.document.junctions.map((item) => item.id),
  };
  const ordered = [
    ...selection.instanceIds.map((id) => ["instanceIds", id] as const),
    ...selection.routeIds.map((id) => ["routeIds", id] as const),
    ...selection.junctionIds.map((id) => ["junctionIds", id] as const),
  ];
  const leading = (count: number) => {
    const part = {
      instanceIds: [] as string[],
      routeIds: [] as string[],
      junctionIds: [] as string[],
    };
    for (const [field, id] of ordered.slice(0, count)) part[field].push(id);
    return part;
  };
  const before = controller.document.revision;
  const rejected = await client.applyActions([
    { kind: "delete-selection", selection },
  ]);
  expect(rejected).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
  expect(controller.document.revision).toBe(before);
  const limit = rejected.diagnostics?.[0]?.parameters as Record<string, number>;
  expect(limit).toMatchObject({
    maxTransactionEdits: 64,
    selectedInstances: 24,
    selectedRoutes: 12,
  });
  expect(limit.expandedEdits).toBeGreaterThan(64);
  const fitting =
    limit.fittingInstances! + limit.fittingRoutes! + limit.fittingJunctions!;
  expect(limit.fittingInstances).toBeGreaterThan(0);
  expect(rejected.message).toMatch(
    /^actions\[0\]: Delete selection expands to \d+ edits, and one transaction takes at most 64\. (All|The first) \d+ instances.* fit: delete them in one call, then refresh and delete what remains/u,
  );
  // The count is exact: one more object does not fit, the named part does.
  expect(
    await client.applyActions(
      [{ kind: "delete-selection", selection: leading(fitting + 1) }],
      { dryRunOnly: true },
    ),
  ).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
  const first = await client.applyActions([
    { kind: "delete-selection", selection: leading(fitting) },
  ]);
  expect(first.ok, first.message).toBe(true);
  // Refresh, as the message says: the rest of the selection, as it now is.
  const remaining = {
    instanceIds: selection.instanceIds.filter((id) =>
      controller.document.instances.some((item) => item.id === id),
    ),
    routeIds: selection.routeIds.filter((id) =>
      controller.document.routes.some((item) => item.id === id),
    ),
    junctionIds: selection.junctionIds.filter((id) =>
      controller.document.junctions.some((item) => item.id === id),
    ),
  };
  const rest = await client.applyActions([
    { kind: "delete-selection", selection: remaining },
  ]);
  expect(rest.ok, rest.message).toBe(true);
  expect(controller.document.instances).toHaveLength(0);
  expect(controller.document.routes).toHaveLength(0);
});

it("names the command and what it expanded to when it exceeds the edit limit", async () => {
  const { client, controller, tool } = await folder();
  // One move edit per part: 72 parts take more than one transaction.
  const placements = Array.from({ length: 72 }, (_, i) => ({
    kind: "place-component",
    symbol: "resistor",
    reference: `R${i + 1}`,
    position: { x: (i % 9) * 100, y: Math.floor(i / 9) * 200 },
  }));
  for (let offset = 0; offset < placements.length; offset += 12) {
    const placed = await tool("circuit_place", {
      actions: placements.slice(offset, offset + 12),
    });
    expect(placed.ok, JSON.stringify(placed)).toBe(true);
  }
  const before = structuredClone(controller.document);
  const rejected = await client.applyActions([
    {
      kind: "transform",
      selection: {
        instanceIds: controller.document.instances.map((item) => item.id),
      },
      transform: { kind: "translate", delta: { x: 0, y: 2000 } },
    },
  ]);
  expect(rejected).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
  const limit = rejected.diagnostics?.[0]?.parameters as
    { expandedEdits: number; maxTransactionEdits: number } | undefined;
  expect(limit?.maxTransactionEdits).toBe(64);
  expect(limit?.expandedEdits).toBeGreaterThan(64);
  // The refusal names the action it refused (#1231).
  expect(rejected.message).toBe(
    `actions[0] (transform): transform expands to ${limit?.expandedEdits} edits, and one transaction takes at most 64. Act on fewer objects per call. Nothing was changed.`,
  );
  expect(controller.document).toEqual(before);
});

it("defaults a native VDD name and rejects unused or non-Port direction targets", async () => {
  const { controller } = await folder();
  const instance = {
    id: "vdd",
    symbolId: "vdd-port",
    placement: {
      position: { x: 100, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
  };
  const plan = planBrowserAgentCommand(
    controller.project,
    controller.document.id,
    controller.resolver,
    { kind: "place-components", instances: [instance] },
  );
  expect("structureEdits" in plan).toBe(true);
  if (!("structureEdits" in plan))
    throw new Error("Expected Cell interface edits");
  expect(plan.structureEdits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "transact_document",
        edits: expect.arrayContaining([
          expect.objectContaining({
            kind: "add_cell_terminal",
            terminal: expect.objectContaining({ name: "VDD" }),
          }),
        ]),
      }),
    ]),
  );
  for (const [id, symbolId] of [
    ["missing", "vdd-port"],
    ["vdd", "resistor"],
  ]) {
    expect(() =>
      planBrowserAgentCommand(
        controller.project,
        controller.document.id,
        controller.resolver,
        {
          kind: "place-components",
          instances: [{ ...instance, symbolId: symbolId! }],
          terminalDirections: { [id!]: "input" },
        },
      ),
    ).toThrow(/direction/i);
  }
});

it("atomically deletes mixed Instances and NoConnects through selection cleanup, without duplicate removal", async () => {
  const { client, controller, add } = await folder();
  const id = await add();
  expect(
    controller.transact([
      {
        kind: "add_no_connect",
        noConnect: {
          id: "nc",
          endpoint: { kind: "terminal", instanceId: id, pinName: "G" },
        },
      },
    ]).ok,
  ).toBe(true);
  const before = structuredClone(controller.document);
  const result = await client.applyActions([
    { kind: "delete", target: { kind: "instance", id } },
    { kind: "delete", target: { kind: "no-connect", id: "nc" } },
  ]);
  expect(result.ok, result.message).toBe(true);
  expect(controller.document.instances).toEqual([]);
  expect(controller.document.annotations).toEqual([]);
  expect(controller.document.noConnects).toEqual([]);
  expect(controller.document.revision).toBe(before.revision + 1);
  await client.applyActions([{ kind: "undo" }]);
  expect(controller.document.noConnects).toEqual(before.noConnects);
  expect(controller.document.annotations).toEqual(before.annotations);
  expect(
    (
      await client.applyActions([
        { kind: "delete", target: { kind: "no-connect", id: "nc" } },
      ])
    ).ok,
  ).toBe(true);
  expect(controller.document.instances).toHaveLength(1);
  expect(controller.document.noConnects).toEqual([]);
});

it("routes one Net through the existing authoring tool, preserves the service edit budget and never partially commits", async () => {
  const { client, controller, tool } = await folder();
  expect(
    (
      await client.applyActions(
        [0, 1, 2].map((i) => ({
          kind: "place-component",
          symbol: "resistor",
          reference: `R${i}`,
          position: { x: i * 100, y: 100 },
        })),
      )
    ).ok,
  ).toBe(true);
  const target = {
    kind: "pins",
    pins: controller.document.instances.map((instance) => ({
      instanceId: instance.id,
      pinName: "1",
    })),
  };
  const command = {
    kind: "route-net",
    target,
    trunk: { start: { x: -40, y: 0 }, end: { x: 260, y: 0 } },
  };
  const limited = createAgentCircuitService({
    agentId: "test",
    host: new BrowserAgentHost(controller),
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
    limits: { maxTransactionEdits: 3 },
  });
  const before = structuredClone(controller.project);
  expect(
    limited.handle({
      apiVersion: "3.0",
      requestId: "limited",
      operation: "transact",
      transactionId: "limited",
      documentId: controller.document.id,
      expectedRevision: controller.document.revision,
      command,
    }).ok,
  ).toBe(false);
  expect(controller.project).toEqual(before);
  const result = await tool("apply_actions", { actions: [command] });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(controller.document.revision).toBe(before.documents[0]!.revision + 1);
  expect(controller.document.nets).toHaveLength(1);
  const after = structuredClone(controller.document);
  expect((await tool("apply_actions", { actions: [command] })).ok).toBe(true);
  expect(controller.document.revision).toBe(after.revision);
  expect(controller.document.routes).toEqual(after.routes);
  expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
  expect(controller.document.routes).toEqual([]);
});

it("shares pin anchoring for hierarchical and retained Instances", async () => {
  const { client, controller, add } = await folder();
  const id = await add();
  expect(
    (await client.applyActions([{ kind: "unplace", instanceIds: [id] }])).ok,
  ).toBe(true);
  const placed = await client.applyActions([
    {
      kind: "place-existing",
      instanceId: id,
      placement: { position: { x: 0, y: 0 }, rotation: 90, mirror: "none" },
      pinAnchor: { pinName: "G", position: { x: 200, y: 200 } },
    },
  ]);
  expect(placed.ok, placed.message).toBe(true);
  expect(
    resolveEndpointConnection(controller.document, controller.resolver, {
      kind: "terminal",
      instanceId: id,
      pinName: "G",
    })?.gridLanding,
  ).toEqual({ x: 200, y: 200 });
  expect(
    (
      await client.applyActions([
        {
          kind: "place-component",
          symbol: "port",
          reference: "IN",
          position: { x: 0, y: 0 },
        },
      ])
    ).ok,
  ).toBe(true);
  expect(
    (
      await client.applyActions([
        { kind: "create-cell", id: "tb", name: "Testbench" },
      ])
    ).ok,
  ).toBe(true);
  const hierarchical = await client.applyActions(
    [
      {
        kind: "place-cell",
        childDocumentId: "main",
        instanceId: "xdut",
        reference: "XDUT",
        placement: {
          position: { x: 0, y: 0 },
          rotation: 0,
          mirror: "horizontal",
        },
        pinAnchor: { pinName: "IN", position: { x: 100, y: 100 } },
      },
    ],
    { documentId: "tb" },
  );
  expect(hierarchical.ok, hierarchical.message).toBe(true);
  const tb = controller.project.documents.find((item) => item.id === "tb")!;
  expect(
    resolveEndpointConnection(tb, controller.resolver, {
      kind: "terminal",
      instanceId: "xdut",
      pinName: "IN",
    })?.gridLanding,
  ).toEqual({ x: 100, y: 100 });
});

it("places matched devices by pin landing in one commit and preserves symmetry through shared transforms", async () => {
  const { client, controller } = await folder();
  const placed = await client.applyActions([
    {
      kind: "place-component",
      symbol: "nmos",
      reference: "M1",
      pinAnchor: { pinName: "G", position: { x: 100, y: 100 } },
    },
    {
      kind: "place-component",
      symbol: "nmos",
      reference: "M2",
      mirror: "horizontal",
      pinAnchor: { pinName: "G", position: { x: 300, y: 100 } },
    },
  ]);
  expect(placed.ok, placed.message).toBe(true);
  const [left, right] = controller.document.instances;
  expect(left!.placement!.position.x + right!.placement!.position.x).toBe(400);
  for (const [instance, x] of [
    [left!, 100],
    [right!, 300],
  ] as const) {
    expect(
      resolveEndpointConnection(controller.document, controller.resolver, {
        kind: "terminal",
        instanceId: instance.id,
        pinName: "G",
      })?.gridLanding,
    ).toEqual({ x, y: 100 });
  }
  const before = structuredClone(controller.document);
  const mirrored = await client.applyActions([
    {
      kind: "transform",
      selection: { instanceIds: [left!.id, right!.id] },
      transform: { kind: "mirror", axis: "y", center: { x: 200, y: 100 } },
    },
  ]);
  expect(mirrored.ok, mirrored.message).toBe(true);
  expect(controller.document.instances.map((item) => item.reference)).toEqual([
    "M1",
    "M2",
  ]);
  expect(controller.document.nets).toEqual(before.nets);
  expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
  expect(controller.document.annotations).toEqual(before.annotations);
  const rejected = await client.applyActions([
    {
      kind: "place-component",
      symbol: "resistor",
      reference: "R1",
      position: { x: 400, y: 100 },
    },
    {
      kind: "place-component",
      symbol: "resistor",
      reference: "R2",
      pinAnchor: { pinName: "missing", position: { x: 500, y: 100 } },
    },
  ]);
  expect(rejected).toMatchObject({ ok: false, actionIndex: 1 });
  expect(controller.document.instances).toEqual(before.instances);
});

it("uses Cell-Pin supply semantics and explicit directions, with reversible mode changes", async () => {
  const { client, controller } = await folder();
  const placed = await client.applyActions([
    {
      kind: "place-component",
      symbol: "vdd-port",
      position: { x: 100, y: 100 },
    },
    {
      kind: "place-component",
      symbol: "port",
      reference: "IN",
      direction: "input",
      position: { x: 200, y: 100 },
    },
  ]);
  expect(placed.ok, placed.message).toBe(true);
  const [supply, input] = controller.document.netlist!.terminals;
  expect(supply).toMatchObject({ name: "VDD", direction: "inout" });
  expect(input).toMatchObject({ name: "IN", direction: "input" });
  expect(controller.document.mosBulkDefaults?.pmosNetId).toBe(supply!.netId);
  expect(
    resolveDocumentLogicalNets(controller.document).byBaseNetId.get(
      supply!.netId,
    )?.scope,
  ).toBe("local");
  expect(
    controller.document.annotations.some(
      (a) =>
        a.kind === "power-label" && a.binding?.kind === "cell-terminal-name",
    ),
  ).toBe(true);
  const before = structuredClone(controller.project);
  const changed = await client.applyActions([
    {
      kind: "set-vdd-mode",
      instanceId: supply!.interfaceInstanceIds[0]!,
      mode: "global",
    },
    {
      kind: "set-port-direction",
      target: { kind: "port-name", name: "IN" },
      direction: "output",
    },
  ]);
  expect(changed.ok, changed.message).toBe(true);
  expect(
    controller.document.netlist!.terminals.map((t) => [t.name, t.direction]),
  ).toEqual([["IN", "output"]]);
  expect(
    resolveDocumentLogicalNets(controller.document).byBaseNetId.get(
      supply!.netId,
    )?.scope,
  ).toBe("global");
  expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
  expect(controller.document.netlist).toEqual(before.documents[0]!.netlist);
});

it("uses local supply rails by default, preserves explicit global and rejects diagonals atomically", async () => {
  const { client, controller } = await folder();
  for (const [name, scope, y] of [
    ["VDD", undefined, 100],
    ["AVDD", "global", 200],
  ] as const) {
    const report = await client.applyActions([
      {
        kind: "add-power-rail",
        name,
        ...(scope ? { scope } : {}),
        start: { x: 100, y },
        end: { x: 300, y },
      },
    ]);
    expect(report.ok, report.message).toBe(true);
    const net = [
      ...resolveDocumentLogicalNets(controller.document).byBaseNetId.values(),
    ].find((n) => n.name === name);
    expect(net?.scope).toBe(scope ?? "local");
  }
  const before = structuredClone(controller.project);
  const report = await client.applyActions([
    { kind: "add-power-rail", start: { x: 0, y: 0 }, end: { x: 100, y: 20 } },
  ]);
  expect(report.ok).toBe(false);
  expect(report.message).toContain("horizontal or vertical");
  expect(controller.project).toEqual(before);
});

it("extends a Power Rail instead of doubling it, keeping its taps and its one label", async () => {
  const { client, controller, tool } = await folder();
  const at = (x: number) => ({ x, y: 240 });
  expect(
    (
      await client.applyActions([
        { kind: "add-power-rail", start: at(300), end: at(460) },
      ])
    ).ok,
  ).toBe(true);
  // R1 taps the rail from below, at x = 380.
  expect(
    (
      await client.applyActions([
        {
          kind: "place-component",
          symbol: "resistor",
          reference: "R1",
          position: { x: 380, y: 320 },
        },
      ])
    ).ok,
  ).toBe(true);
  const railId = () =>
    controller.document.routes.find(
      (route) => route.presentation === "power-rail",
    )!.id;
  const tapped = await client.applyActions([
    {
      kind: "connect",
      from: { kind: "pin", instance: "R1", pin: "1" },
      to: { kind: "wire-at", point: at(380) },
    },
  ]);
  expect(tapped.ok, tapped.message).toBe(true);
  const span = () => {
    const component = derivePowerRailComponent(controller.document, railId())!;
    const position = (id: string) =>
      controller.document.junctions.find((junction) => junction.id === id)!
        .position;
    return {
      ends: component.endpointJunctionIds
        .map((id) => position(id).x)
        .sort((left, right) => left - right),
      taps: component.junctionIds
        .filter((id) => !component.endpointJunctionIds.includes(id))
        .map(position),
    };
  };
  expect(span()).toEqual({ ends: [300, 460], taps: [at(380)] });
  const labels = () =>
    controller.document.annotations.filter(
      (annotation) => annotation.kind === "power-label",
    );
  expect(labels()).toHaveLength(1);

  // Before: a second rail over the first, with a second V_DD label.
  const wider = await client.applyActions([
    { kind: "add-power-rail", start: at(190), end: at(560) },
  ]);
  expect(wider.ok, wider.message).toBe(true);
  expect(span()).toEqual({ ends: [190, 560], taps: [at(380)] });
  expect(labels()).toHaveLength(1);

  const extended = await tool("circuit_transform", {
    actions: [
      {
        kind: "extend-power-rail",
        routeId: railId(),
        start: at(100),
        end: at(560),
      },
    ],
  });
  expect(extended.ok, extended.message).toBe(true);
  expect(span()).toEqual({ ends: [100, 560], taps: [at(380)] });

  const shrunk = await client.applyActions([
    {
      kind: "extend-power-rail",
      routeId: railId(),
      start: at(400),
      end: at(560),
    },
  ]);
  expect(shrunk.ok).toBe(false);
  expect(shrunk.message).toContain("would fall off the rail");
  expect(span()).toEqual({ ends: [100, 560], taps: [at(380)] });
});

it("batches different display preferences once without advancing structure revision; errors locate the source action", async () => {
  const { client, controller } = await folder();
  await client.applyActions(
    ["R1", "R2"].map((reference, i) => ({
      kind: "place-component",
      symbol: "resistor",
      reference,
      position: { x: 100 + i * 100, y: 100 },
    })),
  );
  const [first, second] = controller.document.instances;
  const before = structuredClone(controller.project);
  const changed = await client.applyActions([
    {
      kind: "set-instance-display",
      instanceIds: [first!.id],
      showReference: false,
    },
    {
      kind: "set-instance-display",
      instanceIds: [second!.id],
      showValue: false,
    },
  ]);
  expect(changed.ok, changed.message).toBe(true);
  expect(controller.project.structureRevision).toBe(before.structureRevision);
  expect(controller.document.revision).toBe(before.documents[0]!.revision + 1);
  await client.applyActions([{ kind: "undo" }]);
  expect(controller.document.annotations).toEqual(
    before.documents[0]!.annotations,
  );
  const failed = await client.applyActions([
    {
      kind: "set-instance-display",
      instanceIds: [first!.id],
      showReference: false,
    },
    {
      kind: "set-port-direction",
      target: { kind: "port-name", name: "missing" },
      direction: "input",
    },
  ]);
  expect(failed).toMatchObject({ ok: false, actionIndex: 1 });
  expect(controller.document.annotations).toEqual(
    before.documents[0]!.annotations,
  );
});

async function folder(
  project = createEmptyProject("project-1", "Parity"),
  planning: BrowserAgentPlanningContext = {},
) {
  project.documents[0]!.id = "main";
  project.topDocumentId = "main";
  const controller = new EditorDocumentController(project);
  const service = createAgentCircuitService({
    agentId: "test",
    host: new BrowserAgentHost(
      controller,
      undefined,
      undefined,
      undefined,
      planning,
    ),
    permissions: {
      snapshot: true,
      render: true,
      sourceSpans: false,
      semanticControl: false,
      edit: { geometry: true, connectivity: true, presentation: true },
    },
  });
  const http = new FakeAgentHttp();
  http.circuitHandler = async ({ request }) => service.handle(request);
  const client = new AgentSessionClient({ http });
  await client.connect("session-1.code");
  const session: ToolSessionState = { client };
  async function tool(name: string, args: unknown) {
    const result = await callTool(name, args, session);
    const content = result.content[0];
    if (content?.type !== "text")
      throw new Error("Expected a structured receipt");
    return JSON.parse(content.text!);
  }
  async function add() {
    const result = await client.applyActions([
      {
        kind: "place-component",
        symbol: "nmos",
        reference: "M1",
        position: { x: 100, y: 100 },
      },
    ]);
    expect(result.ok, result.message).toBe(true);
    return controller.document.instances[0]!.id;
  }
  return { controller, client, tool, add, http };
}

describe("MCP → API → shared editor parity", () => {
  it("deletes connected instances and their owned labels like GUI selection, and clears a Cell in one undo", async () => {
    const { client, controller } = await folder();
    await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        position: { x: 100, y: 100 },
      },
      {
        kind: "place-component",
        symbol: "port",
        reference: "IN",
        position: { x: 200, y: 100 },
      },
    ]);
    const terminal = controller.document.netlist!.terminals[0]!;
    expect(
      (
        await client.applyActions([
          {
            kind: "connect",
            from: { kind: "pin", instance: "R1", pin: "2" },
            to: {
              kind: "pin",
              instance: {
                kind: "instance",
                id: terminal.interfaceInstanceIds[0]!,
              },
              pin: "P",
            },
          },
        ])
      ).ok,
    ).toBe(true);
    const before = structuredClone(controller.document);
    const removed = await client.applyActions([
      { kind: "delete", target: { kind: "instance", reference: "R1" } },
    ]);
    expect(removed.ok, removed.message).toBe(true);
    expect(
      controller.document.instances.some((i) => i.reference === "R1"),
    ).toBe(false);
    // The wire runs on to the Port's pin, so it stays with an open end where
    // R1 was, as in the GUI: a replacement set down there reconnects.
    expect(controller.document.routes).toHaveLength(before.routes.length);
    expect(
      controller.document.annotations.some(
        (a) =>
          a.anchor.kind === "object" &&
          a.anchor.objectId === before.instances[0]!.id,
      ),
    ).toBe(false);
    await client.applyActions([{ kind: "undo" }]);
    expect(controller.document.instances).toEqual(before.instances);
    const cleared = await client.applyActions([
      {
        kind: "delete-selection",
        selection: {
          instanceIds: controller.document.instances.map((i) => i.id),
          routeIds: controller.document.routes.map((i) => i.id),
          junctionIds: controller.document.junctions.map((i) => i.id),
          annotationIds: controller.document.annotations.map((i) => i.id),
        },
      },
    ]);
    expect(cleared.ok, cleared.message).toBe(true);
    expect(controller.document.instances).toEqual([]);
    expect(controller.document.netlist!.terminals).toEqual([]);
    expect(controller.document.routes).toEqual([]);
    await client.applyActions([{ kind: "undo" }]);
    expect(controller.document.instances).toEqual(before.instances);
    expect(controller.document.netlist).toEqual(before.netlist);
  });
  it("retains the action location for off-grid placement in a Project transaction", async () => {
    const { client, controller } = await folder();
    const before = structuredClone(controller.project);
    const report = await client.applyActions([
      {
        kind: "place-component",
        symbol: "port",
        reference: "IN",
        position: { x: 100, y: 100 },
      },
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        position: { x: 155, y: 100 },
      },
    ]);
    expect(report).toMatchObject({
      ok: false,
      actionIndex: 1,
      actionKind: "place-component",
    });
    expect(
      report.diagnostics?.some((d) => d.parameters?.instanceIndex === 1),
    ).toBe(true);
    expect(controller.project).toEqual(before);
  });
  it("reports the input action behind a rejected placement edit", async () => {
    const { client, controller } = await folder();
    const before = structuredClone(controller.document);
    const report = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        position: { x: 100, y: 100 },
      },
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R2",
        position: { x: 155, y: 100 },
      },
    ]);
    expect(report.ok).toBe(false);
    expect(report.actionIndex).toBe(1);
    expect(report.actionKind).toBe("place-component");
    expect(report.message).toContain("actions[1]");
    expect(report.diagnostics?.[0]).toMatchObject({
      path: ["edits", 2, "instance", "placement", "position", "x"],
      parameters: { instanceIndex: 1 },
    });
    expect(controller.document).toEqual(before);
  });
  it("moves attached annotations through both entry points without moving their owner", async () => {
    const { client, controller, add } = await folder();
    const instanceId = await add();
    const original = controller.document.annotations.find(
      (a) => a.anchor.kind === "object" && a.anchor.objectId === instanceId,
    )!;
    const before = structuredClone(controller.document.instances);
    const moved = await client.applyActions([
      {
        kind: "move",
        target: { kind: "annotation", id: original.id },
        position: { x: 153, y: 47 },
      },
    ]);
    expect(moved.ok, moved.message).toBe(true);
    expect(
      controller.document.annotations.find((a) => a.id === original.id)?.anchor,
    ).toMatchObject({
      kind: "object",
      objectId: instanceId,
      localOffset: { x: 53, y: -53 },
    });
    const translated = await client.applyActions([
      {
        kind: "transform",
        selection: { annotationIds: [original.id] },
        transform: { kind: "translate", delta: { x: 10, y: -10 } },
      },
    ]);
    expect(translated.ok, translated.message).toBe(true);
    expect(
      controller.document.annotations.find((a) => a.id === original.id)?.anchor,
    ).toMatchObject({ localOffset: { x: 63, y: -63 } });
    expect(controller.document.instances).toEqual(before);
    const unsupported = await client.applyActions([
      {
        kind: "transform",
        selection: { annotationIds: [original.id] },
        transform: { kind: "rotate", degrees: 90 },
      },
    ]);
    expect(unsupported.ok).toBe(false);
    expect(unsupported.message).toContain("translation");
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(
      controller.document.annotations.find((a) => a.id === original.id)?.anchor,
    ).toMatchObject({ localOffset: { x: 53, y: -53 } });
  });

  it("batches labels atomically and undoes them together", async () => {
    const { client, controller, add, http } = await folder();
    await add();
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "nmos",
        reference: "M2",
        position: { x: 300, y: 100 },
      },
    ]);
    expect(placed.ok).toBe(true);
    expect(
      (
        await client.applyActions(
          [0, 100].map((y) => ({
            kind: "connect",
            from: { kind: "point", x: 500, y },
            to: { kind: "point", x: 580, y },
          })),
        )
      ).ok,
    ).toBe(true);
    const nets = controller.document.routes.map((route) => ({
      id: route.netId,
    }));
    const before = structuredClone(controller.document);
    const actions = nets.slice(0, 2).map((net, index) => ({
      kind: "add-label",
      target: { kind: "net", id: net.id },
      text: `LABEL${index}`,
      position: { x: 100 + index * 200, y: 30 },
    }));
    expect(actions).toHaveLength(2);
    const previewProject = structuredClone(controller.project);
    const preview = await client.applyActions(actions, { dryRunOnly: true });
    expect(preview.ok, preview.message).toBe(true);
    expect(controller.project).toEqual(previewProject);
    const callsBefore = http.circuitCalls.length;
    const labelled = await client.applyActions(actions);
    expect(labelled.ok, labelled.message).toBe(true);
    expect(
      http.circuitCalls
        .slice(callsBefore)
        .filter((call) => call.request.operation === "transact"),
    ).toHaveLength(1);
    expect(
      controller.document.annotations.filter((a) => a.kind === "net-label"),
    ).toHaveLength(2);
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.annotations).toEqual(before.annotations);
    expect((await client.applyActions([{ kind: "redo" }])).ok).toBe(true);
    expect(
      controller.document.annotations.filter((a) => a.kind === "net-label"),
    ).toHaveLength(2);
    const checkpoint = structuredClone(controller.project);
    const failed = await client.applyActions([
      {
        kind: "set-net-label",
        annotationId: "batch-first",
        netId: nets[0]!.id,
        text: { runs: [{ kind: "text", value: "LABEL0" }] },
        position: { x: 0, y: 0 },
      },
      {
        kind: "set-net-label",
        annotationId: "batch-bad",
        netId: "missing-net",
        text: { runs: [{ kind: "text", value: "BAD" }] },
        position: { x: 0, y: 0 },
      },
    ]);
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain("Net not found");
    expect(controller.project).toEqual(checkpoint);
    const label = controller.document.annotations.find(
      (a) => a.kind === "net-label",
    )!;
    const routes = structuredClone(controller.document.routes);
    const moved = await client.applyActions([
      {
        kind: "move",
        target: { kind: "annotation", id: label.id },
        position: { x: 403, y: 73 },
      },
    ]);
    expect(moved.ok, moved.message).toBe(true);
    expect(
      controller.document.annotations.find((a) => a.id === label.id),
    ).toMatchObject({
      netId: label.netId,
      anchor: { kind: "free", position: { x: 403, y: 73 } },
    });
    expect(controller.document.routes).toEqual(routes);
    const translated = await client.applyActions([
      {
        kind: "transform",
        selection: { annotationIds: [label.id] },
        transform: { kind: "translate", delta: { x: 3, y: 7 } },
      },
    ]);
    expect(translated.ok, translated.message).toBe(true);
    expect(
      controller.document.annotations.find((a) => a.id === label.id)?.anchor,
    ).toEqual({ kind: "free", position: { x: 406, y: 80 } });
  });

  it("batches reviewed model selection against accumulated definitions with one undo", async () => {
    const { client, controller, add } = await folder();
    const m1 = await add();
    expect(
      (
        await client.applyActions([
          {
            kind: "place-component",
            symbol: "nmos",
            reference: "M2",
            position: { x: 300, y: 100 },
          },
        ])
      ).ok,
    ).toBe(true);
    const m2 = controller.document.instances.find(
      (i) => i.reference === "M2",
    )!.id;
    const actions = [m1, m2].map((instanceId) => ({
      kind: "set-model",
      instanceId,
      model: "sky130_fd_pr__nfet_01v8",
    }));
    const before = structuredClone(controller.project);
    const result = await client.applyActions(actions);
    expect(result.ok, result.message).toBe(true);
    expect(controller.project.externalSubcircuitDefinitions).toHaveLength(1);
    expect(
      controller.document.instances.every(
        (i) => i.netlist?.binding?.kind === "external-subcircuit",
      ),
    ).toBe(true);
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.instances).toEqual(
      before.documents[0]!.instances,
    );
    expect(controller.project.externalSubcircuitDefinitions).toEqual(
      before.externalSubcircuitDefinitions,
    );
  });
  it("places both Port styles with owned Cell terminals in one undoable batch", async () => {
    const { client, controller, tool } = await folder();
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "port",
        reference: "VIN",
        position: { x: 100, y: 100 },
      },
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        position: { x: 200, y: 100 },
        rotation: 270,
        parameters: { value: "1k" },
      },
      {
        kind: "place-component",
        symbol: "port-filled",
        reference: "VOUT",
        position: { x: 300, y: 100 },
        rotation: 180,
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    expect(controller.document.revision).toBe(1);
    expect(controller.document.instances).toHaveLength(3);
    const terminals = controller.document.netlist!.terminals;
    expect(terminals.map((terminal) => terminal.name)).toEqual(["VIN", "VOUT"]);
    for (const terminal of terminals) {
      expect(terminal.direction).toBe("passive");
      expect(terminal.interfaceInstanceIds).toHaveLength(1);
      const instanceId = terminal.interfaceInstanceIds[0]!;
      const port = controller.document.instances.find(
        (i) => i.id === instanceId,
      )!;
      expect(port.reference).toBeUndefined();
      expect(port.netlist).toBeUndefined();
      expect(
        controller.document.nets.find((n) => n.id === terminal.netId)
          ?.terminals,
      ).toEqual([{ instanceId, pinName: "P" }]);
      expect(
        controller.document.annotations.filter(
          (a) => a.anchor.kind === "object" && a.anchor.objectId === instanceId,
        ),
      ).toEqual([
        expect.objectContaining({
          binding: { kind: "cell-terminal-name", terminalId: terminal.id },
        }),
      ]);
    }
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.document.instances).toHaveLength(0);
    expect(controller.document.netlist!.terminals).toHaveLength(0);
    expect(controller.document.nets).toHaveLength(0);
    expect((await client.applyActions([{ kind: "redo" }])).ok).toBe(true);
    const snapshot = await tool("inspect", {
      target: { kind: "document" },
      detail: "full",
    });
    expect(
      snapshot.cellInterface.terminals.map((t: { name: string }) => t.name),
    ).toEqual(["VIN", "VOUT"]);
    const wired = await client.applyActions([
      {
        kind: "connect",
        from: {
          kind: "pin",
          instance: {
            kind: "instance",
            id: terminals[0]!.interfaceInstanceIds[0]!,
          },
          pin: "P",
        },
        to: { kind: "pin", instance: "R1", pin: "1" },
      },
    ]);
    expect(wired.ok, wired.message).toBe(true);
    expect(
      controller.document.nets.find((n) => n.id === terminals[0]!.netId)
        ?.terminals,
    ).toHaveLength(2);
  });

  it("restyles bound Port and Value labels without changing their electrical facts", async () => {
    const { client, controller } = await folder();
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "port",
        reference: "VIN",
        position: { x: 100, y: 100 },
      },
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "R1",
        position: { x: 200, y: 100 },
        parameters: { value: "1k" },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    const pin = controller.document.annotations.find(
      (annotation) => annotation.binding?.kind === "cell-terminal-name",
    )!;
    const resistor = controller.document.instances.find(
      (i) => i.reference === "R1",
    )!;
    const value = controller.document.annotations.find(
      (annotation) =>
        annotation.binding?.kind === "instance-value" &&
        annotation.binding.instanceId === resistor.id,
    )!;
    for (const [id, head, tail] of [
      [pin.id, "V", "IN"],
      [value.id, "1", "k"],
    ]) {
      const look = {
        runs: [
          { kind: "text" as const, value: head },
          {
            kind: "span" as const,
            style: "subscript" as const,
            children: [{ kind: "text" as const, value: tail }],
          },
        ],
      };
      const report = await client.applyActions([
        { kind: "edit-text", target: { kind: "annotation", id }, text: look },
      ]);
      expect(report.ok, report.message).toBe(true);
      expect(
        controller.document.annotations.find((a) => a.id === id)
          ?.formatOverride,
      ).toEqual(look);
    }
    expect(controller.document.netlist!.terminals[0]!.name).toBe("VIN");
    expect(
      controller.document.instances.find((i) => i.id === resistor.id)?.netlist
        ?.parameters.value,
    ).toBe("1k");
  });

  it("controls schema-54 magnetic labels independently and preserves authored state", async () => {
    const { client, controller } = await folder();
    // Both are subcircuit calls, so their names take the X prefix.
    for (const [symbol, reference, parameters] of [
      ["xfmr", "X1", { k: "0.8", lp: "2n", ls: "4n" }],
      ["tcoil", "X2", { k: "0.7", l1: "3n", l2: "5n", cb: "1p" }],
    ] as const) {
      expect(
        (
          await client.applyActions([
            {
              kind: "place-component",
              symbol,
              reference,
              parameters,
              position: { x: 100, y: 100 },
            },
          ])
        ).ok,
      ).toBe(true);
      const id = controller.document.instances.find(
        (i) => i.reference === reference,
      )!.id;
      const display = async (
        showParameters: Record<string, boolean>,
        showValue?: boolean,
      ) =>
        client.applyActions([
          {
            kind: "set-instance-display",
            instanceIds: [id],
            showParameters,
            ...(showValue === undefined ? {} : { showValue }),
          },
        ]);
      const labels = () =>
        controller.document.annotations.filter(
          (a) =>
            a.binding?.kind === "instance-value" &&
            a.binding.instanceId === id &&
            a.binding.parameter,
        );
      const desired = Object.fromEntries(
        Object.keys(parameters).map((key) => [key, true]),
      );
      expect((await display(desired)).ok).toBe(true);
      expect(labels()).toHaveLength(Object.keys(parameters).length);
      const original = structuredClone(labels());
      expect((await display(desired)).ok).toBe(true);
      expect(labels()).toEqual(original);
      // Aggregate Value must not hide the first named parameter by fallback.
      expect((await display({}, false)).ok).toBe(true);
      expect(labels()).toEqual(original);
      const k = labels().find(
        (a) =>
          a.binding?.kind === "instance-value" && a.binding.parameter === "k",
      )!;
      const authored = {
        ...k,
        anchor: { kind: "free" as const, position: { x: 321, y: 123 } },
        textColor: "#123456",
      };
      expect(
        (
          await client.advancedTransact({
            edits: [
              { kind: "upsert_schematic_annotation", annotation: authored },
            ],
          })
        ).ok,
      ).toBe(true);
      expect((await display({ k: false })).ok).toBe(true);
      expect(labels().find((a) => a.id === k.id)).toEqual({
        ...authored,
        visible: false,
      });
      await client.snapshot("main", { refresh: true });
      expect((await display({ k: true })).ok).toBe(true);
      expect(labels().find((a) => a.id === k.id)).toEqual({
        ...authored,
        visible: true,
      });
      const before = structuredClone(controller.project);
      expect((await display({ unsupported: true })).ok).toBe(false);
      expect(
        (await display({ [symbol === "xfmr" ? "cb" : "lp"]: true })).ok,
      ).toBe(false);
      expect(controller.project).toEqual(before);
    }
    const beforeBatch = structuredClone(controller.project);
    const ids = controller.document.instances.map((instance) => instance.id);
    expect(
      (
        await client.applyActions([
          {
            kind: "set-instance-display",
            instanceIds: ids,
            showReference: false,
            showParameters: { lp: true },
          },
        ])
      ).ok,
    ).toBe(false);
    expect(controller.project).toEqual(beforeBatch);
  });
  it("places native bound displays and electrical ground, with idempotent visibility", async () => {
    const { client, controller } = await folder();
    expect(
      (
        await client.applyActions([
          {
            kind: "place-component",
            symbol: "resistor",
            reference: "R1",
            position: { x: 100, y: 100 },
            parameters: { value: "100" },
          },
          {
            kind: "place-component",
            symbol: "ground",
            position: { x: 100, y: 200 },
          },
        ])
      ).ok,
    ).toBe(true);
    const id = controller.document.instances.find(
      (i) => i.reference === "R1",
    )!.id;
    const labels = () =>
      controller.document.annotations.filter(
        (a) => a.anchor.kind === "object" && a.anchor.objectId === id,
      );
    expect(
      labels()
        .map((a) => a.binding?.kind)
        .sort(),
    ).toEqual(["instance-reference", "instance-value"]);
    expect(
      controller.document.connectivityEvidence.some(
        (e) =>
          e.kind === "name-claim" &&
          e.powerDomain === "ground" &&
          e.name === "0",
      ),
    ).toBe(true);
    for (const visible of [false, true, true]) {
      expect(
        (
          await client.applyActions([
            {
              kind: "set-instance-display",
              instanceIds: [id],
              showReference: visible,
              showValue: visible,
            },
          ])
        ).ok,
      ).toBe(true);
      expect(labels()).toHaveLength(2);
      expect(labels().every((a) => (a.visible !== false) === visible)).toBe(
        true,
      );
    }
    expect(
      (
        await client.applyActions([
          {
            kind: "move",
            target: { kind: "instance", id },
            position: { x: 150, y: 100 },
          },
        ])
      ).ok,
    ).toBe(true);
    expect(labels().every((a) => a.anchor.kind === "object")).toBe(true);
  });
  it("names placed parts as the GUI does and refuses a name that would block the netlist", async () => {
    const { client, controller } = await folder();
    expect(
      (
        await client.applyActions([
          { kind: "create-cell", id: "tb", name: "Testbench" },
        ])
      ).ok,
    ).toBe(true);
    const placeCell = (instanceId: string, reference?: string) =>
      client.applyActions(
        [
          {
            kind: "place-cell",
            childDocumentId: "main",
            instanceId,
            ...(reference ? { reference } : {}),
            placement: {
              position: { x: 100, y: 100 },
              rotation: 0,
              mirror: "none",
            },
          },
        ],
        { documentId: "tb" },
      );
    const tb = () =>
      controller.project.documents.find((d) => d.id === "tb")!.instances;

    // Before, I1 was accepted and the netlist was blocked afterwards.
    const wrong = await placeCell("inv-i1", "I1");
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toContain(
      // The fix names the alias that still draws the name asked for (#1254).
      "Cell instances use the X prefix, so I1 would block the netlist; X1 is free, and set-display-alias draws it as I1. Nothing was placed.",
    );
    expect(tb()).toHaveLength(0);

    // Before, a missing name became the Instance ID, which blocks it too.
    const unnamed = await placeCell("inv-a");
    expect(unnamed.ok, unnamed.message).toBe(true);
    expect(tb().map((instance) => instance.reference)).toEqual(["X1"]);

    const taken = await placeCell("inv-b", "x1");
    expect(taken.ok).toBe(false);
    expect(taken.message).toContain("x1 already names inv-a; X2 is free.");

    const device = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        reference: "C1",
        position: { x: 0, y: 0 },
      },
    ]);
    expect(device.ok).toBe(false);
    expect(device.message).toContain(
      "resistor parts use the R prefix, so C1 would block the netlist; R1 is free, and set-display-alias draws it as C1.",
    );
  });

  it("places the original top in a new TB through public actions and retains normal history", async () => {
    const { client, controller } = await folder();
    expect(
      (
        await client.applyActions([
          { kind: "create-cell", id: "tb", name: "Testbench" },
        ])
      ).ok,
    ).toBe(true);
    const placed = await client.applyActions(
      [
        {
          kind: "place-cell",
          childDocumentId: "main",
          instanceId: "xdut",
          reference: "XDUT",
          placement: {
            position: { x: 100, y: 100 },
            rotation: 0,
            mirror: "none",
          },
        },
      ],
      { documentId: "tb" },
    );
    expect(placed.ok, placed.message).toBe(true);
    expect(controller.project.topDocumentId).toBe("main");
    expect(controller.project.simulationFolders).toEqual([]);
    const instance = controller.project.documents.find((d) => d.id === "tb")!
      .instances[0]!;
    expect(instance.netlist?.binding).toEqual({
      kind: "subcircuit",
      childDocumentId: "main",
    });
    const testbench = controller.project.documents.find((d) => d.id === "tb")!;
    expect(
      testbench.annotations.some(
        (annotation) => annotation.binding?.kind === "instance-reference",
      ),
    ).toBe(false);
    expect(
      flattenRichText(
        testbench.annotations.find(
          (annotation) => annotation.id === "instance-master-xdut",
        )!.content!,
      ),
    ).toBe("dut");
    expect(controller.resolver.resolve(instance.symbolId)).toBeTruthy();
    expect(
      (await client.applyActions([{ kind: "undo" }], { documentId: "tb" })).ok,
    ).toBe(true);
    expect(
      controller.project.documents.find((d) => d.id === "tb")!.instances,
    ).toHaveLength(0);
    expect(
      (await client.applyActions([{ kind: "redo" }], { documentId: "tb" })).ok,
    ).toBe(true);
    const bad = await client.applyActions(
      [
        {
          kind: "place-cell",
          childDocumentId: "tb",
          instanceId: "loop",
          placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        },
      ],
      { documentId: "main" },
    );
    expect(bad.ok).toBe(false);
    expect(
      controller.project.documents.find((d) => d.id === "main")!.instances,
    ).toHaveLength(0);
    expect(
      (
        await client.applyActions([
          { kind: "rename-cell", id: "tb", name: "TB recovered" },
        ])
      ).ok,
    ).toBe(true);
  });
  it("places a retained Instance with the GUI's missing default labels", async () => {
    const { client, controller, add } = await folder();
    const id = await add();
    expect(
      (await client.applyActions([{ kind: "unplace", instanceIds: [id] }])).ok,
    ).toBe(true);
    const placed = await client.applyActions([
      {
        kind: "move",
        target: { kind: "instance", id },
        position: { x: 200, y: 200 },
      },
    ]);
    expect(placed.ok, placed.message).toBe(true);
    expect(
      controller.document.annotations.some(
        (item) =>
          item.binding?.kind === "instance-reference" &&
          item.binding.instanceId === id,
      ),
    ).toBe(true);
  });
  it("names, renames and deletes an actual Net label through the shared name-claim planner", async () => {
    const { client, controller, tool } = await folder();
    expect(
      (
        await client.applyActions([
          {
            kind: "connect",
            from: { kind: "point", x: 0, y: 0 },
            to: { kind: "point", x: 80, y: 0 },
          },
        ])
      ).ok,
    ).toBe(true);
    const netId = controller.document.routes[0]!.netId;
    const label = await client.applyActions([
      {
        kind: "add-label",
        target: { kind: "net", id: netId },
        text: "test_bus",
        position: { x: 40, y: -20 },
      },
    ]);
    expect(label.ok, label.message).toBe(true);
    expect(controller.document.annotations[0]!.anchor).toMatchObject({
      kind: "route",
      routeId: controller.document.routes[0]!.id,
    });
    const annotationId = controller.document.annotations[0]!.id;
    expect(controller.document.connectivityEvidence).toContainEqual(
      expect.objectContaining({
        kind: "name-claim",
        name: "test_bus",
        owner: { kind: "net-label", annotationId },
      }),
    );
    expect(
      (
        await tool("inspect", {
          target: { kind: "net", id: netId },
          refresh: true,
        })
      ).name,
    ).toBe("test_bus");
    const rename = await client.applyActions([
      {
        kind: "edit-text",
        target: { kind: "annotation", id: annotationId },
        text: "renamed_bus",
      },
    ]);
    expect(rename.ok, rename.message).toBe(true);
    expect(
      (
        await tool("inspect", {
          target: { kind: "net", id: netId },
          refresh: true,
        })
      ).name,
    ).toBe("renamed_bus");
    expect(
      (
        await client.applyActions([
          { kind: "delete", target: { kind: "annotation", id: annotationId } },
        ])
      ).ok,
    ).toBe(true);
    expect(
      controller.document.connectivityEvidence.filter(
        (item) => item.kind === "name-claim",
      ),
    ).toHaveLength(0);
    expect(
      (
        await tool("inspect", {
          target: { kind: "net", id: netId },
          refresh: true,
        })
      ).name,
    ).toBeNull();
  });
  it("places an unnamed power marker and reports Reference-only changes", async () => {
    const { client, controller, add } = await folder();
    const id = await add();
    const rename = await client.applyActions([
      {
        kind: "set-reference",
        target: { kind: "instance", id },
        reference: "M9",
      },
    ]);
    expect(rename.ok, rename.message).toBe(true);
    expect(rename.changedObjectIds).toContain(id);
    const ground = await client.applyActions([
      {
        kind: "place-component",
        symbol: "ground",
        position: { x: 300, y: 300 },
      },
    ]);
    expect(ground.ok, ground.message).toBe(true);
    expect(
      controller.document.instances.find(
        (instance) => instance.symbolId === "ground",
      )?.reference,
    ).toBeUndefined();
  });
  it("routes free wires and reads the shared Net trace without local inference", async () => {
    const { client, controller, tool } = await folder();
    const result = await client.applyActions([
      {
        kind: "connect",
        from: { kind: "point", x: 10, y: 20 },
        to: { kind: "point", x: 70, y: 50 },
        routingMode: "free",
      },
    ]);
    expect(result.ok, result.message).toBe(true);
    const route = controller.document.routes[0]!;
    expect(route.legs).toHaveLength(1); // The free diagonal has no generated orthogonal bend.
    const traced = await tool("inspect", {
      target: { kind: "trace", netId: route.netId },
    });
    expect(traced.trace.highlights[0].routes).toContain(route.id);
  });
  it("reads colors and formula data back and reports their authoritative object IDs", async () => {
    const { add, client, tool } = await folder();
    const id = await add();
    const result = await client.advancedTransact([
      {
        kind: "set_instance_style_override",
        instanceId: id,
        styleOverride: { foreground: "#ff0000" },
      },
    ]);
    expect(result.ok, result.message).toBe(true);
    expect(result.changedObjectIds).toContain(id);
    const instance = await tool("inspect", { target: { kind: "object", id } });
    expect(instance.styleOverride.foreground).toBe("#ff0000");
    const formula = {
      runs: [{ kind: "math", latex: "\\frac{g_m}{C}", display: "inline" }],
    };
    expect(
      (
        await client.applyActions([
          { kind: "annotate", text: formula, position: { x: 200, y: 200 } },
        ])
      ).ok,
    ).toBe(true);
    const search = await tool("search", { query: "g_m" });
    expect(search.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "drafting",
          name: "\\frac{g_m}{C}",
          documentId: "main",
        }),
      ]),
    );
    expect(
      (await tool("inspect", { target: { kind: "activity" } })).transactions
        .length,
    ).toBe(3);
  });

  it("plans Model switching with the GUI planner and exposes its definition", async () => {
    const { add, client, controller } = await folder();
    const instanceId = await add();
    const result = await client.applyActions([
      { kind: "set-model", instanceId, model: "sky130_fd_pr__nfet_01v8" },
    ]);
    expect(result.ok, result.message).toBe(true);
    expect(controller.document.instances[0]!.netlist!.binding?.kind).toBe(
      "external-subcircuit",
    );
    expect(result.projectStructure).toBeDefined();
    const entry = await client.refreshSnapshot();
    expect(
      entry.snapshot.project.externalSubcircuitDefinitions?.[0]?.name,
    ).toBe("sky130_fd_pr__nfet_01v8");
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(controller.project.externalSubcircuitDefinitions).toHaveLength(0);
    expect((await client.applyActions([{ kind: "redo" }])).ok).toBe(true);
    expect(controller.project.externalSubcircuitDefinitions).toHaveLength(1);
  });

  it("copies, transforms, returns to tray, and undoes through shared history", async () => {
    const { add, client, controller } = await folder();
    const id = await add();
    const copied = await client.applyActions([
      {
        kind: "copy",
        selection: { instanceIds: [id] },
        offset: { x: 100, y: 0 },
      },
    ]);
    expect(copied.ok, copied.message).toBe(true);
    expect(controller.document.instances).toHaveLength(2);
    const ids = controller.document.instances.map((item) => item.id);
    const turned = await client.applyActions([
      {
        kind: "transform",
        selection: { instanceIds: ids },
        transform: { kind: "rotate", degrees: 90 },
      },
    ]);
    expect(turned.ok, turned.message).toBe(true);
    expect(controller.document.instances[0]!.placement!.position.x).toBe(
      controller.document.instances[1]!.placement!.position.x,
    );
    expect(
      (await client.applyActions([{ kind: "unplace", instanceIds: ids }])).ok,
    ).toBe(true);
    expect(
      controller.document.instances.every((item) => item.placement === null),
    ).toBe(true);
    const revision = controller.document.revision;
    expect(
      (await client.advancedTransact([{ kind: "undo" }], { dryRun: true }))
        .applied,
    ).toBe(false);
    expect(controller.document.revision).toBe(revision);
    expect((await client.applyActions([{ kind: "undo" }])).ok).toBe(true);
    expect(
      controller.document.instances.every((item) => item.placement !== null),
    ).toBe(true);
    expect((await client.applyActions([{ kind: "redo" }])).ok).toBe(true);
    expect(
      controller.document.instances.every((item) => item.placement === null),
    ).toBe(true);
  });

  it("accepts project structure edits from MCP without manual revision bookkeeping", async () => {
    const { client, tool, controller } = await folder();
    const created = await client.applyActions([
      { kind: "create-cell", id: "child", name: "Amplifier" },
    ]);
    expect(created.ok, created.message).toBe(true);
    const renamed = await tool("advanced_transact", {
      structureEdits: [
        { kind: "rename_document", documentId: "child", name: "Stage" },
      ],
    });
    expect(renamed.ok, renamed.message).toBe(true);
    expect(
      controller.project.documents.find((item) => item.id === "child")?.name,
    ).toBe("Stage");
    const overview = await tool("inspect", {
      target: { kind: "document" },
      detail: "full",
    });
    expect(overview.project.documents).toHaveLength(2);
    expect(overview.routes).toEqual([]);
    const deleted = await client.applyActions(
      [{ kind: "delete-cell", id: "child" }],
      { documentId: "child" },
    );
    expect(deleted.ok, deleted.message).toBe(true);
    expect((await client.status()).documentIds).toEqual(["main"]);
    expect((await client.refreshSnapshot()).documentId).toBe("main");
  });
});

describe("Agent placement and naming the GUI way (#1254, #1256)", () => {
  it("names unnamed parts, places a formula block, and draws an op-amp X1 as A1", async () => {
    const { client, controller } = await folder();
    const main = () =>
      controller.project.documents.find((d) => d.id === "main")!;
    const placed = await client.applyActions([
      {
        kind: "place-component",
        symbol: "resistor",
        position: { x: 100, y: 100 },
      },
      {
        kind: "place-component",
        symbol: "opamp",
        position: { x: 300, y: 100 },
      },
      {
        kind: "place-component",
        symbol: "integrator",
        position: { x: 500, y: 100 },
        signalFlow: { formula: "1/(1-z^-1)" },
      },
    ]);
    expect(placed.ok).toBe(true);
    const resistor = main().instances.find((i) => i.symbolId === "resistor")!;
    const amp = main().instances.find((i) => i.symbolId === "opamp")!;
    const block = main().instances.find((i) => i.symbolId === "integrator")!;
    expect(resistor.reference).toBe("R1");
    expect(amp.reference).toBe("X1");
    expect(block.signalFlowParameters).toEqual({ formula: "1/(1-z^-1)" });

    for (const action of [
      {
        kind: "set-signal-flow",
        target: { kind: "instance", id: block.id },
        coefficient: "a",
      },
      { kind: "set-display-alias", instanceId: amp.id, text: "A1" },
    ]) {
      const changed = await client.applyActions([action]);
      expect(changed.ok, JSON.stringify(changed).slice(0, 800)).toBe(true);
    }
    expect(
      main().instances.find((i) => i.id === block.id)!.signalFlowParameters,
    ).toEqual({ formula: "1/(1-z^-1)", coefficient: "a" });
    const label = main().annotations.find(
      (a) =>
        a.kind === "instance-label" &&
        a.anchor.kind === "object" &&
        a.anchor.objectId === amp.id,
    )!;
    expect(label.binding).toBeUndefined();
    expect(flattenRichText(label.content!)).toBe("A1");
    expect(main().instances.find((i) => i.id === amp.id)!.reference).toBe("X1");
  });
});

describe("every rejection names its action (#1231)", () => {
  it("names the index and kind of a command the editor refuses", async () => {
    const { client } = await folder();
    const refused = await client.applyActions([
      { kind: "set-display-alias", instanceId: "missing", text: "A1" },
    ]);
    expect(refused.ok).toBe(false);
    expect(refused).toMatchObject({
      actionIndex: 0,
      actionKind: "set-display-alias",
    });
    expect(refused.message).toMatch(/^actions\[0\] \(set-display-alias\): /u);
  });
});

describe("Cell instances in one call (#1231)", () => {
  it("places several Cell instances atomically, named in turn", async () => {
    const { client, controller } = await folder();
    expect(
      (
        await client.applyActions([
          { kind: "create-cell", id: "tb", name: "Testbench" },
        ])
      ).ok,
    ).toBe(true);
    const at = (x: number) => ({
      position: { x, y: 100 },
      rotation: 0 as const,
      mirror: "none" as const,
    });
    const placed = await client.applyActions(
      [
        {
          kind: "place-cell",
          childDocumentId: "main",
          instanceId: "c1",
          placement: at(100),
        },
        {
          kind: "place-cell",
          childDocumentId: "main",
          instanceId: "c2",
          placement: at(300),
        },
        {
          kind: "place-cell",
          childDocumentId: "main",
          instanceId: "c3",
          placement: at(500),
        },
      ],
      { documentId: "tb" },
    );
    expect(placed.ok, JSON.stringify(placed).slice(0, 400)).toBe(true);
    expect(
      controller.project.documents
        .find((d) => d.id === "tb")!
        .instances.map((instance) => instance.reference)
        .sort(),
    ).toEqual(["X1", "X2", "X3"]);
  });
});
