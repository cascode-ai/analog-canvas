import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  AGENT_MCP_VERSION,
  AgentSessionScopeSchema,
  agentSiteSessionId,
} from "@icm/agent-adapter";
import {
  BROWSER_LAUNCH_GRANT_PREFIX,
  BROWSER_LAUNCH_PENDING_PROJECT,
  BROWSER_LAUNCH_TTL_MS,
} from "@icm/agent-adapter/browser-launch";
import {
  AgentHttpClient,
  AgentSessionClient,
  AgentSessionError,
} from "@icm/agent-client";
import {
  handOffToBrowser,
  openSystemBrowser,
  type BrowserOpener,
} from "./browser-launch.js";
import type { OperationSession } from "./operation-session.js";
import { browserDeviceProof } from "./browser-device.js";

const CreatedSession = z.object({
  ok: z.literal(true),
  session: z.object({
    sessionId: z.string().regex(/^[0-9a-f]{8}_[0-9a-f-]{36}$/u),
    launchGrant: z
      .string()
      .startsWith(BROWSER_LAUNCH_GRANT_PREFIX)
      .regex(/^launch-[0-9a-f-]{36}$/u),
    claimCode: z.string().min(1),
  }),
});

type EditorReadiness = "attached" | "detached" | "no-project" | "expired";
type LaunchReceipt = {
  taskRef: string;
  origin: string;
  browser: "not-requested" | "requested" | "opened" | "reused";
  authorization:
    | "pending"
    | "active"
    | "paused"
    | "revoked"
    | "expired"
    | "ended"
    | "unknown";
  projectRead: "not-read" | "ready" | "failed";
  sessionId?: string;
  recovery?: "previous-project-unconfirmed";
};

type Binding = {
  sessionId: string;
  operation: OperationSession;
  openedAt: number;
  ready: boolean;
  paused: boolean;
};

type Task = {
  binding?: Binding;
  opening?: Promise<unknown>;
  used: boolean;
  ended?: CanvasTaskError;
  inFlight: number;
};

function failed(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    (result as { ok?: unknown }).ok === false
  );
}

export class CanvasTaskError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const OPEN_CALL_WAIT_MS = 18_000;
const RECONNECT_GRACE_MS = 3_500;

function revoked(): CanvasTaskError {
  return new CanvasTaskError(
    "SESSION_REVOKED",
    "The user revoked this Canvas task in the browser. Ask before reconnecting: open_canvas without a taskRef starts a new task that needs a fresh approval.",
  );
}

/** Each task owns a browser session, client, and its own operation state. */
export class WebTasks {
  private readonly tasks = new Map<string, Task>();
  private readonly origin: string;

  constructor(
    apiBaseUrl: string,
    private readonly settings: Pick<
      OperationSession,
      "apiBaseUrlDefaulted" | "workspaceRoot" | "taskDirectory"
    >,
    private readonly openBrowser: BrowserOpener = openSystemBrowser,
    private readonly deviceKeyPath?: string,
  ) {
    this.origin = new URL(apiBaseUrl).origin;
  }

  get hasTasks(): boolean {
    return [...this.tasks.values()].some(
      (task) => !!task.binding || !!task.opening || task.used,
    );
  }

  async withSession<T>(
    taskRef: string,
    operation: (session: OperationSession) => Promise<T>,
    disconnect = false,
  ): Promise<T> {
    const task = this.task(taskRef);
    if (task.ended) throw task.ended;
    if (task.opening || (disconnect && task.inFlight))
      throw new CanvasTaskError(
        "CANVAS_TASK_BUSY",
        "The Canvas task has a call in flight.",
      );
    if (!task.binding?.ready)
      throw new CanvasTaskError(
        "CANVAS_TASK_NOT_READY",
        "Call open_canvas with this taskRef and confirm the Project is ready.",
      );
    if (disconnect)
      task.ended = new CanvasTaskError(
        "SESSION_REVOKED",
        "This Canvas task was disconnected.",
      );
    task.inFlight++;
    try {
      const result = await operation(task.binding.operation);
      // A call that met the browser's revocation leaves the client revoked;
      // one that failed before reaching the relay asks it. The task ends with
      // the revocation, whatever the call's own error said.
      if (!task.ended) {
        const status = await task.binding.operation.client
          .status(failed(result) ? { refresh: true } : {})
          .catch(() => null);
        if (status?.state === "revoked") task.ended = revoked();
      }
      if (task.ended && !disconnect && failed(result)) throw task.ended;
      return result;
    } finally {
      task.inFlight--;
    }
  }

