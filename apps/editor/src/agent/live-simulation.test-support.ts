import { readFileSync } from "node:fs";
import { vi } from "vitest";
import type { CircuitProject } from "@icm/model";
import {
  assembleNativeExecutionOutput,
  type ExecutionInput,
} from "@icm/simulation-service";
import type { ArtifactRef } from "@icm/simulation-service/contract";
import { ArtifactDownloadError } from "@icm/simulation-service/files";
import { AgentArtifacts } from "../../../../worker/agent-artifacts";
import { routeSimulationRequest } from "../../../../worker/simulation";
import {
  nativeEnvironment,
  nativeWorkerEnv,
} from "../../../../worker/simulation.test-fixture";
import type { EditorDocumentController } from "../document/document-controller";
import type { BrowserAgentProjectHostOptions } from "./browser-agent-project-host";
import {
  liveAgentEditor,
  type LiveAgentEditorOptions,
} from "./live-agent-editor.test-support";
import { listWorkspaceProjects, workspaceResponses } from "./workspace-copy";

const dividerSource = readFileSync(
  new URL("../../../../netlists/vacask-divider/divider.sim", import.meta.url),
  "utf8",
).replace(/  sweep supply[\s\S]*?endc/u, "endc");
const dividerRawfile = readFileSync(
  new URL(
    "../../../../netlists/vacask-divider/divider_op.raw",
    import.meta.url,
  ),
  "utf8",
);

/** A native divider operating point, as an Agent authors it. */
export function dividerFiles() {
  return [
    {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: nativeEnvironment.profileId },
      }),
    },
    { path: "main.sim", text: dividerSource },
  ];
}

/** The same divider saved in the Project as a simulation folder. */
export function dividerFolder(
  id: string,
  name: string,
): CircuitProject["simulationFolders"][number] {
  return {
    id,
    name,
    version: 4,
    input: {
      kind: "source",
      entry: "main.sim",
      configPath: "experiment.json",
      circuitBindings: [],
      files: dividerFiles(),
      dependencies: [],
    },
  };
}

/** The executor's answer for one run, assembled from a captured divider run. */
async function capturedDividerRun(input: ExecutionInput) {
  const output = await assembleNativeExecutionOutput(
    input,
    {
      execution: {
        stdout: "Running analysis 'divider_op'.\n  Elapsed time: 0.001\n",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        spawnError: null,
        durationMs: 1,
      },
      timeoutMs: 1000,
      rawfiles: [{ path: "divider_op.raw", text: dividerRawfile }],
      executedFiles: input.files,
      diagnostics: [],
      truncated: false,
    },
    nativeEnvironment,
  );
  return Response.json({
    ...output.result,
    rawfiles: output.rawfiles,
    executedFiles: output.executedFiles,
    cancelled: output.cancelled,
  });
}

/**
 * The hosted simulation service the editor calls over the network: the
 * Worker's own route, whose native executor answers with a captured divider
 * run. Only this side is scripted; the editor's Simulation resource is real.
 */
export class HostedSimulationService {
  executions = 0;
  maxActive = 0;
  private active = 0;
  private gate: Promise<void> = Promise.resolve();
  private open = () => {};
  private repliesLost = false;

  /** Executions started from now on wait for release(). */
  hold(): void {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  release(): void {
    this.open();
  }

  /** From now on, an execution's reply never reaches the editor. */
  loseReplies(): void {
    this.repliesLost = true;
  }

  readonly fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const gate = this.gate;
    // Capability and cancel requests name an operation; executions do not.
    const execution = !(
      "operation" in (JSON.parse(String(init?.body)) as object)
    );
    const response = await routeSimulationRequest(
      new Request(new URL(String(url), "http://localhost"), init),
      nativeWorkerEnv(async (target, run) => {
        if (new URL(target).pathname === "/cancel")
          return Response.json({ accepted: true });
        this.executions++;
        this.maxActive = Math.max(this.maxActive, ++this.active);
        try {
          await gate;
          return await capturedDividerRun(JSON.parse(String(run?.body)));
        } finally {
          this.active--;
        }
      }),
    );
    if (execution && this.repliesLost) throw new TypeError("fetch failed");
    return response!;
  }) as typeof fetch;
}

const ARTIFACT_PATH =
  /^\/api\/agent\/sessions\/([^/]+)\/artifacts\/([a-zA-Z0-9_-]{1,128})$/u;

/**
 * The relay's artifact transfers, served by the Worker's own route over
 * in-memory storage: the editor uploads each file it offers, and an Agent's
 * authorized GET reads only what the editor uploaded.
 */
