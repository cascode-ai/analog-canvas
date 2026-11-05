import { expect, test } from "@playwright/test";
import type { Locator, Page, Route, WebSocketRoute } from "@playwright/test";
import { createHash } from "node:crypto";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import { AgentHttpClient, AgentSessionClient } from "@icm/agent-client";
import { openGalleryEntry } from "../../mcp-server/src/file-operations.js";
import { placedInstance } from "./canvas-fixtures.js";
import { sessionUser, signIn } from "./gallery-fixtures.js";
import {
  revealPropertiesShelf,
  awaitEditorReady,
  setComponentParameter,
  openCellManager,
  openEditor,
  readAgentClaim,
} from "./editor-fixtures.js";
import { readComponentCode } from "./manual-editor-fixtures.js";

// The live-host cases open relay sockets and one test starts a sibling Vite
// server. Keep this file in one worker while unrelated browser specs stay
// fully parallel.
//
// What the editor answers an Agent is liveAgentEditor's module tests
// (browser-agent-*-host, mcp-*-live, agent-capability-parity). These cases
// keep the pairing over the wire, the App's Project tabs, recovery through
// navigation and crashes, and the connection panel.
test.describe.configure({ mode: "default" });

/** Pairs an HTTP Agent client with this page through the real local relay. */
async function pairAgent(page: Page, baseURL: string) {
  await page.getByTestId("open-agent").click();
  const panel = page.getByTestId("connect-agent-panel");
  const { claimCode } = await readAgentClaim(panel);
  const client = new AgentHttpClient({ baseUrl: baseURL });
  const session = await client.claim(claimCode);
  await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
  return { panel, client, session, agent: boundTo(client, session) };
}

type WorkspaceRequest = Extract<
  Parameters<AgentHttpClient["projects"]>[2],
  { operation: "workspace" }
>["request"];

/** The client's Agent requests with this session's credentials. */
function boundTo(
  client: AgentHttpClient,
  { sessionId, agentToken }: { sessionId: string; agentToken: string },
) {
  const status = () => client.status(sessionId, agentToken);
  const workspaceRequest = (requestId: string, request: WorkspaceRequest) =>
    client.projects(sessionId, agentToken, {
      apiVersion: "3.0",
      requestId,
      operation: "workspace",
      request,
    });
  return {
    circuit: (request: Parameters<AgentHttpClient["circuit"]>[2]) =>
      client.circuit(sessionId, agentToken, request),
    /** A Circuit snapshot of one Cell. */
    snapshot: (requestId: string, documentId: string) =>
      client.circuit(sessionId, agentToken, {
        apiVersion: "3.0",
        requestId,
        operation: "snapshot",
        documentId,
      }),
    files: (request: Parameters<AgentHttpClient["files"]>[2]) =>
      client.files(sessionId, agentToken, request),
    status,
    workspaceRequest,
    /** A workspace request after reading the current context, as the Agent client does. */
    workspace: (requestId: string, request: WorkspaceRequest) =>
      status().then(() => workspaceRequest(requestId, request)),
  };
}
type Agent = ReturnType<typeof boundTo>;

/** A Circuit transaction that places one resistor. */
function placeResistor(
  documentId: string,
  requestId: string,
  id: string,
  { expectedRevision = 0, x = 300 } = {},
) {
  return {
    apiVersion: "3.0" as const,
    operation: "transact" as const,
    documentId,
    requestId,
    transactionId: requestId,
    expectedRevision,
    edits: [
      {
        kind: "add_instance" as const,
        instance: placedInstance(id, "resistor", x, 200),
      },
    ],
  };
}

/** The working copies a workspace list answered; a refusal throws. */
function listed(reply: Awaited<ReturnType<AgentHttpClient["projects"]>>) {
  if (
    !reply.ok ||
    reply.operation !== "workspace" ||
    reply.result.action !== "list"
  )
    throw new Error(JSON.stringify(reply));
  return reply.result;
}

/** Waits until the handoff text carries this Claim code. */
const expectClaimCode = (scope: Page | Locator, claimCode: string) =>
  expect
    .poll(() => scope.getByTestId("agent-copy-text").inputValue())
    .toContain(JSON.stringify({ claimCode }));

/** One file of a staging request, with its digest. */
const stagedFile = (name: string, mediaType: string, bytes: Buffer) => ({
  name,
  mediaType,
  encoding: "base64" as const,
  data: bytes.toString("base64"),
  byteLength: bytes.byteLength,
  sha256: createHash("sha256").update(bytes).digest("hex"),
});

/** A structural SPICE file staged for the Agent to open or have approved. */
async function stageSpice(agent: Agent, requestId: string) {
  const bytes = Buffer.from(
    ".subckt stage vin vout\nR1 vin vout 1k\n.ends stage\n",
  );
  const staged = await agent.files({
    apiVersion: "3.0",
    requestId,
    operation: "stage",
    kind: "structural-spice",
    entryPath: "stage.spi",
    files: [stagedFile("stage.spi", "text/plain", bytes)],
  });
  if (!staged.ok || staged.operation !== "stage")
    throw new Error(JSON.stringify(staged));
  return staged.candidate.candidateId;
}

