// The workspace Agent provider as the editor uses it, with the Agent
// runtime's chunk load as the one scripted boundary (#1673). The runtime
// itself is the real one; the relay's answers are scripted at fetch, and
// React runs against a minimal stand-in for the page's DOM.
import { act, useMemo } from "react";
import type { Root } from "react-dom/client";
import { createEmptyProject } from "@icm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorDocumentController } from "../document/document-controller";
import { loadAgentRuntime, type AgentRuntime } from "./agent-runtime-loader";
import * as runtimeFixture from "./agent-runtime";
import { AGENT_SESSION_RECOVERY_STORAGE_KEY } from "./session-recovery-presence";
import type { UseAgentSessionResult } from "./use-agent-session";
import {
  useEditorAgentSession,
  useWorkspaceAgentRuntime,
  WorkspaceAgentProvider,
} from "./workspace-agent";

vi.mock("./agent-runtime-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-runtime-loader")>()),
  loadAgentRuntime: vi.fn(),
  loadedAgentRuntime: () => null,
}));

// Compile the real fixture before test timing starts. The scripted loader
// below still controls whether and when the provider receives the runtime.
const realRuntime = async () => runtimeFixture;
const project = createEmptyProject("project-main", "Main");

/** A sessionStorage the test can read back. */
class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

/** A relay socket that never opens: the tests stop at the claim. */
class ClosedSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  addEventListener(_type: string, _listener: (event: unknown) => void) {}
  removeEventListener() {}
  send() {}
  close() {
    this.readyState = 3;
  }
}

/** A relay socket the test opens and speaks through. */
class ScriptedSocket extends ClosedSocket {
  static readonly opened: ScriptedSocket[] = [];
  private readonly listeners = new Map<
    string,
    Array<(event: unknown) => void>
  >();
  constructor() {
    super();
    ScriptedSocket.opened.push(this);
  }
  override addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: unknown = {}) {
    if (type === "open") this.readyState = 1;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

let storage: MemoryStorage;
let sessionCreations: number;
let root: Root | null;
let seen: { session: UseAgentSessionResult | null };
let accountProjectsOpen: boolean;

function relay(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url === "/api/agent/sessions" && init?.method === "POST") {
    sessionCreations += 1;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          session: {
            sessionId: `session-${sessionCreations}`,
            editorSecret: "editor-secret",
            claimCode: `CLAIM-${sessionCreations}`,
            claimExpiresAt: Date.now() + 600_000,
            expiresAt: Date.now() + 3_600_000,
          },
        }),
        { status: 201, headers: { date: new Date().toUTCString() } },
      ),
    );
  }
  return Promise.resolve(new Response("{}", { status: 503 }));
}

