import { expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { createHash } from "node:crypto";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import { AgentHttpClient } from "../../../packages/agent-client/src/http-client.js";
import { clickCommand } from "./editor-fixtures.js";

type SessionMessage = {
  kind: string;
  requestId: string;
  payload: unknown;
};

test("retries a failed Agent connection without a permission picker", async ({
  page,
}) => {
  let creates = 0;
  let releaseCreation: () => void = () => {};
  const creationReady = new Promise<void>((resolve) => {
    releaseCreation = resolve;
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => Promise.reject(new Error("Clipboard blocked")),
      },
    });
  });
  await page.routeWebSocket(
    "**/api/agent/sessions/retry-session/editor",
    () => {},
  );
  await page.route("**/api/agent/sessions", async (route) => {
    creates += 1;
    const { scopes } = route.request().postDataJSON() as { scopes: string[] };
    expect(scopes).toContain("circuit.edit.connectivity");
    expect(scopes).toContain("simulation.run");
    if (creates === 1) {
      await creationReady;
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({
      json: {
        ok: true,
        session: {
          sessionId: "retry-session",
          editorSecret: "retry-editor-secret",
          claimCode: "retry-session.claim",
          claimExpiresAt: Date.now() + 300_000,
          expiresAt: Date.now() + 3_600_000,
        },
      },
    });
  });

  await page.goto("/editor");
  expect(creates).toBe(0);
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("agent-status")).toHaveText(
    "Creating connection…",
  );
  releaseCreation();
  await expect(panel.getByRole("alert")).toContainText("restart pnpm dev");
  expect(creates).toBe(1);
  await expect(page.locator('[data-testid^="agent-preset-"]')).toHaveCount(0);
  await panel.getByTestId("agent-connect").click();
  await expect
    .poll(() => panel.getByTestId("agent-copy-text").inputValue())
    .toContain(JSON.stringify({ claimCode: "retry-session.claim" }));
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByTestId("agent-connect")).toHaveCount(0);
  expect(creates).toBe(2);
  await expect(panel.locator("details")).toHaveCount(0);
  await expect(
    panel.getByText("Paste this message into your Agent chat to connect.", {
      exact: true,
    }),
  ).toHaveCount(1);
  // All actions stay above the message, including when the toolbar wraps.
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 800 });
    const message = await panel.getByTestId("agent-copy-text").boundingBox();
    expect(message).not.toBeNull();
    expect(message!.x).toBeGreaterThanOrEqual(0);
    expect(message!.x + message!.width).toBeLessThanOrEqual(width);
    for (const button of await panel.getByRole("button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(message!.y);
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  }
  await panel.getByTestId("agent-copy-instructions").click();
  await expect(panel.getByRole("alert")).toContainText("Copy was blocked");
  expect(
    await panel.getByTestId("agent-copy-text").evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      return input.selectionEnd - input.selectionStart === input.value.length;
    }),
  ).toBe(true);
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect
    .poll(() => panel.getByTestId("agent-copy-text").inputValue())
    .toContain(JSON.stringify({ claimCode: "retry-session.claim" }));
  expect(creates).toBe(2);
});

