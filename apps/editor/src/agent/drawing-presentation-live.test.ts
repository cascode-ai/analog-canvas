import { expect, it } from "vitest";
import { parseProject } from "@icm/project-protocol";
import { callTool } from "../../../mcp-server/src/tools";
import { liveAgentEditor } from "./live-agent-editor.test-support";

it("reads and edits ADC fill and drawing order through the live MCP editor", async () => {
  const { client, controller, service } = liveAgentEditor();
  await client.connect("session-1.code");
  expect(
    await client.applyActions([
      {
        kind: "place-component",
        symbol: "adc",
        position: { x: 100, y: 100 },
      },
      {
        kind: "place-component",
        symbol: "adc",
        position: { x: 120, y: 110 },
      },
    ]),
  ).toMatchObject({ ok: true });
  const [adc, other] = controller.document.instances;
  const front = { kind: "instance", id: adc!.id };
  const back = { kind: "instance", id: other!.id };
  const fill = { kind: "color", color: "#374151" };
  const snapshotRequest = {
    apiVersion: "3.0",
    operation: "snapshot",
    documentId: "main",
  };
  const plainBefore = service.handle({
    ...snapshotRequest,
    requestId: "plain-before",
  });
  expect(plainBefore).toMatchObject({ ok: true });
  const tool = async (name: string, args: unknown) => {
    const result = await callTool(name, args, { client });
    return JSON.parse(result.content[0]!.text!);
  };
  const inspect = () =>
    tool("inspect", {
      target: { kind: "document" },
      detail: "full",
      drawingPresentation: true,
    });
  const before = await inspect();
  expect(before.instances).toContainEqual(
    expect.objectContaining({ id: adc!.id, supportsBodyFill: true }),
  );
  const revision = controller.document.revision;
  const edits = [
    { kind: "set_body_fill", objectIds: [adc!.id], fill },
    {
      kind: "reorder_drawing_objects",
      objectIds: [adc!.id],
      position: { kind: "after", target: back },
    },
  ];
  expect(
    await tool("advanced_transact", { dryRun: true, edits, detail: "full" }),
  ).toMatchObject({ ok: true, applied: false });
  expect(controller.document.revision).toBe(revision);
  expect(
    await tool("advanced_transact", { edits, detail: "full" }),
  ).toMatchObject({ ok: true, applied: true });
  const painted = await inspect();
  expect(painted.instances).toContainEqual(
    expect.objectContaining({ id: adc!.id, bodyFill: fill }),
  );
  expect(
    painted.drawingOrder.filter(
      (entry: { kind: string }) => entry.kind === "instance",
    ),
  ).toEqual([back, front]);
  expect(controller.document.revision).toBe(revision + 1);

  const exported = await tool("project_code", { action: "read" });
  expect(exported).toMatchObject({ ok: true, operation: "read-project-code" });
  const reopened = liveAgentEditor({
    project: parseProject(exported.projectCode),
  });
  await reopened.client.connect("session-1.code");
  const roundTrip = await reopened.client.snapshot("main", {
    drawingPresentation: true,
  });
  expect(roundTrip.snapshot.document.drawingOrder).toEqual(
    painted.drawingOrder,
  );
  expect(roundTrip.snapshot.document.instances).toContainEqual(
    expect.objectContaining({ id: adc!.id, bodyFill: fill }),
  );
  expect(
    await tool("inspect", {
      target: { kind: "object", id: adc!.id },
      drawingPresentation: true,
    }),
  ).toMatchObject({ id: adc!.id, supportsBodyFill: true, bodyFill: fill });

  const ordinaryRead = await tool("inspect", {
    target: { kind: "document" },
    detail: "full",
  });
  expect(ordinaryRead).toMatchObject({ instances: expect.any(Array) });
  expect(ordinaryRead).not.toHaveProperty("drawingOrder");
  expect(
    ordinaryRead.instances.find((item: { id: string }) => item.id === adc!.id),
  ).not.toHaveProperty("bodyFill");

  const plainAfter = service.handle({
    ...snapshotRequest,
    requestId: "plain-after",
  });
  if (
    !plainAfter.ok ||
    plainAfter.operation !== "snapshot" ||
    !("snapshot" in plainAfter)
  ) {
    throw new Error("Expected a full Snapshot");
  }
  expect(plainAfter.snapshot.document).not.toHaveProperty("drawingOrder");
  expect(
    plainAfter.snapshot.document.instances.find((item) => item.id === adc!.id),
  ).not.toHaveProperty("bodyFill");
  expect(
    plainAfter.snapshot.document.instances.find((item) => item.id === adc!.id),
  ).not.toHaveProperty("supportsBodyFill");
  expect(await client.applyActions([{ kind: "undo" }])).toMatchObject({
    ok: true,
  });
  const undone = await inspect();
  expect(undone.drawingOrder).toEqual(before.drawingOrder);
  expect(undone.instances).toEqual(before.instances);
});

it("rejects an appearance batch atomically and protects reordering from stale requests", async () => {
  const { client, controller, service } = liveAgentEditor();
  await client.connect("session-1.code");
  expect(
    await client.applyActions([
      { kind: "place-component", symbol: "adc", position: { x: 100, y: 100 } },
      {
        kind: "place-component",
        symbol: "resistor",
        position: { x: 200, y: 100 },
      },
    ]),
  ).toMatchObject({ ok: true });
  const [adc, resistor] = controller.document.instances;
  const revision = controller.document.revision;
  const document = structuredClone(controller.document);
  const request = {
    operation: "transact",
    apiVersion: "3.0",
    documentId: "main",
    expectedRevision: revision,
    transactionId: "fill-batch",
    requestId: "fill-batch",
  };
  expect(
    service.handle({
      ...request,
      edits: [
        {
          kind: "set_body_fill",
          objectIds: [adc!.id, resistor!.id],
          fill: { kind: "background" },
        },
      ],
    }),
  ).toMatchObject({
    ok: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({
        objectIds: expect.arrayContaining([resistor!.id]),
      }),
    ]),
  });
  expect(controller.document).toEqual(document);

  // Relative moves risk a different result if an old payload runs twice.
  const move = {
    ...request,
    transactionId: "relative-move",
    requestId: "relative-move",
    edits: [
      {
        kind: "reorder_drawing_objects",
        objectIds: [adc!.id],
        position: { kind: "back" },
      },
    ],
  };
  expect(service.handle(move)).toMatchObject({ ok: true, applied: true });
  expect(service.handle(move)).toMatchObject({
    ok: false,
    error: { code: "STALE_REVISION" },
  });
  expect(controller.document.revision).toBe(revision + 1);
});
