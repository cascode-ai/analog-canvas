import { expect, test } from "@playwright/test";
import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { busReuseProject } from "./bus-reuse-fixtures";
import {
  exportedProject,
  openProject,
  readAgentClaim,
} from "./editor-fixtures";

const documentsWithoutRevision = (project: CircuitProject) =>
  project.documents.map((document) => ({ ...document, revision: 0 }));

test.use({ trace: "off", screenshot: "off" });
test("copies a migrated group through the real editor with shared dependencies and one Undo", async ({
  page,
  request,
  baseURL,
}) => {
  await openProject(page, serializeProject(busReuseProject()));
  const before: CircuitProject = await exportedProject(page);
  const source = before.documents.find((cell) => cell.id === "top")!;
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
  try {
    const snapshot = await send({ operation: "snapshot" });
    expect(snapshot.ok).toBe(true);
    const command = {
      kind: "copy",
      offset: { x: 800, y: 400 },
      selection: {
        instanceIds: source.instances.map((item) => item.id),
        routeIds: source.routes.map((item) => item.id),
        junctionIds: source.junctions.map((item) => item.id),
        annotationIds: source.annotations.map((item) => item.id),
        draftingIds: [],
      },
    };
    const result = await send({
      operation: "transact",
      transactionId: crypto.randomUUID(),
      expectedRevision: snapshot.revision,
      expectedStructureRevision: snapshot.snapshot.project.structureRevision,
      command,
    });
    expect(result.ok, JSON.stringify(result.error ?? result.diagnostics)).toBe(
      true,
    );
    const copied: CircuitProject = await exportedProject(page);
    const top = copied.documents.find((cell) => cell.id === "top")!;
    expect(copied.documents).toHaveLength(before.documents.length);
    expect(top.instances).toHaveLength(source.instances.length * 2);
    expect(top.routes).toHaveLength(source.routes.length * 2);
    expect(
      top.instances.every(
        (instance) =>
          instance.netlist?.binding?.kind === "subcircuit" &&
          instance.netlist.binding.childDocumentId === "child",
      ),
    ).toBe(true);
    expect(top.routes.filter((route) => route.members)).toHaveLength(
      source.routes.filter((route) => route.members).length * 2,
    );
    for (const original of source.instances) {
      const duplicate = top.instances.find(
        (instance) =>
          instance.placement?.position.x ===
            original.placement!.position.x + 800 &&
          instance.placement?.position.y ===
            original.placement!.position.y + 400,
      )!;
      expect(duplicate).toBeDefined();
      const originalMembers = source.nets
        .flatMap((net) => net.terminals)
        .filter((terminal) => terminal.instanceId === original.id)
        .map(({ pinName, memberId }) => ({ pinName, memberId }));
      const duplicateMembers = top.nets
        .flatMap((net) => net.terminals)
        .filter((terminal) => terminal.instanceId === duplicate.id)
        .map(({ pinName, memberId }) => ({ pinName, memberId }));
      expect(duplicateMembers).toEqual(originalMembers);
      expect(
        top.nets.some(
          (net) =>
            net.terminals.some(
              (terminal) => terminal.instanceId === original.id,
            ) &&
            net.terminals.some(
              (terminal) => terminal.instanceId === duplicate.id,
            ),
        ),
      ).toBe(false);
    }
    const stale = await send({
      operation: "transact",
      transactionId: crypto.randomUUID(),
      expectedRevision: snapshot.revision,
      expectedStructureRevision: snapshot.snapshot.project.structureRevision,
      command,
    });
    expect(stale.ok).toBe(false);
    expect((await exportedProject(page)).documents).toEqual(copied.documents);
    await page.getByTestId("schematic-canvas").focus();
    await page.keyboard.press("ControlOrMeta+z");
    expect(documentsWithoutRevision(await exportedProject(page))).toEqual(
      documentsWithoutRevision(before),
    );
  } finally {
    await page.getByRole("button", { name: "Agent", exact: true }).click();
    await panel.getByTestId("agent-revoke").click();
    await expect(panel).toContainText("Disconnected");
    await panel.getByLabel("Close Agent dialog").click();
  }
});