export class ArtifactRelay {
  /** File IDs whose upload the relay has stored. */
  readonly uploaded: string[] = [];
  /** File IDs whose bytes the relay sent to the Agent. */
  readonly served: string[] = [];
  private readonly values = new Map<string, unknown>();
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array<ArrayBuffer>; contentType: string }
  >();
  private readonly route = new AgentArtifacts(
    {
      get: async <T>(key: string) =>
        structuredClone(this.values.get(key)) as T | undefined,
      put: async <T>(key: string, value: T) => {
        this.values.set(key, structuredClone(value));
      },
    },
    {
      put: async (key, body, options) => {
        this.objects.set(key, {
          bytes: new Uint8Array(await new Response(body).arrayBuffer()),
          contentType: options.httpMetadata.contentType,
        });
      },
      get: async (key, options) => {
        const object = this.objects.get(key);
        if (!object) return null;
        const range = options?.range;
        const bytes = range
          ? object.bytes.slice(range.offset, range.offset + range.length)
          : object.bytes;
        return {
          body: new Response(bytes).body!,
          size: object.bytes.byteLength,
          httpMetadata: { contentType: object.contentType },
        };
      },
      delete: async (keys) => {
        for (const key of [keys].flat()) this.objects.delete(key);
      },
    },
  );
  private held: (ref: ArtifactRef) => boolean = () => false;
  private gate: Promise<void> = Promise.resolve();
  private open = () => {};

  /** Matching uploads stay in flight until release(). */
  hold(held: (ref: ArtifactRef) => boolean): void {
    this.held = held;
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  release(): void {
    this.held = () => false;
    this.open();
  }

  /** The editor's upload of one file, as the session hook sends it. */
  readonly publish = async (ref: ArtifactRef, text: string) => {
    if (this.held(ref)) await this.gate;
    const fileId = ref.fileId ?? ref.id;
    const path = `/api/agent/sessions/session-1/artifacts/${encodeURIComponent(fileId)}`;
    const body = new TextEncoder().encode(text);
    const response = await this.route.handle(
      new Request(`https://relay.test${path}`, {
        method: "PUT",
        headers: {
          "content-length": String(body.byteLength),
          "x-artifact-ref": encodeURIComponent(JSON.stringify(ref)),
        },
        body,
      }),
      "session-1",
      fileId,
    );
    if (!response.ok)
      throw new ArtifactDownloadError(
        "ARTIFACT_UPLOAD_FAILED",
        "retry-after",
        `Artifact transfer rejected (HTTP ${response.status})`,
      );
    this.uploaded.push(fileId);
    return path;
  };

  /** The network an Agent's HTTP client reaches for artifact bytes. */
  readonly fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const match = ARTIFACT_PATH.exec(new URL(request.url).pathname);
    if (!match || request.method !== "GET")
      throw new TypeError(`No route for ${request.method} ${request.url}`);
    const response = await this.route.handle(request, match[1]!, match[2]!);
    if (response.ok) this.served.push(match[2]!);
    return response;
  }) as typeof fetch;
}

/**
 * The live editor with the relay's artifact transfers attached, as the
 * session hook attaches them when a session starts.
 */
export function liveEditorWithRelay(
  options: LiveAgentEditorOptions = {},
): ReturnType<typeof liveAgentEditor> & { relay: ArtifactRelay } {
  const relay = new ArtifactRelay();
  // The Agent's HTTP client takes the network it is built with.
  vi.stubGlobal("fetch", relay.fetch);
  const editor = liveAgentEditor(options);
  editor.fileHost.setArtifactPublisher(relay.publish);
  return { ...editor, relay };
}

export interface OpenTab {
  id: string;
  controller: EditorDocumentController;
  cloudProjectId?: string;
}

/** The editor's open Project tabs, listed for an Agent as the App lists them. */
export function openTabs(tabs: {
  active: string;
  open: OpenTab[];
}): NonNullable<BrowserAgentProjectHostOptions["workspace"]> {
  return async (envelope) => {
    if (envelope.request.action !== "list")
      throw new Error(`Tab ${envelope.request.action} is not exercised here`);
    return workspaceResponses(envelope.requestId).success({
      action: "list",
      activeWorkspaceId: tabs.active,
      projects: listWorkspaceProjects(
        tabs.open.map(({ id, controller, cloudProjectId }) => ({
          id,
          session: {
            controller,
            file: {
              cloudBinding: cloudProjectId ? { id: cloudProjectId } : null,
            },
            dirty: false,
          },
        })),
      ),
    });
  };
}