test("grants a browser Agent, edits through the live host, and shares undo", async ({
  page,
}) => {
  const sessionId = "session-e2e";
  const editorSecret = "editor-secret-e2e";
  const responses: SessionMessage[] = [];
  let browserSocket: WebSocketRoute | null = null;
  let sessionCreates = 0;
  let revokeControls = 0;

  await page.routeWebSocket(
    `**/api/agent/sessions/${sessionId}/editor`,
    (socket) => {
      expect(socket.protocols()).toEqual(["icm-agent-session", editorSecret]);
      browserSocket = socket;
      socket.onMessage((message) => {
        responses.push(JSON.parse(String(message)) as SessionMessage);
      });
    },
  );
  await page.route("**/api/agent/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/agent/sessions") {
      sessionCreates += 1;
      const body = request.postDataJSON() as {
        projectId: string;
        projectSessionId: string;
        documentIds: string[];
        scopes: string[];
      };
      expect(body.projectId).toBe("project-main");
      expect(body.projectSessionId).toMatch(/^project-main:\d+$/u);
      expect(body.documentIds).toEqual(["document-main"]);
      expect([...body.scopes].sort()).toEqual(
        [
          "circuit.snapshot",
          "circuit.render",
          "circuit.source-spans",
          "circuit.edit.geometry",
          "circuit.edit.connectivity",
          "circuit.edit.presentation",
          "editor.semantic-control",
          "project.download",
          "project.import",
          "visual.download",
          "simulation.run",
        ].sort(),
      );
      await route.fulfill({
        contentType: "application/json",
        json: {
          ok: true,
          session: {
            sessionId,
            editorSecret,
            claimCode: `${sessionId}.one-time-claim`,
            claimExpiresAt: Date.now() + 300_000,
            expiresAt: Date.now() + 3_600_000,
          },
        },
      });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/control")) {
      const body = request.postDataJSON() as { action?: string };
      if (body.action === "revoke") revokeControls += 1;
      await route.fulfill({
        contentType: "application/json",
        json: { ok: true, status: "active" },
      });
      return;
    }
    if (request.method() === "DELETE") {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.abort();
  });

  await page.goto("/editor");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.locator('[data-testid^="agent-preset-"]')).toHaveCount(0);
  await expect
    .poll(() => page.getByTestId("agent-copy-text").inputValue())
    .toContain(JSON.stringify({ claimCode: `${sessionId}.one-time-claim` }));
  await expect.poll(() => browserSocket !== null).toBe(true);
  expect(sessionCreates).toBe(1);
  const socket = browserSocket!;

  socket.send(
    JSON.stringify({
      protocolVersion: "1.0",
      sessionId,
      messageId: "ready-message",
      requestId: "ready-event",
      sentAt: new Date().toISOString(),
      kind: "event",
      payload: { type: "session.ready", sessionId },
    }),
  );
  await expect(page.getByTestId("agent-status")).toContainText("Connected");

  const sendCircuitRequest = async (
    requestId: string,
    payload: Record<string, unknown>,
  ): Promise<SessionMessage> => {
    const responseCount = responses.filter(
      (message) =>
        message.requestId === requestId && message.kind === "circuit-response",
    ).length;
    socket.send(
      JSON.stringify({
        protocolVersion: "1.0",
        sessionId,
        messageId: `message-${requestId}`,
        requestId,
        sentAt: new Date().toISOString(),
        kind: "circuit-request",
        payload,
      }),
    );
    await expect
      .poll(
        () =>
          responses.filter(
            (message) =>
              message.requestId === requestId &&
              message.kind === "circuit-response",
          ).length,
      )
      .toBe(responseCount + 1);
    return responses
      .filter(
        (message) =>
          message.requestId === requestId &&
          message.kind === "circuit-response",
      )
      .at(-1)!;
  };

  const sendFileRequest = async (
    requestId: string,
    payload: Record<string, unknown>,
  ): Promise<SessionMessage> => {
    const responseCount = responses.filter(
      (message) =>
        message.requestId === requestId && message.kind === "file-response",
    ).length;
    socket.send(
      JSON.stringify({
        protocolVersion: "1.0",
        sessionId,
        messageId: `file-${requestId}`,
        requestId,
        sentAt: new Date().toISOString(),
        kind: "file-request",
        payload,
      }),
    );
    await expect
      .poll(
        () =>
          responses.filter(
            (message) =>
              message.requestId === requestId &&
              message.kind === "file-response",
          ).length,
      )
      .toBe(responseCount + 1);
    return responses
      .filter(
        (message) =>
          message.requestId === requestId && message.kind === "file-response",
      )
      .at(-1)!;
  };

  const capabilities = await sendCircuitRequest("capabilities", {
    apiVersion: "3.0",
    requestId: "capabilities",
    operation: "capabilities",
  });
  expect(capabilities.payload).toMatchObject({
    ok: true,
    capabilities: {
      operations: ["capabilities", "snapshot", "transact", "render"],
      resources: {
        file: {
          path: "/api/agent/sessions/{sessionId}/files",
          humanApprovalOperations: ["request-approval"],
        },
      },
    },
  });

  const snapshot = await sendCircuitRequest("snapshot-before", {
    apiVersion: "3.0",
    requestId: "snapshot-before",
    operation: "snapshot",
    documentId: "document-main",
  });
  expect(snapshot.kind).toBe("circuit-response");
  expect(snapshot.payload).toMatchObject({
    ok: true,
    operation: "snapshot",
    revision: 0,
  });

  const semantic = await sendCircuitRequest("semantic-fit", {
    apiVersion: "3.0",
    requestId: "semantic-fit",
    operation: "transact",
    documentId: "document-main",
    transactionId: "semantic-fit-transaction",
    expectedRevision: 0,
    semanticIntent: { kind: "fit-document" },
  });
  expect(semantic.payload).toMatchObject({
    ok: true,
    operation: "transact",
    applied: false,
    revision: 0,
    proposedRevision: 0,
    semantic: {
      kind: "fit-document",
      documentId: "document-main",
      objectIds: [],
    },
  });
  await expect(page.getByTestId("revision")).toHaveText("0");

  const transaction = await sendCircuitRequest("agent-edit", {
    apiVersion: "3.0",
    requestId: "agent-edit",
    operation: "transact",
    documentId: "document-main",
    transactionId: "agent-transaction-e2e",
    expectedRevision: 0,
    edits: [
      {
        kind: "add_instance",
        instance: {
          id: "Ragent",
          symbolId: "resistor",
          placement: null,
        },
      },
    ],
  });
  expect(transaction.payload).toMatchObject({
    ok: true,
    operation: "transact",
    applied: true,
    revision: 1,
  });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect
    .poll(() =>
      responses.some(
        (message) =>
          message.kind === "event" &&
          (message.payload as { actorKind?: string }).actorKind === "agent",
      ),
    )
    .toBe(true);

  const replay = await sendCircuitRequest("agent-edit", {
    apiVersion: "3.0",
    requestId: "agent-edit",
    operation: "transact",
    documentId: "document-main",
    transactionId: "agent-transaction-e2e",
    expectedRevision: 0,
    edits: [
      {
        kind: "add_instance",
        instance: {
          id: "Ragent",
          symbolId: "resistor",
          placement: null,
        },
      },
    ],
  });
  expect(replay.payload).toEqual(transaction.payload);
  await expect(page.getByTestId("revision")).toHaveText("1");

  const stagedBytes = Buffer.from(
    serializeProject(
      createEmptyProject("agent-staged", "Agent staged Project"),
    ),
  );
  const staged = await sendFileRequest("stage-project", {
    apiVersion: "3.0",
    requestId: "stage-project",
    operation: "stage",
    kind: "project",
    files: [
      {
        name: "agent-staged.icproj.json",
        mediaType: "application/json",
        encoding: "base64",
        data: stagedBytes.toString("base64"),
        byteLength: stagedBytes.byteLength,
        sha256: createHash("sha256").update(stagedBytes).digest("hex"),
      },
    ],
  });
  expect(staged.payload).toMatchObject({ ok: true, operation: "stage" });
  const candidateId = (staged.payload as { candidate: { candidateId: string } })
    .candidate.candidateId;
  await sendFileRequest("approve-staged-project", {
    apiVersion: "3.0",
    requestId: "approve-staged-project",
    operation: "request-approval",
    candidateId,
  });
  await expect(page.getByTestId("agent-file-approval")).toContainText(
    "Agent staged Project",
  );
  await expect(page.getByTestId("revision")).toHaveText("1");
  await page.getByTestId("agent-file-reject").click();
  await expect(page.getByTestId("agent-file-approval")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("1");

  await page
    .getByTestId("connect-agent-panel")
    .getByRole("button", { name: "Close Agent dialog" })
    .click();
  await clickCommand(page, "Edit", "Undo");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await expect
    .poll(() =>
      responses.some(
        (message) =>
          message.kind === "event" &&
          (message.payload as { actorKind?: string }).actorKind === "human",
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("agent-status")).toContainText("Connected");
  expect(sessionCreates).toBe(1);
  const originalSocket = browserSocket as WebSocketRoute | null;
  if (!originalSocket) throw new Error("Agent WebSocket was not connected");
  originalSocket.close();
  await expect.poll(() => browserSocket !== originalSocket).toBe(true);
  await expect(panel.getByTestId("agent-status")).toContainText("Connected");
  await panel.getByTestId("agent-pause").click();
  await expect(panel.getByTestId("agent-status")).toContainText("Paused");
  await panel.getByTestId("agent-resume").click();
  await expect(panel.getByTestId("agent-status")).toContainText("Connected");
  await panel.getByTestId("agent-new-connection").click();
  await expect.poll(() => sessionCreates).toBe(2);
  await expect.poll(() => revokeControls).toBe(1);
  await expect
    .poll(() => panel.getByTestId("agent-copy-text").inputValue())
    .toContain(JSON.stringify({ claimCode: `${sessionId}.one-time-claim` }));
  await expect(panel.getByTestId("agent-status")).toContainText(
    "Waiting for Agent",
  );
  await panel.getByTestId("agent-revoke").click();
  await expect(panel.getByTestId("agent-status")).toContainText("Disconnected");
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(panel.getByTestId("agent-status")).toContainText(
    "Waiting for Agent",
  );
  expect(sessionCreates).toBe(3);
});