// The unchanged-context case is the same journey without the refusals.
test("Agent Gallery open returns each new working copy after the relay context changes", async ({
  page,
  baseURL,
}) => {
  await openEditor(page);
  await page.getByTestId("open-agent").click();
  const panel = page.getByTestId("connect-agent-panel");
  const { claimCode } = await readAgentClaim(panel);
  let openedFile = false;
  const staleStatuses: number[] = [];
  const client = new AgentSessionClient({
    http: new AgentHttpClient({
      baseUrl: baseURL!,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        const body =
          request.method === "POST" ? await request.clone().json() : null;
        // Deliver one out-of-date context to the real relay after each open.
        // Its HTTP refusal exercises the transport, session refresh and helper.
        const stale =
          openedFile &&
          path.endsWith("/projects") &&
          body?.operation === "workspace" &&
          body.request.action === "list";
        if (stale) {
          openedFile = false;
          request.headers.set("x-agent-context", "previous-gallery-context");
        }
        const response = await fetch(request);
        if (stale) staleStatuses.push(response.status);
        if (
          path.endsWith("/files") &&
          body?.operation === "open" &&
          response.ok
        ) {
          openedFile = true;
          await expect
            .poll(async () => {
              const status = await fetch(
                request.url.replace(/\/files$/u, "/status"),
                { headers: request.headers },
              );
              return (await status.json()).contextRevision;
            })
            .not.toBe(request.headers.get("x-agent-context"));
        }
        return response;
      },
    }),
  });
  await client.connect(claimCode);
  try {
    await panel.getByRole("button", { name: "Close Agent dialog" }).click();
    const project = createEmptyProject(
      "gallery-background",
      "Background Gallery",
    );
    await page.route("**/api/gallery/issue-1546", (route) =>
      route.fulfill({ json: { projectText: serializeProject(project) } }),
    );
    // Hidden browser panels may stop rendering frames while servicing Agent calls.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      window.requestAnimationFrame = () => 0;
    });
    for (let index = 0; index < 3; index++) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const opened = await Promise.race([
          openGalleryEntry(client, "issue-1546", false),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    `Gallery open ${index + 1} waited for a hidden view`,
                  ),
                ),
              5_000,
            );
          }),
        ]);
        expect(opened).toMatchObject({
          ok: true,
          workspaceId: expect.any(String),
          activeWorkspaceId: opened.workspaceId,
        });
      } finally {
        clearTimeout(timeout);
      }
    }
    expect((await client.refreshSnapshot()).snapshot.project.name).toBe(
      "Background Gallery",
    );
    expect(staleStatuses).toEqual([409, 409, 409]);
  } finally {
    await client.disconnect();
  }
});

/** The relay's answer to a created session. */
const createdSession = (
  sessionId: string,
  editorSecret: string,
  claimExpiresAt: number,
  expiresAt: number,
  claimCode = `${sessionId}.claim`,
) => ({
  ok: true,
  session: { sessionId, editorSecret, claimCode, claimExpiresAt, expiresAt },
});

/** Installs the page clock and scripts the relay so a test answers each create. */
async function controlledConnections(page: Page) {
  await page.clock.install();
  const creates: Route[] = [];
  const controls: Route[] = [];
  const sockets: string[] = [];
  const socketRoutes: WebSocketRoute[] = [];
  await page.routeWebSocket("**/api/agent/sessions/*/editor", (socket) => {
    sockets.push(socket.url());
    socketRoutes.push(socket);
    socket.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.kind === "heartbeat")
        socket.send(JSON.stringify({ ...parsed, kind: "heartbeat-ack" }));
    });
  });
  await page.route("**/api/agent/sessions**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && path === "/api/agent/sessions")
      creates.push(route);
    else if (path.endsWith("/control")) controls.push(route);
    else if (request.method() === "DELETE")
      await route.fulfill({ status: 204 });
    else if (path.endsWith("/status"))
      await route.fulfill({
        json: {
          ok: true,
          authorization: "active",
          editor: "detached",
          observedAt: Date.now(),
          expiresAt: Date.now() + 1_800_000,
        },
      });
    else await route.abort();
  });
  return {
    creates,
    controls,
    sockets,
    socketRoutes,
    /** Opens the editor's Agent dialog once its first create is requested. */
    open: async () => {
      await openEditor(page);
      await page.getByRole("button", { name: "Agent", exact: true }).click();
      await expect.poll(() => creates.length).toBe(1);
      return page.getByTestId("connect-agent-panel");
    },
    /** Waits until the scope shows Claim `index`. */
    expectClaim: (scope: Locator, index: number) =>
      expect(scope.getByTestId("agent-copy-text")).toHaveValue(
        new RegExp(`controlled-${index}\\.claim`),
      ),
    complete: (index: number, claimLifetimeMs = 300_000) =>
      creates[index]!.fulfill({
        headers: { date: new Date().toUTCString() },
        json: createdSession(
          `controlled-${index}`,
          `secret-${index}`,
          Date.now() + claimLifetimeMs,
          Date.now() + 1_800_000,
        ),
      }),
  };
}

// A Claim's deadline is set from the relay's clock (claim-clock.test.ts) and
// measured on the page's elapsed clock: a wall-clock jump does not expire it.
test("a Claim survives a wall-clock jump, and once expired keeps its explanation after socket recovery and can be replaced", async ({
  page,
}) => {
  const relay = await controlledConnections(page);
  const panel = await relay.open();
  await relay.complete(0, 4_000);
  await relay.expectClaim(panel, 0);
  await page.clock.setSystemTime(
    (await page.evaluate(() => Date.now())) + 24 * 60 * 60_000,
  );
  await page.clock.runFor(1_100);
  await relay.expectClaim(panel, 0);
  await expect(panel.getByTestId("agent-claim-expired")).toHaveCount(0);
  await page.clock.runFor(3_000);
  await expect(panel.getByTestId("agent-claim-expired")).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
  await relay.socketRoutes[0]!.close({ code: 1012, reason: "relay restart" });
  await expect(panel.getByTestId("agent-status")).toHaveText("Reconnecting");
  await expect(panel.getByTestId("agent-claim-expired")).toBeVisible();
  await page.clock.runFor(1_100);
  await expect.poll(() => relay.sockets.length).toBe(2);
  await expect(panel.getByTestId("agent-status")).toHaveText(
    "Waiting for Agent",
  );
  await expect(panel.getByTestId("agent-claim-expired")).toBeVisible();
  await expect(panel.getByTestId("agent-copy-text")).toHaveCount(0);
  await panel.getByTestId("agent-new-connection").click();
  await expect.poll(() => relay.creates.length).toBe(2);
  await relay.complete(1);
  await relay.expectClaim(panel, 1);
});

