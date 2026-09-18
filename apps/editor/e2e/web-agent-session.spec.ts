import { expect, test } from "@playwright/test";
import type { WebSocketRoute } from "@playwright/test";
import { createHash } from "node:crypto";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import { AgentHttpClient } from "../../../packages/agent-client/src/http-client.js";
import {
  revealPropertiesShelf,
  clickCommand,
  clickDrawTool,
  readComponentPropertyCode,
  setComponentParameter,
} from "./editor-fixtures.js";

// The live-host cases open relay sockets and one test starts a sibling Vite
// server. Keep this file in one worker while unrelated browser specs stay
// fully parallel.
test.describe.configure({ mode: "default" });

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
      expect(body.projectSessionId).toBeTruthy();
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

test("restores the same paired working copy through refresh and Gallery without resuming a pause", async ({
  page,
  baseURL,
}) => {
  await page.goto("/editor");
  await page.getByTestId("open-agent").click();
  const panel = page.getByTestId("connect-agent-panel");
  const handoff = await panel.getByTestId("agent-copy-text").inputValue();
  const { claimCode } = JSON.parse(handoff.match(/Claim: (.+)/u)![1]!);
  const client = new AgentHttpClient({ baseUrl: baseURL! });
  const session = await client.claim(claimCode);
  await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
  const documentId = session.documentIds[0]!;
  await client.circuit(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "recovery-edit",
    operation: "transact",
    documentId,
    transactionId: "recovery-edit",
    expectedRevision: 0,
    edits: [
      {
        kind: "add_instance",
        instance: {
          id: "recovery-R",
          symbolId: "resistor",
          placement: {
            position: { x: 300, y: 200 },
            rotation: 0,
            mirror: "none",
          },
        },
      },
    ],
  });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await panel.getByTestId("agent-pause").click();
  await expect(panel.getByTestId("agent-status")).toHaveText("Paused");
  // The existing explicit refresh flushes recovery before navigation.
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  // Let the existing durable recovery scheduler finish, not a second snapshot store.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const dbs = await indexedDB.databases();
        return dbs.length;
      }),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(600);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByTestId("open-agent").click();
  await expect(panel.getByTestId("agent-status")).toHaveText("Paused");
  expect(
    await client.status(session.sessionId, session.agentToken),
  ).toMatchObject({ authorization: "paused", editor: "attached" });
  await page.goto("/");
  await expect(page.getByTestId("gallery-agent-return")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await client.status(session.sessionId, session.agentToken)).editor,
    )
    .toBe("detached");
  await page.getByTestId("gallery-agent-return").click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByTestId("open-agent").click();
  await expect(panel.getByTestId("agent-status")).toHaveText("Paused");
  await panel.getByTestId("agent-resume").click();
  const snapshot = await client.circuit(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "restored-snapshot",
    operation: "snapshot",
    documentId,
  });
  expect(snapshot).toMatchObject({ ok: true, revision: 1 });
  await page.goto("/editor?new=1");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await expect
    .poll(
      async () =>
        (await client.status(session.sessionId, session.agentToken)).editor,
    )
    .toBe("detached");
});