beforeEach(() => {
  storage = new MemoryStorage();
  sessionCreations = 0;
  seen = { session: null };
  accountProjectsOpen = false;
  root = null;
  const page = {
    location: { href: "http://127.0.0.1/editor", search: "" },
    sessionStorage: storage,
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
    setInterval,
    clearInterval,
  };
  const document = {
    nodeType: 9,
    activeElement: null,
    visibilityState: "visible",
    defaultView: page,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("window", page);
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLIFrameElement", page.HTMLIFrameElement);
  vi.stubGlobal("WebSocket", ClosedSocket);
  vi.stubGlobal("fetch", vi.fn(relay));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The chunk failure is logged for diagnosis; the test reads the panel.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(loadAgentRuntime).mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The editor's part: build hosts once the runtime is there, and bind them. */
function Editor() {
  const runtime = useWorkspaceAgentRuntime();
  const host = useMemo(
    () =>
      runtime
        ? new runtime.BrowserAgentHost(new EditorDocumentController(project))
        : null,
    [runtime],
  );
  seen.session = useEditorAgentSession(
    host
      ? {
          enabled: true,
          recover: true,
          project,
          projectSessionId: "tab-1",
          host,
          hasAccountProjects: () => accountProjectsOpen,
        }
      : null,
  );
  return null;
}

async function openEditor() {
  const container = {
    nodeType: 1,
    nodeName: "DIV",
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  const { createRoot } = await import("react-dom/client");
  root = createRoot(container as unknown as Element);
  await act(async () =>
    root!.render(
      <WorkspaceAgentProvider enabled>
        <Editor />
      </WorkspaceAgentProvider>,
    ),
  );
}

/** What the Connect Agent control does on a session that is not connected. */
async function clickConnect() {
  await act(async () => void seen.session!.newConnection());
}

/** Let loads, effects and the relay's answers run. */
async function settle(until: () => void) {
  await vi.waitFor(async () => {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    until();
  });
}

function deferredRuntime() {
  let release!: () => Promise<void>;
  vi.mocked(loadAgentRuntime).mockImplementationOnce(
    () =>
      new Promise<AgentRuntime>((resolve) => {
        release = async () => resolve(await realRuntime());
      }),
  );
  return () => release();
}

describe("workspace Agent provider (#1673)", () => {
  it("loads nothing for an editor that is not connecting", async () => {
    await openEditor();
    expect(seen.session).toMatchObject({
      status: "idle",
      pendingOperation: null,
      error: null,
    });
    expect(loadAgentRuntime).not.toHaveBeenCalled();
  });

  it("loads the runtime on Connect Agent and connects once the editor binds", async () => {
    const release = deferredRuntime();
    await openEditor();
    await clickConnect();
    // Preparing, as the moment Connect started a connection before.
    expect(seen.session).toMatchObject({
      status: "creating",
      pendingOperation: "creating",
    });
    expect(loadAgentRuntime).toHaveBeenCalledOnce();
    await act(release);
    await settle(() => expect(seen.session!.claimCode).toBe("CLAIM-1"));
    expect(sessionCreations).toBe(1);
    expect(seen.session!.status).not.toBe("idle");
  });

  it("stops showing the Claim once an Agent redeemed it", async () => {
    vi.stubGlobal("WebSocket", ScriptedSocket);
    ScriptedSocket.opened.length = 0;
    vi.mocked(loadAgentRuntime).mockImplementationOnce(realRuntime);
    await openEditor();
    await clickConnect();
    await settle(() => expect(seen.session!.claimCode).toBe("CLAIM-1"));
    await settle(() => expect(ScriptedSocket.opened).toHaveLength(1));
    const socket = ScriptedSocket.opened[0]!;
    await act(async () => socket.emit("open"));
    await act(async () =>
      socket.emit("message", {
        data: JSON.stringify({
          protocolVersion: "1.0",
          sessionId: "session-1",
          messageId: "ready-1",
          requestId: "event-ready-1",
          sentAt: new Date().toISOString(),
          kind: "event",
          payload: { type: "session.ready", sessionId: "session-1" },
        }),
      }),
    );
    await settle(() =>
      expect(seen.session).toMatchObject({
        claimCode: null,
        claimExpiresAt: null,
      }),
    );
    expect(seen.session!.status).not.toBe("waiting-for-agent");
  });

  it("shows a runtime that could not load, then retries on the next click", async () => {
    vi.mocked(loadAgentRuntime).mockRejectedValueOnce(
      new TypeError("Failed to fetch dynamically imported module"),
    );
    await openEditor();
    await clickConnect();
    await settle(() =>
      expect(seen.session).toMatchObject({
        status: "idle",
        pendingOperation: null,
        error: expect.stringContaining("The Agent connection could not load"),
      }),
    );
    expect(sessionCreations).toBe(0);

    vi.mocked(loadAgentRuntime).mockImplementationOnce(realRuntime);
    await clickConnect();
    expect(seen.session).toMatchObject({ status: "creating", error: null });
    await settle(() => expect(seen.session!.claimCode).toBe("CLAIM-1"));
    expect(sessionCreations).toBe(1);
  });

  it("starts no connection when cancelled while preparing", async () => {
    const release = deferredRuntime();
    await openEditor();
    await clickConnect();
    expect(seen.session!.status).toBe("creating");
    // Cancel connection.
    await act(async () => void seen.session!.revoke());
    expect(seen.session).toMatchObject({
      status: "idle",
      pendingOperation: null,
    });
    await act(release);
    await settle(() => expect(seen.session!.status).toBe("idle"));
    expect(sessionCreations).toBe(0);
  });

  it("resumes a saved session rather than replacing it when Connect loads the runtime", async () => {
    const saved = {
      version: 1,
      sessionId: "saved-session",
      editorSecret: "editor-secret",
      projectId: "project-main",
      projectSessionId: "tab-1",
      scopes: ["circuit.snapshot"],
      expiresAt: Date.now() + 3_600_000,
    };
    storage.setItem(AGENT_SESSION_RECOVERY_STORAGE_KEY, JSON.stringify(saved));
    // The load the saved session starts as the page opens fails.
    vi.mocked(loadAgentRuntime).mockRejectedValueOnce(
      new TypeError("Failed to fetch dynamically imported module"),
    );
    await openEditor();
    await settle(() =>
      expect(seen.session!.error).toContain(
        "The Agent connection could not load",
      ),
    );

    vi.mocked(loadAgentRuntime).mockImplementationOnce(realRuntime);
    await clickConnect();
    await settle(() => expect(seen.session!.status).toBe("reconnecting"));
    // Let the bound editor's effects and the resume run their course.
    for (let tick = 0; tick < 5; tick++) await settle(() => {});
    expect(seen.session!.status).toBe("reconnecting");
    expect(sessionCreations).toBe(0);
    expect(
      JSON.parse(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)!),
    ).toMatchObject({ sessionId: "saved-session" });
  });

  it.each([true, false])(
    "checks account Project access with local review restriction %s",
    async (localReviewOnly) => {
      storage.setItem(
        AGENT_SESSION_RECOVERY_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          sessionId: "saved-session",
          editorSecret: "editor-secret",
          projectId: "project-main",
          projectSessionId: "tab-1",
          scopes: ["circuit.snapshot"],
          expiresAt: Date.now() + 3_600_000,
          ...(localReviewOnly ? { localReviewOnly } : {}),
        }),
      );
      const fetchRelay = vi.fn(
        (input: RequestInfo | URL, init?: RequestInit) =>
          String(input) === "/api/agent/sessions/saved-session/control"
            ? Promise.resolve(new Response("{}", { status: 200 }))
            : relay(input, init),
      );
      vi.stubGlobal("fetch", fetchRelay);
      vi.stubGlobal("WebSocket", ScriptedSocket);
      ScriptedSocket.opened.length = 0;
      vi.mocked(loadAgentRuntime).mockImplementationOnce(realRuntime);
      await openEditor();
      await settle(() => expect(ScriptedSocket.opened).toHaveLength(1));
      const socket = ScriptedSocket.opened[0]!;
      await act(async () => socket.emit("open"));
      accountProjectsOpen = true;
      await act(async () =>
        socket.emit("message", {
          data: JSON.stringify({
            protocolVersion: "1.0",
            sessionId: "saved-session",
            messageId: "ready-1",
            requestId: "event-ready-1",
            sentAt: new Date().toISOString(),
            kind: "event",
            payload: { type: "session.ready", sessionId: "saved-session" },
          }),
        }),
      );
      if (localReviewOnly) {
        expect(seen.session!.status).toBe("revoked");
        expect(fetchRelay).toHaveBeenCalledWith(
          "/api/agent/sessions/saved-session/control",
          expect.objectContaining({ body: '{"action":"revoke"}' }),
        );
        expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).toBeNull();
      } else {
        expect(seen.session!.status).not.toBe("revoked");
        expect(
          storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY),
        ).not.toBeNull();
      }
    },
  );

  it("stops trusting the device from its trusted tab, which ends the task", async () => {
    storage.setItem(
      AGENT_SESSION_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        sessionId: "saved-session",
        editorSecret: `proof-${crypto.randomUUID()}`,
        projectId: "project-main",
        projectSessionId: "tab-1",
        scopes: ["circuit.snapshot"],
        expiresAt: Date.now() + 3_600_000,
        localReviewOnly: true,
      }),
    );
    let refuse = true;
    const fetchRelay = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === "/api/agent/sessions/saved-session/control"
        ? Promise.resolve(
            refuse
              ? new Response(null, { status: 503 })
              : Response.json({ ok: true, status: "revoked" }),
          )
        : relay(input, init),
    );
    vi.stubGlobal("fetch", fetchRelay);
    vi.stubGlobal("WebSocket", ScriptedSocket);
    ScriptedSocket.opened.length = 0;
    vi.mocked(loadAgentRuntime).mockImplementationOnce(realRuntime);
    await openEditor();
    await settle(() => expect(ScriptedSocket.opened).toHaveLength(1));
    await act(async () => ScriptedSocket.opened[0]!.emit("open"));
    expect(seen.session!.trustedDevice).toBe(true);

    // A relay that cannot change the trust leaves the task running.
    await act(async () => seen.session!.untrustDevice());
    expect(seen.session!.error).toContain("Trusted Canvas devices");
    expect(seen.session!.status).not.toBe("revoked");
    refuse = false;
    await act(async () => seen.session!.untrustDevice());
    expect(fetchRelay).toHaveBeenCalledWith(
      "/api/agent/sessions/saved-session/control",
      expect.objectContaining({ body: '{"action":"untrust-device"}' }),
    );
    expect(seen.session!.status).toBe("revoked");
    expect(seen.session!.error).toBeNull();
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).toBeNull();
  });
});