test("a created Claim is visible before socket readiness and removed when setup times out", async ({
  page,
}) => {
  const relay = await controlledConnections(page);
  // Delay the external socket's open notification, not any Editor collaborator.
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        this.addEventListener(
          "open",
          (event) => {
            event.stopImmediatePropagation();
            setTimeout(() => this.dispatchEvent(new Event("open")), 60_000);
          },
          { once: true },
        );
      }
    };
  });
  const panel = await relay.open();
  await relay.complete(0);
  await relay.expectClaim(panel, 0);
  await expect(panel.getByTestId("agent-status")).toHaveText(
    "Creating connection…",
  );
  await expect(
    panel.getByRole("button", { name: "Cancel connection" }),
  ).toBeEnabled();
  await page.clock.runFor(15_100);
  await expect(panel.getByRole("alert")).toContainText("timed out");
  await expect(panel.getByTestId("agent-copy-text")).toHaveCount(0);
  await expect(panel.getByTestId("agent-connect")).toBeEnabled();
});

test("connection controls recover from a cancelled or hung create, and across dialog and Properties while old requests are pending", async ({
  page,
}) => {
  const relay = await controlledConnections(page);
  // A cancelled and a hung create are retried without refreshing; their late
  // answers change nothing.
  const panel = await relay.open();
  await panel.getByRole("button", { name: "Cancel connection" }).click();
  await expect(panel.getByTestId("agent-status")).toHaveText("Disconnected");
  await panel.getByTestId("agent-new-connection").click();
  await expect.poll(() => relay.creates.length).toBe(2);
  await page.clock.fastForward(15_100);
  await expect(panel.getByRole("alert")).toContainText("timed out");
  await panel.getByTestId("agent-connect").click();
  await expect.poll(() => relay.creates.length).toBe(3);
  await relay.complete(2);
  await expect(panel.getByTestId("agent-status")).toHaveText(
    "Waiting for Agent",
  );
  await relay.complete(0).catch(() => undefined);
  await relay.complete(1).catch(() => undefined);
  await relay.expectClaim(panel, 2);
  expect(relay.sockets).toHaveLength(1);
  expect(relay.sockets[0]).toContain("controlled-2/editor");
  // Leave Pause and Revoke unanswered. Neither may mutate the replacement.
  await panel.getByTestId("agent-pause").click();
  await expect.poll(() => relay.controls.length).toBe(1);
  await expect(panel.getByRole("status")).toHaveText("Pausing…");
  await panel.getByTestId("agent-revoke").click();
  await expect(panel.getByTestId("agent-status")).toHaveText("Disconnected");
  await expect.poll(() => relay.controls.length).toBe(2);
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await revealPropertiesShelf(page);
  await page.getByTestId("selection-shelf").click();
  const properties = page.getByTestId("agent-properties");
  await properties.getByTestId("agent-new-connection").click();
  await expect.poll(() => relay.creates.length).toBe(4);
  await relay.complete(3);
  await expect(properties).toContainText("Waiting for Agent");
  await relay.controls[0]!.fulfill({ json: { ok: true } }).catch(
    () => undefined,
  );
  await relay.controls[1]!.fulfill({ json: { ok: true } });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await relay.expectClaim(panel, 3);
  await panel.getByTestId("agent-pause").click();
  await expect.poll(() => relay.controls.length).toBe(3);
  expect(relay.controls[2]!.request().url()).toContain("controlled-3/control");
  await relay.controls[2]!.fulfill({ json: { ok: true } });
  await expect(panel.getByTestId("agent-status")).toHaveText("Paused");
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await properties.getByRole("button", { name: "Manage", exact: true }).click();
  await properties.getByTestId("agent-new-connection").click();
  await expect.poll(() => relay.creates.length).toBe(5);
  await relay.creates[4]!.fulfill({
    status: 503,
    json: { error: { message: "Relay unavailable" } },
  });
  await expect(properties.getByRole("alert")).toContainText(
    "Relay unavailable",
  );
  await properties.getByTestId("agent-connect").click();
  await expect.poll(() => relay.creates.length).toBe(6);
  await relay.complete(5);
  await relay.expectClaim(properties, 5);
});

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
    if (creates === 1) {
      await creationReady;
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({
      json: createdSession(
        "retry-session",
        "retry-editor-secret",
        Date.now() + 300_000,
        Date.now() + 3_600_000,
      ),
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
  await panel.getByTestId("agent-connect").click();
  await expectClaimCode(panel, "retry-session.claim");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByTestId("agent-connect")).toHaveCount(0);
  expect(creates).toBe(2);
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
  await expectClaimCode(panel, "retry-session.claim");
  expect(creates).toBe(2);
});

