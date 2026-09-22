import { describe, expect, it } from "vitest";
import { createEmptyProject, flattenRichText } from "@icm/model";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { callTool, type ToolSessionState } from "../../../mcp-server/src/tools";
import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";

async function folder() {
  const project = createEmptyProject("project-1", "Parity");
  project.documents[0]!.id = "main";
  project.topDocumentId = "main";
  const controller = new EditorDocumentController(project);
  const service = createAgentCircuitService({
    agentId: "test",
    host: new BrowserAgentHost(controller),
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

  it("controls schema-54 magnetic labels independently and preserves authored state", async () => {
    const { client, controller } = await folder();
    for (const [symbol, reference, parameters] of [
      ["xfmr", "T1", { k: "0.8", lp: "2n", ls: "4n" }],
      ["tcoil", "T2", { k: "0.7", l1: "3n", l2: "5n", cb: "1p" }],
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
    expect(search.hits).toHaveLength(1);
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