test("copies a working handoff through the normal local dev relay", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, { experimentAgentSockets: sockets });
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes("/api/agent/")) sockets.push(this);
      }
    };
  });
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
  // Windows clipboard text uses CRLF; textarea values use LF on every OS.
  expect(handoff.replaceAll("\r\n", "\n")).toBe(
    await panel.getByTestId("agent-copy-text").inputValue(),
  );
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
  const readIdleDeadline = () =>
    page.evaluate(() => {
      const record = JSON.parse(
        sessionStorage.getItem("icm.agent-session-recovery.v1") ?? "null",
      );
      return record?.expiresAt ?? 0;
    });
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
  await expect
    .poll(readIdleDeadline)
    .toBeGreaterThan(session.connectorExpiresAt);
  // Exercise the real close handshake. The relay must acknowledge it so
  // Chromium leaves CLOSING and the editor reattaches without a new claim.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => {
      const { experimentAgentSockets } = window as unknown as {
        experimentAgentSockets: WebSocket[];
      };
      experimentAgentSockets.at(-1)!.close(4000, "transport recovery test");
    });
    await expect
      .poll(
        async () => {
          try {
            return (
              await client.circuit(session.sessionId, session.agentToken, {
                apiVersion: "3.0",
                operation: "snapshot",
                documentId,
                requestId: `after-reconnect-${attempt}-${Date.now()}`,
              })
            ).ok;
          } catch {
            return false;
          }
        },
        { timeout: 8_000 },
      )
      .toBe(true);
    await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
  }
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
          instance: {
            id: "Rlocal",
            reference: "R1",
            symbolId: "resistor",
            netlist: { parameters: { value: "1k" } },
            placement: {
              position: { x: 300, y: 200 },
              rotation: 0,
              mirror: "none",
            },
          },
        },
      ],
    },
  );
  expect(transaction).toMatchObject({ ok: true, applied: true, revision: 1 });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");

  // A second local Vite process used to replace the dependency cache of this
  // live editor. Its eager JSON language and lazy Properties editor then loaded
  // different CodeMirror state classes, crashing at the first manual selection.
  const { createServer } = await import("vite");
  const sibling = await createServer({
    root: "apps/editor",
    // A human's pnpm dev may already own 5173 while tests use 4173.
    // Let the OS allocate the sibling port; keep the two-server regression.
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: {
      force: true,
      rolldownOptions: { output: { chunkFileNames: "sibling-[hash].js" } },
    },
    logLevel: "error",
  });
  const siblingPage = await context.newPage();
  try {
    await sibling.listen();
    await siblingPage.goto(sibling.resolvedUrls!.local[0]! + "editor");
    await expect(siblingPage.getByTestId("schematic-canvas")).toBeVisible();
  } finally {
    await siblingPage.close();
    await sibling.close();
  }

  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await page.getByTestId("hit-Rlocal").click();
  await revealPropertiesShelf(page);
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "true")
    await shelf.click();
  await page.keyboard.press("q");
  const beforeManualEdit = await readIdleDeadline();
  await setComponentParameter(page, "value", "2.2k");
  await expect.poll(readIdleDeadline).toBeGreaterThan(beforeManualEdit);
  const readSnapshot = async (requestId: string) => {
    const result = await client.circuit(session.sessionId, session.agentToken, {
      apiVersion: "3.0",
      requestId,
      operation: "snapshot",
      documentId,
    });
    if (!result.ok || result.operation !== "snapshot")
      throw new Error(`Snapshot failed: ${JSON.stringify(result)}`);
    return result;
  };
  const manual = await readSnapshot("after-manual-value");
  expect(manual.revision).toBe(2);
  expect(manual.snapshot.document.instances).toEqual([
    expect.objectContaining({
      id: "Rlocal",
      netlist: { parameters: { value: "2.2k" } },
    }),
  ]);
  const editAgain = (expectedRevision: number) =>
    client.circuit(session.sessionId, session.agentToken, {
      apiVersion: "3.0",
      requestId: `agent-value-${expectedRevision}`,
      operation: "transact",
      documentId,
      transactionId: `agent-value-${expectedRevision}`,
      expectedRevision,
      edits: [
        {
          kind: "set_instance_netlist",
          instanceId: "Rlocal",
          netlist: { parameters: { value: "3.3k" } },
        },
      ],
    });
  expect(await editAgain(1)).toMatchObject({
    ok: false,
    error: { code: "STALE_REVISION" },
  });
  expect(await editAgain(manual.revision)).toMatchObject({
    ok: true,
    applied: true,
    revision: 3,
  });
  expect(
    JSON.parse(await readComponentPropertyCode(page)).parameters.value,
  ).toBe("3.3k");

  // Both writers share history without disconnecting or freezing the canvas.
  await clickCommand(page, "Edit", "Undo");
  expect(
    JSON.parse(await readComponentPropertyCode(page)).parameters.value,
  ).toBe("2.2k");
  await clickCommand(page, "Edit", "Redo");
  const second = await client.circuit(session.sessionId, session.agentToken, {
    apiVersion: "3.0",
    requestId: "agent-second-resistor",
    operation: "transact",
    documentId,
    transactionId: "agent-second-resistor",
    expectedRevision: (await readSnapshot("after-shared-history")).revision,
    edits: [
      {
        kind: "add_instance",
        instance: {
          id: "Rnext",
          symbolId: "resistor",
          placement: {
            position: { x: 500, y: 300 },
            rotation: 0,
            mirror: "none",
          },
        },
      },
    ],
  });
  expect(second).toMatchObject({ ok: true, applied: true });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-Rlocal-2").click();
  await page.getByTestId("terminal-Rnext-1").click();
  await page.keyboard.press("Escape");
  const wired = await readSnapshot("after-manual-wire");
  expect(wired.snapshot.document.nets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        terminals: expect.arrayContaining([
          expect.objectContaining({ instanceId: "Rlocal", pinName: "2" }),
          expect.objectContaining({ instanceId: "Rnext", pinName: "1" }),
        ]),
      }),
    ]),
  );
  expect(wired.snapshot.document.routes).toHaveLength(1);
  await clickCommand(page, "Edit", "Undo");
  expect(
    (await readSnapshot("after-wire-undo")).snapshot.document.routes,
  ).toHaveLength(0);
  await page.getByTestId("open-agent").click();
  await expect(panel.getByTestId("agent-status")).toContainText("Connected");
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
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
});