// The relay is scripted here, so the editor's own input checks and its
// connection controls are seen without the relay's. Capabilities, Snapshot,
// Project Code, Netlist and semantic control are browser-agent-host and
// browser-agent-project-host module tests.
test("grants a browser Agent, edits through the live host, and shares undo", async ({
  page,
}) => {
  const sessionId = "session-e2e";
  const editorSecret = "editor-secret-e2e";
  const responses: SessionMessage[] = [];
  let browserSocket: WebSocketRoute | null = null;
  let sessionCreates = 0;
  let revokeControls = 0;
  let contextRevision: string | undefined;
  let initialProjectId: string | undefined;

  await page.routeWebSocket(
    `**/api/agent/sessions/${sessionId}/editor`,
    (socket) => {
      expect(socket.protocols()).toEqual(["icm-agent-session", editorSecret]);
      browserSocket = socket;
      socket.onMessage((message) => {
        const parsed = JSON.parse(String(message));
        if (parsed.kind === "heartbeat") {
          contextRevision = parsed.contextRevision;
          socket.send(JSON.stringify({ ...parsed, kind: "heartbeat-ack" }));
        }
        responses.push(parsed as SessionMessage);
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
      expect(body.projectId).toMatch(/^project-/);
      initialProjectId ??= body.projectId;
      expect(body.projectId).toBe(initialProjectId);
      expect(body.projectSessionId).toBeTruthy();
      expect(body.documentIds).toEqual(["document-main"]);
      // Every scope, without a permission picker. Listed here, so a new
      // scope a browser Agent gets is a decision this test records.
      expect([...body.scopes].sort()).toEqual(
        [
          "circuit.snapshot",
          "circuit.render",
          "circuit.source-spans",
          "circuit.edit.geometry",
          "circuit.edit.connectivity",
          "circuit.edit.presentation",
          "editor.semantic-control",
          "gallery.publish",
          "components.publish",
          "project.download",
          "project.import",
          "visual.download",
          "simulation.run",
        ].sort(),
      );
      await route.fulfill({
        contentType: "application/json",
        json: createdSession(
          sessionId,
          editorSecret,
          Date.now() + 300_000,
          Date.now() + 3_600_000,
          `${sessionId}.one-time-claim`,
        ),
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
  await expectClaimCode(page, `${sessionId}.one-time-claim`);
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

  const send = async (
    kind: "circuit" | "file" | "project" | "simulation",
    requestId: string,
    payload: Record<string, unknown>,
  ): Promise<SessionMessage> => {
    const replies = () =>
      responses.filter(
        (message) =>
          message.requestId === requestId &&
          message.kind === `${kind}-response`,
      );
    const before = replies().length;
    socket.send(
      JSON.stringify({
        protocolVersion: "1.0",
        sessionId,
        messageId: `${kind}-${requestId}`,
        requestId,
        sentAt: new Date().toISOString(),
        kind: `${kind}-request`,
        contextRevision,
        payload: { apiVersion: "3.0", requestId, ...payload },
      }),
    );
    await expect.poll(() => replies().length).toBe(before + 1);
    return replies().at(-1)!;
  };

  // The editor refuses malformed resource requests itself, as fix-input.
  expect(
    (
      await send("project", "invalid-project", {
        operation: "replace-project-code",
      })
    ).payload,
  ).toMatchObject({
    ok: false,
    error: { code: "PROJECT_REQUEST_INVALID", recovery: "fix-input" },
  });
  expect(
    (
      await send("file", "invalid-file", {
        operation: "simulation-input",
        input: { action: "read" },
      })
    ).payload,
  ).toMatchObject({ ok: false, error: { code: "FILE_REQUEST_INVALID" } });
  expect(
    (
      await send("simulation", "invalid-simulation", {
        operation: "start",
        preparedId: "missing-digest",
      })
    ).payload,
  ).toMatchObject({
    ok: false,
    error: { code: "SIMULATION_REQUEST_INVALID", recovery: "fix-input" },
  });

  const edit = {
    operation: "transact",
    documentId: "document-main",
    transactionId: "agent-transaction-e2e",
    expectedRevision: 0,
    edits: [
      {
        kind: "add_instance",
        instance: { id: "Ragent", symbolId: "resistor", placement: null },
      },
    ],
  };
  /** Whether the editor has reported an event by this actor. */
  const eventBy = (actorKind: string) =>
    responses.some(
      (message) =>
        message.kind === "event" &&
        (message.payload as { actorKind?: string }).actorKind === actorKind,
    );
  const transaction = await send("circuit", "agent-edit", edit);
  expect(transaction.payload).toMatchObject({
    ok: true,
    operation: "transact",
    applied: true,
    revision: 1,
  });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect.poll(() => eventBy("agent")).toBe(true);
  // A replayed request gets the first answer, not a second edit.
  expect((await send("circuit", "agent-edit", edit)).payload).toEqual(
    transaction.payload,
  );
  await expect(page.getByTestId("revision")).toHaveText("1");

  await page
    .getByTestId("connect-agent-panel")
    .getByRole("button", { name: "Close Agent dialog" })
    .click();
  await page.getByTestId("draw-tool-undo").click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await expect.poll(() => eventBy("human")).toBe(true);

  await page.getByRole("button", { name: "Agent", exact: true }).click();
  const panel = page.getByTestId("connect-agent-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("agent-status")).toContainText("Connected");
  expect(sessionCreates).toBe(1);
  // A replacement revokes the old session; a revoked one is replaced on reopen.
  await panel.getByTestId("agent-new-connection").click();
  await expect.poll(() => sessionCreates).toBe(2);
  await expect.poll(() => revokeControls).toBe(1);
  await expectClaimCode(panel, `${sessionId}.one-time-claim`);
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

test("keeps one paired working copy through Cell switches, a render crash, refresh and Gallery without resuming a pause", async ({
  page,
  baseURL,
}) => {
  let sessionCreates = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/agent/sessions"
    )
      sessionCreates++;
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/editor");
  const { panel, session, agent } = await pairAgent(page, baseURL!);
  const documentId = session.documentIds[0]!;
  const attached = () =>
    expect.poll(async () => (await agent.status()).editor).toBe("attached");
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();

  // Switching Cells keeps the one Project session.
  let manager = await openCellManager(page);
  await manager.getByRole("button", { name: "New Cell" }).click();
  const cellEditor = page.getByRole("dialog", { name: "New Cell" });
  await cellEditor.getByLabel("Cell name").fill("AgentLifecycleCell");
  await cellEditor.getByRole("button", { name: "Create" }).click();
  const childDocumentId = await page
    .getByTestId("active-document-id")
    .innerText();
  expect(childDocumentId).not.toBe(documentId);
  const openCell = async (name: string | RegExp) => {
    manager = await openCellManager(page);
    await manager
      .locator(".cell-manager-list-item")
      .filter({ hasText: name })
      .dblclick();
  };
  await openCell(/Top/u);
  await openCell("AgentLifecycleCell");
  await expect(page.getByTestId("active-document-id")).toHaveText(
    childDocumentId,
  );
  await attached();
  expect(
    await agent.snapshot("cell-switch-snapshot", documentId),
  ).toMatchObject({ ok: true, revision: 0 });
  await openCell(/Top/u);

  // An acknowledged Agent edit and a pause survive a render crash's reload.
  expect(
    await agent.circuit(
      placeResistor(documentId, "crash-durable-edit", "crash-durable-R"),
    ),
  ).toMatchObject({ ok: true, revision: 1 });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByTestId("open-agent").click();
  await panel.getByTestId("agent-pause").click();
  await expect(panel.getByTestId("agent-status")).toHaveText("Paused");
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await page.evaluate(() => {
    window.__ICM_TEST_RENDER_CRASH__ = true;
  });
  await page.keyboard.press("i");
  const crashScreen = page.getByTestId("editor-crash-screen");
  await expect(crashScreen).toBeVisible();
  await crashScreen.getByRole("button", { name: "Reload editor" }).click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByTestId("open-agent").click();
  await expect(panel.getByTestId("agent-status")).toHaveText("Paused");
  expect(await agent.status()).toMatchObject({
    authorization: "paused",
    editor: "attached",
  });
  expect(sessionCreates).toBe(1);

  // The Gallery and back return to the same working copy, still paused.
  await page.goto("/");
  await expect(page.getByTestId("gallery-agent-return")).toHaveCount(0);
  await attached();
  await page.getByTestId("gallery-editor-link").click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByTestId("open-agent").click();
  await expect(panel.getByTestId("agent-status")).toHaveText("Paused");
  await panel.getByTestId("agent-resume").click();
  expect(await agent.snapshot("restored-snapshot", documentId)).toMatchObject({
    ok: true,
    revision: 1,
  });
  await page.goto("/editor?new=1");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await attached();
  expect(sessionCreates).toBe(1);
});

test("publishing by hand notes what an Agent drew, opened or had approved, leaving the AI mark to the person", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(90_000);
  await signIn(
    page,
    sessionUser({ displayName: "Publisher", email: "publisher@example.com" }),
  );
  await page.goto("/editor");
  const { panel, session, agent } = await pairAgent(page, baseURL!);
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  const expectAgentNote = async (noted: boolean) => {
    await page.getByTestId("publish-gallery-button").click();
    await expect(dialog.getByLabel("AI-generated")).not.toBeChecked();
    await expect(dialog.locator("#publish-gallery-ai-note")).toHaveText(
      noted ? "An Agent worked on this Project" : "Shows an AI tag on the card",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
  };
  // Pairing alone is not the Agent's work.
  await expectAgentNote(false);

  await agent.circuit(
    placeResistor(session.documentIds[0]!, "agent-drawing", "agent-R"),
  );
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expectAgentNote(true);

  // A file the Agent opens arrives in a tab of its own, already marked,
  // without asking the person.
  const tabs = page.getByRole("tab");
  expect(
    await agent.files({
      apiVersion: "3.0",
      requestId: "open-staged",
      operation: "open",
      candidateId: await stageSpice(agent, "stage-to-open"),
      background: false,
    }),
  ).toMatchObject({ ok: true, operation: "open" });
  await expect(tabs).toHaveCount(2);
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("agent-file-approval")).toHaveCount(0);
  await expectAgentNote(true);
  // The Agent follows the selected tab and reads its context first.
  await expect
    .poll(async () => (await agent.status()).projectId)
    .not.toBe(session.projectId);

  // So does a file the person approves in place of the open Project.
  expect(
    await agent.files({
      apiVersion: "3.0",
      requestId: "approve-staged",
      operation: "request-approval",
      candidateId: await stageSpice(agent, "stage-to-approve"),
    }),
  ).toMatchObject({ ok: true, approval: "pending-human" });
  await page.getByTestId("agent-file-approve").click();
  await expect(page.getByTestId("status")).toContainText("Accepted Agent");
  await expectAgentNote(true);
  // A file the person rejects changes nothing.
  await agent.status();
  await agent.files({
    apiVersion: "3.0",
    requestId: "reject-staged",
    operation: "request-approval",
    candidateId: await stageSpice(agent, "stage-to-reject"),
  });
  const approval = page.getByTestId("agent-file-approval");
  await expect(approval).toBeVisible();
  const revision = await page.getByTestId("revision").innerText();
  await page.getByTestId("agent-file-reject").click();
  await expect(approval).toHaveCount(0);
  await expect(tabs).toHaveCount(2);
  await expect(page.getByTestId("revision")).toHaveText(revision);

  // A blank Project the Agent opens is not its work yet; renaming it is.
  const blank = await agent.workspace("new-blank", {
    action: "new",
    name: "Blank",
    background: true,
  });
  if (
    !blank.ok ||
    blank.operation !== "workspace" ||
    blank.result.action !== "new"
  )
    throw new Error(JSON.stringify(blank));
  expect(
    await agent.workspace("show-blank", {
      action: "activate",
      workspaceId: blank.result.workspaceId!,
    }),
  ).toMatchObject({ ok: true });
  await expect(tabs).toHaveCount(3);
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await expectAgentNote(false);
  expect(
    await agent.workspace("rename-blank", { action: "rename", name: "Named" }),
  ).toMatchObject({ ok: true, result: { action: "rename", applied: true } });
  await expectAgentNote(true);

  // The tab remembers it with the Project.
  page.on("dialog", (prompt) => void prompt.accept());
  await page.reload();
  await expect(tabs).toHaveCount(3);
  await expectAgentNote(true);
});

test("keeps pairing across Project tabs, rejects old writes and copies through the workspace transaction", async ({
  page,
  baseURL,
}) => {
  await page.goto("/editor?new=1");
  const { panel, client, session, agent } = await pairAgent(page, baseURL!);
  const originalContext = client.contextRevision;
  const write = placeResistor(
    session.documentIds[0]!,
    "workspace-source",
    "workspace-R",
  );
  expect(await agent.circuit(write)).toMatchObject({ ok: true });
  const sourceSnapshot = () =>
    agent.snapshot("workspace-source-snapshot", session.documentIds[0]!);
  expect(await sourceSnapshot()).toMatchObject({ ok: true, revision: 1 });
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  // Use the original context explicitly: this may have the same logical Project/Cell IDs.
  const rejected = await page.request.post(
    `${baseURL}/api/agent/sessions/${session.sessionId}/circuit`,
    {
      headers: {
        authorization: `Bearer ${session.agentToken}`,
        "x-agent-context": originalContext!,
      },
      data: {
        ...write,
        requestId: "stale-workspace-write",
        transactionId: "stale-workspace-write",
      },
    },
  );
  expect(await rejected.json()).toMatchObject({
    error: { code: "PROJECT_CONTEXT_STALE" },
  });
  const activeStatus = await agent.status();
  expect(activeStatus).toMatchObject({
    authorization: "active",
    editor: "attached",
  });
  const switchedContext = client.contextRevision;
  expect(
    await agent.snapshot(
      "workspace-target-snapshot",
      activeStatus.documentIds[0]!,
    ),
  ).toMatchObject({ ok: true, operation: "snapshot", revision: 0 });
  expect(client.contextRevision).toBe(switchedContext);
  const list = listed(
    await agent.workspaceRequest("workspace-list", { action: "list" }),
  );
  expect(list.projects).toHaveLength(2);
  const target = list.projects.find(
    (p) => p.workspaceId === list.activeWorkspaceId,
  )!;
  const source = list.projects.find(
    (p) => p.workspaceId !== target.workspaceId,
  )!;
  // The Agent can continue editing the first working copy while the human
  // keeps the second Project on screen, even with an old foreground context.
  client.workspaceId = source.workspaceId;
  client.contextRevision = originalContext;
  // A request ID used in another scope is refused, not replayed into this one.
  await expect(sourceSnapshot()).rejects.toMatchObject({
    code: "REQUEST_ID_REUSED",
  });
  const backgroundSnapshot = await agent.snapshot(
    "workspace-background-snapshot",
    source.cells[0]!.documentId,
  );
  expect(backgroundSnapshot).toMatchObject({
    ok: true,
    operation: "snapshot",
    revision: 1,
  });
  const backgroundEdit = await agent.circuit(
    placeResistor(
      source.cells[0]!.documentId,
      "workspace-background-edit",
      "workspace-background-R",
      { expectedRevision: 1, x: 500 },
    ),
  );
  expect(backgroundEdit).toMatchObject({
    ok: true,
    applied: true,
    revision: 2,
  });
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  client.workspaceId = undefined;
  client.contextRevision = switchedContext;
  const copy = await agent.workspaceRequest("workspace-copy", {
    action: "copy",
    sourceWorkspaceId: source.workspaceId,
    sourceDocumentId: source.cells[0]!.documentId,
    sourceRevision: 2,
    sourceStructureRevision: source.structureRevision,
    targetWorkspaceId: target.workspaceId,
    targetDocumentId: target.cells[0]!.documentId,
    expectedRevision: target.cells[0]!.revision,
    expectedStructureRevision: target.structureRevision,
    offset: { x: 100, y: 100 },
  });
  expect(copy).toMatchObject({
    ok: true,
    result: {
      action: "copy",
      instanceIds: [expect.any(String), expect.any(String)],
      mapping: {
        objects: { instances: { "workspace-R": expect.any(String) } },
      },
    },
  });
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  expect(
    await agent.workspaceRequest("workspace-activate", {
      action: "activate",
      workspaceId: source.workspaceId,
    }),
  ).toMatchObject({ ok: true });
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
  // In its own tab, the person undoes the Agent's background edit.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page
    .locator(".project-tab")
    .first()
    .getByRole("button", { name: /Close tab/u })
    .click();
  await page.getByRole("button", { name: "Close without saving" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  client.workspaceId = source.workspaceId;
  expect(
    await agent.snapshot(
      "closed-workspace-snapshot",
      source.cells[0]!.documentId,
    ),
  ).toMatchObject({ ok: false, error: { code: "WORKSPACE_NOT_FOUND" } });
  client.workspaceId = undefined;

  // A blank scratch copy and a name for each copy, without the GUI.
  const tabs = page.getByRole("tab");
  const created = await agent.workspace("workspace-new", {
    action: "new",
    name: "Scratch RC",
    background: true,
  });
  if (
    !created.ok ||
    created.operation !== "workspace" ||
    created.result.action !== "new"
  )
    throw new Error(JSON.stringify(created));
  const scratch = created.result.workspaceId!;
  await expect(tabs).toHaveCount(2);
  // In the background: the human's tab stays selected.
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(tabs.last()).toContainText("Scratch RC");
  expect(
    await agent.workspace("workspace-rename-background", {
      action: "rename",
      workspaceId: scratch,
      name: "Telescopic redraw",
    }),
  ).toMatchObject({
    ok: true,
    result: { action: "rename", applied: true, workspaceId: scratch },
  });
  await expect(tabs.last()).toContainText("Telescopic redraw");
  // The bound (here the active) copy is renamed as the Project menu does.
  expect(
    await agent.workspace("workspace-rename-active", {
      action: "rename",
      name: "Differential pair",
    }),
  ).toMatchObject({ ok: true, result: { action: "rename", applied: true } });
  await expect(page.getByTestId("project-menu-toggle")).toHaveAttribute(
    "title",
    "Differential pair",
  );
  const names = listed(
    await agent.workspace("workspace-names", { action: "list" }),
  );
  expect(names.projects.map((project) => project.name)).toEqual([
    "Differential pair",
    "Telescopic redraw",
  ]);
  expect(
    await agent.workspace("workspace-rename-blank", {
      action: "rename",
      name: " ",
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
});

// The old "rebinds" journey: an Agent-opened Project with the same Cell ID.
test("after an Agent opens a Project with the same Cell ID, an unnamed write goes to the shown one and leaves the first intact", async ({
  page,
  baseURL,
}) => {
  await page.goto("/editor?new=1");
  const { client, session, agent } = await pairAgent(page, baseURL!);
  const documentId = session.documentIds[0]!;
  const firstContext = client.contextRevision;
  expect(
    await agent.circuit(placeResistor(documentId, "first-place", "first-R")),
  ).toMatchObject({ ok: true, applied: true });
  const bytes = Buffer.from(
    serializeProject(createEmptyProject("binding-second", "Second Project")),
  );
  const staged = await agent.files({
    apiVersion: "3.0",
    requestId: "stage-second-project",
    operation: "stage",
    kind: "project",
    files: [stagedFile("second.icproj.json", "application/json", bytes)],
  });
  if (!staged.ok || staged.operation !== "stage")
    throw new Error(JSON.stringify(staged));
  expect(
    await agent.files({
      apiVersion: "3.0",
      requestId: "open-second-project",
      operation: "open",
      candidateId: staged.candidate.candidateId,
    }),
  ).toMatchObject({ ok: true, operation: "open" });
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await expect
    .poll(async () => {
      await agent.status();
      return client.contextRevision;
    })
    .not.toBe(firstContext);
  const current = await agent.status();
  expect(current.documentIds[0]).toBe(documentId);
  expect(
    await agent.circuit(placeResistor(documentId, "second-place", "second-R")),
  ).toMatchObject({ ok: true, applied: true });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  const first = listed(
    await agent.workspace("list-first", { action: "list" }),
  ).projects.find((project) => project.projectId === session.projectId)!;
  client.workspaceId = first.workspaceId;
  const snapshot = await agent.snapshot("first-snapshot", documentId);
  if (!snapshot.ok || !("snapshot" in snapshot))
    throw new Error(JSON.stringify(snapshot));
  expect(snapshot.snapshot.document.instances.map(({ id }) => id)).toEqual([
    "first-R",
  ]);
});

test("workspace Cloud operations reuse GUI open validation, save conflicts and Save As", async ({
  page,
  baseURL,
}) => {
  const project = createEmptyProject("cloud-project", "Cloud source");
  const record = {
    id: "cloud-source",
    name: project.name,
    revision: 1,
    schemaVersion: project.schemaVersion,
    updatedAt: "2026-09-22T00:00:00.000Z",
    projectText: serializeProject(project),
  };
  const writes: string[] = [];
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { projects: [record] } });
    writes.push("new");
    return route.fulfill({
      json: {
        project: {
          ...record,
          id: writes.length === 2 ? "cloud-copy" : "cloud-background-copy",
          ...route.request().postDataJSON(),
        },
      },
    });
  });
  await page.route("**/api/projects/cloud-source", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { project: record } });
    writes.push("conflict");
    expect(route.request().headers()["if-match"]).toBe("revision-1");
    return route.fulfill({
      status: 409,
      json: { error: "revision-conflict", project: { ...record, revision: 2 } },
    });
  });
  await page.route("**/api/projects/cloud-invalid", (route) =>
    route.fulfill({
      json: {
        project: {
          ...record,
          id: "cloud-invalid",
          projectText: "not a project",
        },
      },
    }),
  );
  await page.goto("/editor?new=1");
  const { panel, client, agent } = await pairAgent(page, baseURL!);
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  let requestNumber = 0;
  const workspace = (request: WorkspaceRequest) =>
    agent.workspaceRequest(`cloud-${++requestNumber}`, request);
  expect(
    await workspace({ action: "open", cloudProjectId: "cloud-invalid" }),
  ).toMatchObject({ ok: false });
  await expect(page.getByRole("tab")).toHaveCount(1);
  const oldContext = client.contextRevision;
  const openedInBackground = await workspace({
    action: "open",
    cloudProjectId: "cloud-source",
    background: true,
  });
  expect(openedInBackground).toMatchObject({
    ok: true,
    result: { action: "open", workspaceId: expect.any(String) },
  });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(client.contextRevision).toBe(oldContext);
  expect(
    await workspace({ action: "open", cloudProjectId: "cloud-source" }),
  ).toMatchObject({ ok: true });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect
    .poll(async () => (await agent.status()).contextRevision)
    .not.toBe(oldContext);
  expect(await workspace({ action: "save" })).toMatchObject({
    ok: false,
    error: { code: "CLOUD_SAVE_CONFLICT" },
  });
  expect(await workspace({ action: "save", asNew: true })).toMatchObject({
    ok: true,
    result: { project: { id: "cloud-copy" } },
  });
  const backgroundId = listed(
    await workspace({ action: "list" }),
  ).projects.find((item) => item.cloudProjectId === "cloud-copy")!.workspaceId;
  await page.getByRole("tab").first().click();
  await agent.status();
  client.workspaceId = backgroundId;
  expect(await workspace({ action: "save", asNew: true })).toMatchObject({
    ok: true,
    result: { project: { id: "cloud-background-copy" } },
  });
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(writes).toEqual(["conflict", "new", "new"]);
  client.workspaceId = undefined;
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
  const { claimCode } = await readAgentClaim(panel);
  await panel.getByTestId("agent-copy-instructions").click();
  await expect(panel.getByLabel("Connection setup copied")).toBeVisible();
  const handoff = await page.evaluate(() => navigator.clipboard.readText());
  // Windows clipboard text uses CRLF; textarea values use LF on every OS.
  expect(handoff.replaceAll("\r\n", "\n")).toBe(
    await panel.getByTestId("agent-copy-text").inputValue(),
  );
  expect(handoff).toContain(`Connect to Analog Canvas at ${baseURL}.`);
  const kitUrl = `${baseURL}/api/agent/kit`;
  expect(handoff).toContain(kitUrl);
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

  const client = new AgentHttpClient({ baseUrl: baseURL! });
  const session = await client.claim(claimCode);
  const agent = boundTo(client, session);
  const readIdleDeadline = () =>
    page.evaluate(() => {
      const record = JSON.parse(
        sessionStorage.getItem("icm.agent-session-recovery.v1") ?? "null",
      );
      return record?.expiresAt ?? 0;
    });
  const documentId = session.documentIds[0]!;
  const snapshot = await agent.snapshot("local-before", documentId);
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
            await agent.snapshot(`after-reconnect-${Date.now()}`, documentId)
          ).ok;
        } catch {
          return false;
        }
      },
      { timeout: 8_000 },
    )
    .toBe(true);
  await expect(panel.getByTestId("agent-status")).toHaveText("Connected");
  const transaction = await agent.circuit({
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
          ...placedInstance("Rlocal", "resistor", 300, 200),
          reference: "R1",
          netlist: { parameters: { value: "1k" } },
        },
      },
    ],
  });
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
    await awaitEditorReady(siblingPage);
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
    const result = await agent.snapshot(requestId, documentId);
    if (
      !result.ok ||
      result.operation !== "snapshot" ||
      !("snapshot" in result)
    )
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
    agent.circuit({
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
  expect((await readComponentCode(page)).parameters.value).toBe("3.3k");

  // Both writers share history without disconnecting or freezing the canvas.
  // Further GUI edits an Agent reads are agent-capability-parity tests.
  await page.getByTestId("draw-tool-undo").click();
  expect((await readComponentCode(page)).parameters.value).toBe("2.2k");
  await page.getByTestId("open-agent").click();
  await expect(panel.getByTestId("agent-status")).toContainText("Connected");
  await panel.getByTestId("agent-revoke").click();
  await expect(panel.getByTestId("agent-status")).toContainText("Disconnected");
  await expect(
    agent.snapshot("local-after-revoke", documentId),
  ).rejects.toThrow();
  await panel.getByRole("button", { name: "Close Agent dialog" }).click();
  await page.getByTestId("draw-tool-undo").click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
});