  async open(existingRef?: string): Promise<unknown> {
    const taskRef = existingRef ?? randomUUID();
    const task: Task = existingRef
      ? this.task(existingRef)
      : { used: false, inFlight: 0 };
    if (!existingRef) this.tasks.set(taskRef, task);
    if (task.opening) return task.opening;
    if (task.inFlight)
      throw new CanvasTaskError(
        "CANVAS_TASK_BUSY",
        "The Canvas task has a call in flight.",
      );
    const opening = this.openTask(taskRef, task);
    task.opening = opening;
    try {
      return await opening;
    } finally {
      delete task.opening;
    }
  }

  private task(taskRef: string): Task {
    const task = this.tasks.get(taskRef);
    if (!task)
      throw new CanvasTaskError(
        "CANVAS_TASK_NOT_FOUND",
        "This taskRef does not belong to this running connector.",
      );
    return task;
  }

  private async openTask(taskRef: string, task: Task) {
    const startedAt = performance.now();
    const receipt: LaunchReceipt = {
      taskRef,
      origin: this.origin,
      browser: "not-requested",
      authorization: "pending",
      projectRead: "not-read",
    };
    const result = () => ({
      ...receipt,
      elapsedMs: Math.round(performance.now() - startedAt),
    });

    try {
      if (task.ended) throw task.ended;
      let binding = task.binding;
      let readiness: EditorReadiness = "detached";
      if (binding) {
        receipt.sessionId = binding.sessionId;
        receipt.browser = binding.ready ? "reused" : "requested";
        readiness = await this.status(binding);
        if (binding.ready && readiness === "detached") {
          const retryUntil = performance.now() + RECONNECT_GRACE_MS;
          while (readiness === "detached" && performance.now() < retryUntil) {
            await delay(500);
            readiness = await this.status(binding);
          }
        }
        if (
          readiness === "detached" &&
          (binding.ready ||
            performance.now() - binding.openedAt > BROWSER_LAUNCH_TTL_MS)
        ) {
          // The relay checks again atomically, in case the tab reattached or
          // the user paused it after the last status response.
          if (await binding.operation.client.retireDetached()) {
            delete task.binding;
            binding = undefined;
          } else {
            readiness = await this.status(binding);
            if (readiness === "detached")
              throw new CanvasTaskError(
                "EDITOR_OFFLINE",
                "The tab has not confirmed that it closed. Retry with this taskRef after it reconnects, or authorize a new task if you closed it while offline.",
              );
          }
        }
        if (readiness === "expired") {
          delete task.binding;
          binding = undefined;
        }
      }
      if (!binding) {
        binding = await this.start(taskRef);
        task.binding = binding;
        receipt.sessionId = binding.sessionId;
        receipt.browser = "requested";
        readiness = await this.status(binding);
      }
      if (task.used && !binding.ready)
        receipt.recovery = "previous-project-unconfirmed";
      while (
        (readiness === "detached" ||
          (!binding.ready && readiness === "no-project")) &&
        performance.now() - startedAt < OPEN_CALL_WAIT_MS
      ) {
        await delay(600);
        readiness = await this.status(binding);
      }
      if (readiness === "expired")
        throw new CanvasTaskError(
          "SESSION_EXPIRED",
          "The Canvas launch expired. Call open_canvas again with this taskRef.",
        );
      if (readiness === "detached")
        throw new CanvasTaskError(
          "CANVAS_APPROVAL_PENDING",
          "Confirm access in the browser, then call open_canvas with this taskRef.",
        );

      if (receipt.browser === "requested") receipt.browser = "opened";
      receipt.authorization = "active";
      receipt.projectRead = "failed";
      if (readiness === "no-project")
        throw new CanvasTaskError(
          "NO_ACTIVE_PROJECT",
          "The authorized Canvas tab has no active Project.",
        );
      const connection = await this.readProject(binding);
      receipt.projectRead = "ready";
      binding.ready = true;
      task.used = true;
      return {
        ok: true,
        ...result(),
        context: connection.context,
        scopes: connection.scopes,
      };
    } catch (error) {
      const failure =
        error instanceof CanvasTaskError
          ? error
          : new CanvasTaskError(
              error instanceof AgentSessionError
                ? error.code
                : "CANVAS_LAUNCH_FAILED",
              "The Canvas connection could not be verified. Retry with the same taskRef.",
            );
      if (
        [
          "SESSION_REVOKED",
          "SESSION_TAKEN_OVER",
          "CANVAS_SESSION_ENDED",
        ].includes(failure.code)
      ) {
        task.ended = failure;
        receipt.authorization =
          failure.code === "CANVAS_SESSION_ENDED" ? "ended" : "revoked";
      } else if (failure.code === "SESSION_PAUSED") {
        receipt.authorization = "paused";
      } else if (failure.code === "SESSION_EXPIRED") {
        receipt.authorization = "expired";
      } else if (
        failure.code !== "CANVAS_APPROVAL_PENDING" &&
        receipt.authorization === "pending"
      ) {
        receipt.authorization = "unknown";
      }
      return {
        ok: false,
        ...result(),
        error: { code: failure.code, message: failure.message },
      };
    }
  }