test("copies a working handoff through the normal local dev relay", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/editor");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("agent-copy-instructions")).toBeVisible({
    timeout: 30_000,
  });
  await panel.getByTestId("agent-copy-instructions").click();
  await expect(panel.getByLabel("Connection setup copied")).toBeVisible();
  const handoff = await page.evaluate(() => navigator.clipboard.readText());
  expect(handoff).toBe(await panel.getByTestId("agent-copy-text").inputValue());
  expect(handoff).toContain(`Connect to Analog Canvas at ${baseURL}.`);
  const kitUrl = handoff.match(/HTTP Agent Kit: (\S+)/u)![1]!;
  expect((await request.get(kitUrl)).ok()).toBe(true);
  expect((await request.get(`${baseURL}/api/agent/openapi.json`)).ok()).toBe(
    true,
  );
  expect(
    (
      await request.post(`${baseURL}/api/agent/sessions`, {
        headers: { Origin: "https://unrelated.example" },
        data: {},
      })
    ).status(),
  ).toBe(403);

  const { claimCode } = JSON.parse(handoff.match(/Claim: (.+)/u)![1]!) as {
    claimCode: string;
  };
  const client = new AgentHttpClient({ baseUrl: baseURL! });
  const session = await client.claim(claimCode);
  const documentId = session.documentIds[0]!;
  const snapshot = await client.circuit(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "local-before",
    operation: "snapshot",
    documentId,
  });
  expect(snapshot).toMatchObject({
    ok: true,
    operation: "snapshot",
    revision: 0,
  });
  await expect(panel.getByTestId("agent-status")).toContainText("Connected");
  const transaction = await client.circuit(
    session.sessionId,
    session.agentToken,
    {
      apiVersion: "3.0",
      requestId: "local-edit",
      operation: "transact",
      documentId,
      transactionId: "local-edit",
      expectedRevision: 0,
      edits: [
        {
          kind: "add_instance",
          instance: { id: "Rlocal", symbolId: "resistor", placement: null },
        },
      ],
    },
  );
  expect(transaction).toMatchObject({ ok: true, applied: true, revision: 1 });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await panel.getByTestId("agent-revoke").click();
  await expect(panel.getByTestId("agent-status")).toContainText("Disconnected");
  await expect(
    client.circuit(session.sessionId, session.agentToken, {
      apiVersion: "3.0",
      requestId: "local-after-revoke",
      operation: "snapshot",
      documentId,
    }),
  ).rejects.toThrow();
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await clickCommand(page, "Edit", "Undo");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
});
