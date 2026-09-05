import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { createAgentCircuitService } from "@icm/agent-adapter";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import { FakeAgentHttp } from "../../../../packages/agent-client/src/test-support/fake-relay";
import { callTool, type ToolSessionState } from "../../../mcp-server/src/tools";
import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";

async function setup() {
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
  return { controller, client, tool, add };
}

describe("MCP → API → shared editor parity", () => {
  it("places the original top in a new TB through public actions and retains normal history", async () => {
    const { client, controller } = await setup();
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
    expect(controller.project.simulation).toBeUndefined();
    const instance = controller.project.documents.find((d) => d.id === "tb")!
      .instances[0]!;
    expect(instance.netlist?.binding).toEqual({
      kind: "subcircuit",
      childDocumentId: "main",
    });
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
    const { client, controller, add } = await setup();
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
    const { client, controller, tool } = await setup();
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
    const { client, controller, add } = await setup();
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
    const { client, controller, tool } = await setup();
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
    const { add, client, tool } = await setup();
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
    const { add, client, controller } = await setup();
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
    const { add, client, controller } = await setup();
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
    const { client, tool, controller } = await setup();
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
