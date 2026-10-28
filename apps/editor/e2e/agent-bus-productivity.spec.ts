import { expect, test } from "@playwright/test";
import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { executeProjectTransaction, proposeWireIntent } from "@icm/edit-engine";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { busReuseProject } from "./bus-reuse-fixtures";
import {
  exportedProject,
  openProject,
  readAgentClaim,
} from "./editor-fixtures";

test.use({ trace: "off", screenshot: "off" });

function productivityProject(): CircuitProject {
  let project = busReuseProject();
  for (const [index, y] of [800, 900].entries()) {
    const document = project.documents.find((cell) => cell.id === "top")!;
    const proposal = proposeWireIntent(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
      {
        id: `label-branch-${index}`,
        from: { kind: "free", point: { x: 100, y } },
        to: { kind: "free", point: { x: 300, y } },
      },
    );
    if (typeof proposal === "string") throw new Error(proposal);
    const result = executeProjectTransaction(project, {
      transactionId: `branch-fixture-${index}`,
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      actor: { kind: "human", id: "productivity-fixture" },
      edits: [
        {
          kind: "transact_document",
          documentId: document.id,
          expectedRevision: document.revision,
          edits: proposal.edits,
        },
      ],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    project = result.project;
  }
  return project;
}

test("traces and marks explicit bus members through a real Agent with atomic copy and history", async ({
  page,
  request,
  baseURL,
}) => {
  await openProject(page, serializeProject(productivityProject()));
  const before: CircuitProject = await exportedProject(page);
  const top = before.documents.find((cell) => cell.id === "top")!;
  const members = before.documents.find((cell) => cell.id === "child")!.netlist!
    .terminals[0]!.signal!.members;
  const zero = members.find((member) => member.name === "IN<0>")!;
  const one = members.find((member) => member.name === "IN<1>")!;
  const endpoint = (instanceId: string, memberId?: string) => ({
    kind: "terminal",
    instanceId,
    pinName: "IN<1:0>",
    ...(memberId ? { memberId } : {}),
  });
  const connected = endpoint("X1", one.id);
  const available = endpoint("X2", zero.id);
  const net = top.nets.find((candidate) =>
    candidate.terminals.some(
      (terminal) =>
        terminal.instanceId === "X1" && terminal.memberId === one.id,
    ),
  )!;
  expect(net).toBeDefined();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  const claimed = await request.post(`${baseURL}/api/agent/claims`, {
    data: await readAgentClaim(panel),
  });
  expect(claimed.ok()).toBe(true);
  const session = await claimed.json();
  await panel.getByLabel("Close Agent dialog").click();
  const send = async (payload: Record<string, unknown>) => {
    const response = await request.post(
      `${baseURL}/api/agent/sessions/${session.sessionId}/circuit`,
      {
        headers: {
          Authorization: `Bearer ${session.agentToken}`,
          "x-agent-context": session.contextRevision,
        },
        data: {
          apiVersion: "3.0",
          requestId: crypto.randomUUID(),
          documentId: "top",
          ...payload,
        },
      },
    );
    const result = await response.json();
    if (payload.operation === "snapshot" && result.ok)
      session.contextRevision = response.headers()["x-agent-context"];
    return result;
  };
  const commit = async (command: Record<string, unknown>) => {
    const snapshot = await send({ operation: "snapshot" });
    expect(snapshot.ok).toBe(true);
    return send({
      operation: "transact",
      transactionId: crypto.randomUUID(),
      expectedRevision: snapshot.revision,
      expectedStructureRevision: snapshot.snapshot.project.structureRevision,
      command,
    });
  };
  const documents = (project: CircuitProject) =>
    project.documents.map((cell) => ({ ...cell, revision: 0 }));
  const history = async (redo = false) => {
    await page.getByTestId("schematic-canvas").focus();
    await page.keyboard.press(
      redo ? "ControlOrMeta+Shift+z" : "ControlOrMeta+z",
    );
  };
  try {
    const traced = await send({
      operation: "snapshot",
      traceNet: { netId: net.id },
    });
    expect(traced.ok).toBe(true);
    expect(traced.revision).toBe(top.revision);
    expect(traced.trace.hops).toContainEqual(
      expect.objectContaining({
        direction: "down",
        frame: expect.objectContaining({
          instanceId: "X1",
          parentMemberId: one.id,
          parentMemberName: "IN<1>",
          childMemberId: one.id,
          childMemberName: "IN<1>",
        }),
      }),
    );
    expect((await exportedProject(page)).documents).toEqual(before.documents);

    for (const endpoints of [
      [endpoint("X2")],
      [connected],
      [available, connected],
    ]) {
      const rejected = await commit({
        kind: "set-no-connect",
        endpoints,
        marked: true,
      });
      expect(rejected.ok).toBe(false);
      expect((await exportedProject(page)).documents).toEqual(before.documents);
    }
    const marked = await commit({
      kind: "set-no-connect",
      endpoints: [available],
      marked: true,
    });
    expect(marked.ok, JSON.stringify(marked.error ?? marked.diagnostics)).toBe(
      true,
    );
    const markedProject: CircuitProject = await exportedProject(page);
    expect(
      markedProject.documents
        .find((cell) => cell.id === "top")!
        .noConnects.map((item) => item.endpoint),
    ).toEqual([available]);
    await history();
    expect(documents(await exportedProject(page))).toEqual(documents(before));
    await history(true);
    expect(documents(await exportedProject(page))).toEqual(
      documents(markedProject),
    );

    const snapshot = await send({ operation: "snapshot" });
    const copied = await send({
      operation: "transact",
      transactionId: crypto.randomUUID(),
      expectedRevision: snapshot.revision,
      expectedStructureRevision: snapshot.snapshot.project.structureRevision,
      command: {
        kind: "copy",
        offset: { x: 500, y: 200 },
        selection: {
          instanceIds: ["X2"],
          routeIds: [],
          junctionIds: [],
          annotationIds: [],
          draftingIds: [],
        },
      },
    });
    expect(copied.ok, JSON.stringify(copied.error ?? copied.diagnostics)).toBe(
      true,
    );
    const copiedProject: CircuitProject = await exportedProject(page);
    const copiedTop = copiedProject.documents.find(
      (cell) => cell.id === "top",
    )!;
    const duplicate = copiedTop.instances.find(
      (instance) =>
        !top.instances.some((original) => original.id === instance.id),
    )!;
    expect(duplicate).toBeDefined();
    expect(copiedProject.documents).toHaveLength(before.documents.length);
    expect(copiedTop.noConnects.map((item) => item.endpoint)).toEqual(
      expect.arrayContaining([available, endpoint(duplicate.id, zero.id)]),
    );
    expect(copiedTop.noConnects).toHaveLength(2);
    const stale = await send({
      operation: "transact",
      transactionId: crypto.randomUUID(),
      expectedRevision: snapshot.revision,
      expectedStructureRevision: snapshot.snapshot.project.structureRevision,
      command: {
        kind: "set-no-connect",
        endpoints: [available],
        marked: false,
      },
    });
    expect(stale.ok).toBe(false);
    expect((await exportedProject(page)).documents).toEqual(
      copiedProject.documents,
    );
    const cleared = await commit({
      kind: "set-no-connect",
      endpoints: [available, endpoint(duplicate.id, zero.id)],
      marked: false,
    });
    expect(
      cleared.ok,
      JSON.stringify(cleared.error ?? cleared.diagnostics),
    ).toBe(true);
    expect(
      (await exportedProject(page)).documents.find(
        (cell: CircuitProject["documents"][number]) => cell.id === "top",
      )!.noConnects,
    ).toEqual([]);
    await history();
    expect(documents(await exportedProject(page))).toEqual(
      documents(copiedProject),
    );

    const disconnected = await commit({
      kind: "disconnect-pin",
      instanceId: "X1",
      pinName: "IN<1:0>",
      memberId: one.id,
    });
    expect(
      disconnected.ok,
      JSON.stringify(disconnected.error ?? disconnected.diagnostics),
    ).toBe(true);
    const afterDisconnect: CircuitProject = await exportedProject(page);
    const markedDisconnected = await commit({
      kind: "set-no-connect",
      endpoints: [connected],
      marked: true,
    });
    expect(
      markedDisconnected.ok,
      JSON.stringify(
        markedDisconnected.error ?? markedDisconnected.diagnostics,
      ),
    ).toBe(true);
    await history();
    expect(documents(await exportedProject(page))).toEqual(
      documents(afterDisconnect),
    );
    await history();
    expect(documents(await exportedProject(page))).toEqual(
      documents(copiedProject),
    );
    const branchIds = ["label-branch-0-route", "label-branch-1-route"];
    const mismatched = await commit({
      kind: "expand-net-labels",
      expression: "PROBE<2:0>",
      routeIds: branchIds,
    });
    expect(mismatched.ok).toBe(false);
    expect(documents(await exportedProject(page))).toEqual(
      documents(copiedProject),
    );
    const expanded = await commit({
      kind: "expand-net-labels",
      expression: "PROBE<1:0>",
      routeIds: branchIds,
    });
    expect(
      expanded.ok,
      JSON.stringify(expanded.error ?? expanded.diagnostics),
    ).toBe(true);
    const expandedProject: CircuitProject = await exportedProject(page);
    const expandedTop = expandedProject.documents.find(
      (cell) => cell.id === "top",
    )!;
    for (const [index, name] of ["PROBE<1>", "PROBE<0>"].entries()) {
      const route = expandedTop.routes.find(
        (item) => item.id === branchIds[index],
      )!;
      expect(expandedTop.connectivityEvidence).toContainEqual(
        expect.objectContaining({
          kind: "name-claim",
          netId: route.netId,
          name,
        }),
      );
    }
    await history();
    expect(documents(await exportedProject(page))).toEqual(
      documents(copiedProject),
    );
    await history(true);
    expect(documents(await exportedProject(page))).toEqual(
      documents(expandedProject),
    );
  } finally {
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await panel.getByTestId("agent-revoke").click();
    await expect(panel).toContainText("Disconnected");
    await panel.getByLabel("Close Agent dialog").click();
  }
});