  private async start(taskRef: string): Promise<Binding> {
    const url = new URL(this.origin);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
    )
      throw new CanvasTaskError(
        "CANVAS_ORIGIN_UNSAFE",
        "Canvas must use HTTPS or a loopback development origin.",
      );
    const openedAt = performance.now();
    const response = await fetch(new URL("/api/agent/sessions", this.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        browserLaunch: true,
        projectId: BROWSER_LAUNCH_PENDING_PROJECT,
        projectSessionId: randomUUID(),
        documentIds: [],
        scopes: AgentSessionScopeSchema.options,
      }),
    }).catch(() => {
      throw new CanvasTaskError(
        "CANVAS_RELAY_UNREACHABLE",
        "The configured Canvas relay did not answer.",
      );
    });
    const parsed = CreatedSession.safeParse(
      await response.json().catch(() => null),
    );
    if (!response.ok || !parsed.success)
      throw new CanvasTaskError(
        "CANVAS_LAUNCH_UNAVAILABLE",
        "The configured Canvas site did not provide a compatible browser launch.",
      );
    const launch = parsed.data.session;
    if (
      agentSiteSessionId(this.origin, launch.sessionId.slice(9)) !==
      launch.sessionId
    )
      throw new CanvasTaskError(
        "CANVAS_ORIGIN_MISMATCH",
        "The launch session was issued for a different site.",
      );
    const client = new AgentSessionClient({
      http: new AgentHttpClient({
        baseUrl: this.origin,
        adapterVersion: AGENT_MCP_VERSION,
      }),
      resumeInMemory: true,
    });
    // This bearer has no editor attached and the grant has no editor authority.
    await client.redeem(launch.claimCode);
    try {
      const device = this.deviceKeyPath
        ? await browserDeviceProof(
            this.deviceKeyPath,
            this.origin,
            launch,
          ).catch(() => undefined)
        : undefined;
      await handOffToBrowser(this.origin, launch, this.openBrowser, device);
    } catch {
      await client.retireDetached().catch(() => undefined);
      throw new CanvasTaskError(
        "CANVAS_BROWSER_FAILED",
        "The system browser could not be started.",
      );
    }
    return {
      sessionId: launch.sessionId,
      operation: { ...this.settings, client, taskRef },
      openedAt,
      ready: false,
      paused: false,
    };
  }

  private async readProject(binding: Binding) {
    // A reload can attach the socket before the new context heartbeat is
    // acknowledged. Retry only the read, against the same browser session.
    const retryUntil = performance.now() + RECONNECT_GRACE_MS;
    for (const wait of [0, 300, 700, 1_500]) {
      if (wait && performance.now() + wait >= retryUntil) break;
      if (wait) await delay(wait);
      try {
        const result = await binding.operation.client.connect();
        if (
          result.context &&
          result.context.projectId !== BROWSER_LAUNCH_PENDING_PROJECT
        )
          return result;
      } catch (error) {
        if (
          !(error instanceof AgentSessionError) ||
          ![
            "PROJECT_CONTEXT_STALE",
            "NO_ACTIVE_PROJECT",
            "EDITOR_OFFLINE",
            "EDITOR_DISCONNECTED",
          ].includes(error.code)
        )
          throw error;
      }
    }
    throw new CanvasTaskError(
      "CANVAS_PROJECT_UNREADABLE",
      "The authorized Canvas did not return a Project.",
    );
  }

  private async status(binding: Binding): Promise<EditorReadiness> {
    const { observation, lastErrorCode, state } =
      await binding.operation.client.status({ refresh: true });
    if (
      state === "revoked" ||
      lastErrorCode === "SESSION_REVOKED" ||
      lastErrorCode === "SESSION_TAKEN_OVER"
    )
      throw revoked();
    if (
      lastErrorCode === "SESSION_NOT_FOUND" ||
      (lastErrorCode === "SESSION_EXPIRED" && binding.paused)
    )
      throw new CanvasTaskError(
        "CANVAS_SESSION_ENDED",
        "This session ended. Start a new Canvas task to authorize another tab.",
      );
    if (lastErrorCode === "SESSION_EXPIRED") return "expired";
    if (
      state === "unknown" ||
      !observation ||
      observation.sessionId !== binding.sessionId
    )
      throw new CanvasTaskError(
        "CANVAS_STATUS_UNAVAILABLE",
        "The Canvas relay could not verify this task's binding.",
      );
    binding.paused = observation.authorization === "paused";
    if (binding.paused)
      throw new CanvasTaskError(
        "SESSION_PAUSED",
        "Resume this task in the browser's Agent panel.",
      );
    if (observation.editor === "detached") return "detached";
    return observation.contextRevision && observation.documentIds.length
      ? "attached"
      : "no-project";
  }
}