test("keeps browser recovery on the renewed idle deadline and expires after inactivity", async ({
  page,
}) => {
  const start = Date.now();
  const idleMs = 30 * 60_000;
  let deadline = start + idleMs;
  let creates = 0;
  let socket: WebSocketRoute | null = null;
  const sendEvent = (type: string) =>
    socket!.send(
      JSON.stringify({
        protocolVersion: "1.0",
        sessionId: "idle-browser",
        messageId: `message-${type}`,
        requestId: `event-${type}`,
        sentAt: new Date().toISOString(),
        kind: "event",
        payload: {
          type,
          sessionId: "idle-browser",
          expiresAt: new Date(deadline).toISOString(),
        },
      }),
    );
  await page.clock.install({ time: new Date(start) });
  await page.clock.setFixedTime(start);
  await page.route("**/api/agent/sessions", (route) => {
    creates += 1;
    return route.fulfill({
      json: {
        ok: true,
        session: {
          sessionId: "idle-browser",
          editorSecret: "editor-secret",
          claimCode: "idle-browser.claim",
          claimExpiresAt: start + idleMs,
          expiresAt: deadline,
        },
      },
    });
  });
  await page.routeWebSocket(
    "**/api/agent/sessions/idle-browser/editor",
    (route) => {
      socket = route;
      route.onMessage((message) => {
        const control = JSON.parse(String(message));
        if (control.kind === "heartbeat") {
          route.send(
            JSON.stringify({
              ...control,
              kind: "heartbeat-ack",
            }),
          );
          sendEvent("session.ready");
        }
      });
    },
  );
  const recovery = () =>
    page.evaluate(() =>
      JSON.parse(
        sessionStorage.getItem("icm.agent-session-recovery.v1") ?? "null",
      ),
    );
  await page.goto("/editor");
  await page.getByTestId("open-agent").click();
  await expect(page.getByTestId("agent-status")).toHaveText("Connected");
  await expect(page.getByTestId("agent-idle-policy")).toContainText(
    "30 minutes",
  );
  await page.clock.setFixedTime(start + 29 * 60_000);
  deadline = start + 59 * 60_000;
  sendEvent("session.renewed");
  await expect.poll(async () => (await recovery())?.expiresAt).toBe(deadline);
  // Crossing the initial deadline must not close the session or erase recovery.
  await page.clock.setFixedTime(start + 31 * 60_000);
  await page.clock.runFor(1_100);
  await expect(page.getByTestId("agent-status")).toHaveText("Connected");
  await page.reload();
  await page.getByTestId("open-agent").click();
  await expect(page.getByTestId("agent-status")).toHaveText("Connected");
  expect(creates).toBe(1);
  await expect.poll(async () => (await recovery())?.expiresAt).toBe(deadline);
  // Passive heartbeats must not extend the deadline on the browser.
  await page.clock.setFixedTime(deadline);
  await page.clock.runFor(1_100);
  await expect(page.getByTestId("agent-status")).toHaveText("Session expired");
  expect(await recovery()).toBeNull();
});