test("keeps browser recovery on the renewed idle deadline and expires after inactivity", async ({
  page,
}) => {
  const start = Date.now();
  const idleMs = 30 * 60_000;
  let deadline = start + idleMs;
  let creates = 0;
  let attachments = 0;
  let expired = false;
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
      json: createdSession(
        "idle-browser",
        "editor-secret",
        start + idleMs,
        deadline,
      ),
    });
  });
  await page.routeWebSocket(
    "**/api/agent/sessions/idle-browser/editor",
    (route) => {
      attachments += 1;
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
  await page.route("**/api/agent/sessions/idle-browser/status", (route) => {
    expect(route.request().headers()["x-editor-secret"]).toBe("editor-secret");
    return route.fulfill({
      status: expired ? 410 : 200,
      json: expired
        ? { ok: false, error: { code: "SESSION_EXPIRED" } }
        : { ok: true, authorization: "active", expiresAt: deadline },
    });
  });
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
  // A background scheduling gap must probe, not replace a healthy socket.
  await page.clock.setFixedTime(start + 120_000);
  await page.evaluate(() => document.dispatchEvent(new Event("resume")));
  await page.clock.runFor(6_000);
  await expect(page.getByTestId("agent-status")).toHaveText("Connected");
  expect(attachments).toBe(1);
  await page.clock.setFixedTime(start + 29 * 60_000);
  deadline = start + 59 * 60_000;
  sendEvent("session.renewed");
  await expect.poll(async () => (await recovery())?.expiresAt).toBe(deadline);
  // Crossing the initial deadline must not close the session or erase recovery.
  await page.clock.setFixedTime(start + 31 * 60_000);
  await page.clock.runFor(1_100);
  await expect(page.getByTestId("agent-status")).toHaveText("Connected");
  // A saved local deadline can lag a lease renewed by the Agent.
  await page.evaluate(() => {
    const key = "icm.agent-session-recovery.v1";
    const saved = JSON.parse(sessionStorage.getItem(key)!);
    saved.expiresAt = Date.now() - 1;
    sessionStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await page.getByTestId("open-agent").click();
  await expect(page.getByTestId("agent-status")).toHaveText("Connected");
  expect(creates).toBe(1);
  await expect.poll(async () => (await recovery())?.expiresAt).toBe(deadline);
  // Passive heartbeats must not extend the deadline on the browser.
  expired = true;
  await page.clock.setFixedTime(deadline);
  await page.clock.runFor(15_100);
  await expect(page.getByTestId("agent-status")).toHaveText("Session expired");
  expect(await recovery()).toBeNull();
});
