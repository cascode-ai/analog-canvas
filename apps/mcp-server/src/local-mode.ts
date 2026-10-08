import { existsSync, readFileSync, rmSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { z } from "zod";
import {
  AgentCircuitResponseSchema,
  AgentFileResourceResponseSchema,
  AgentProjectResourceResponseSchema,
  type AgentCircuitRequest,
  type AgentCircuitResponse,
  type AgentFileResourceRequest,
  type AgentFileResourceResponse,
  type AgentProjectResourceRequest,
  type AgentProjectResourceResponse,
  type AgentSessionStatusResponse,
  type AgentSimulationResourceResponse,
} from "@icm/agent-adapter";
import {
  AgentHttpClient,
  AgentSessionClient,
  AgentSessionError,
  ConnectorStore,
  type AgentRelayOperation,
  type ClaimSuccess,
  type StoredConnectorCredential,
} from "@icm/agent-client";
import type { OperationSession } from "./operation-session.js";

/**
 * Local mode (#1498): `--local <dir>` serves every tool from the Project
 * file in one workspace directory, through the editor's own Agent host run
 * in this process, with no browser, relay or network. See
 * docs/agent/local-workspace.md.
 */

export const LOCAL_MODE_USAGE =
  "analog-canvas-mcp --local <dir> [--process <id>] [--new [--name <name>] [--reference <file.sp>]] [--http <command>]";

/** The headless workspace bundle's file name, beside this adapter in a release. */
export const HEADLESS_BUNDLE_NAME = "analog-canvas-headless.mjs";

/** One workspace's Project, held by this process through the editor's host. */
export interface LocalWorkspaceHandle {
  readonly dir: string;
  readonly editor: {
    readonly project: {
      readonly id: string;
      readonly documents: readonly { readonly id: string }[];
    };
    circuit(request: AgentCircuitRequest): AgentCircuitResponse;
    files(request: unknown): Promise<AgentFileResourceResponse>;
    projects(request: unknown): Promise<AgentProjectResourceResponse>;
  };
  /** Write the Project if a call changed it. */
  save(): Promise<boolean>;
  /** Save, then release the workspace lock. */
  close(): Promise<void>;
}

/**
 * What local mode uses of the headless workspace
 * (apps/editor/src/headless). The adapter is compiled without the editor's
 * sources, so it loads the bundled module at run time, and only in this mode.
 */
export interface HeadlessWorkspace {
  readonly LOCAL_AGENT_SCOPES: readonly string[];
  readonly NETLIST_PROFILE_IDS: readonly string[];
  readonly WORKSPACE_LOCK_FILE: string;
  workspaceProjectPath(dir: string): string;
  createWorkspace(
    dir: string,
    options?: { name?: string; reference?: string },
  ): Promise<unknown>;
  openLocalWorkspace(
    dir: string,
    options?: { process?: string },
  ): Promise<LocalWorkspaceHandle>;
}

/**
 * Where the bundle is looked for: the path ANALOG_CANVAS_HEADLESS names;
 * else beside this adapter, as a release ships it; else the workspace
 * build's, which `pnpm headless:package` writes.
 */
export function headlessBundleCandidates(
  env: Record<string, string | undefined> = process.env,
  adapter = fileURLToPath(import.meta.url),
): string[] {
  const named = env.ANALOG_CANVAS_HEADLESS?.trim();
  if (named) return [resolve(named)];
  return [
    resolve(dirname(adapter), HEADLESS_BUNDLE_NAME),
    // apps/mcp-server/dist (or src) to the repository's output/.
    resolve(dirname(adapter), "../../../output/headless", HEADLESS_BUNDLE_NAME),
  ];
}

export async function loadHeadlessWorkspace(
  env: Record<string, string | undefined> = process.env,
): Promise<HeadlessWorkspace> {
  const candidates = headlessBundleCandidates(env);
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error(
      `Local mode needs the headless workspace bundle, and there is none at ${candidates.join(" or ")}. In a checkout, build it with \`pnpm headless:package\`; or name one with ANALOG_CANVAS_HEADLESS=<path>.`,
    );
  return (await import(
    /* @vite-ignore */ pathToFileURL(found).href
  )) as HeadlessWorkspace;
}

export interface LocalArguments {
  dir: string;
  /** The Process new transistors are placed in; the editor's default if left out. */
  process?: string;
  /** Create the workspace when the directory holds none. */
  create?: { name?: string; referencePath?: string };
  /** One `--http` command (`batch` included) instead of the stdio server. */
  http?: string;
}

/** The arguments after `--local`. */
export function parseLocalArguments(args: readonly string[]): LocalArguments {
  const [dir, ...rest] = args;
  if (!dir || dir.startsWith("--"))
    throw new Error(`Name the workspace directory: ${LOCAL_MODE_USAGE}`);
  const parsed: LocalArguments = { dir };
  let create = false;
  let name: string | undefined;
  let referencePath: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]!;
    const value = () => {
      index += 1;
      const next = rest[index];
      if (next === undefined || next.startsWith("--"))
        throw new Error(`${flag} needs a value: ${LOCAL_MODE_USAGE}`);
      return next;
    };
    if (flag === "--http") {
      parsed.http = rest[index + 1] ?? "connection_status";
      break;
    }
    if (flag === "--process") parsed.process = value();
    else if (flag === "--new") create = true;
    else if (flag === "--name") name = value();
    else if (flag === "--reference") referencePath = value();
    else throw new Error(`Unknown option ${flag}: ${LOCAL_MODE_USAGE}`);
  }
  if (!create && (name !== undefined || referencePath !== undefined))
    throw new Error(
      "--name and --reference describe a new workspace: add --new",
    );
  if (create)
    parsed.create = {
      ...(name === undefined ? {} : { name }),
      ...(referencePath === undefined ? {} : { referencePath }),
    };
  return parsed;
}

const LOCAL_SESSION_ID = "local";
// Not a credential: nothing checks it, and it never leaves this process.
const LOCAL_TOKEN = "local";

function simulationUnavailable(): AgentSessionError {
  return new AgentSessionError(
    "SIMULATION_UNAVAILABLE",
    "Simulation needs the website; a local workspace has no simulator",
    "request-rejected",
  );
}

/**
 * Project operations on what only the website has: the Gallery, Cloud
 * Projects and the editor's open tabs. Refused by name, where the editor's
 * host would answer that the website could not be reached, try again.
 */
const WEBSITE_PROJECT_OPERATIONS: ReadonlySet<string> = new Set([
  "workspace",
  "list-projects",
  "list-cells",
  "import-cell",
  "list-gallery",
  "read-gallery-entry",
  "read-gallery-entries",
  "insert-gallery-entry",
  "publish-gallery-entry",
  "update-gallery-entry",
]);

const FIGURE_ARTIFACTS: ReadonlySet<string> = new Set(["svg", "png", "pdf"]);

function websiteRequired(what: string, instead: string): AgentSessionError {
  return new AgentSessionError(
    "WEBSITE_REQUIRED",
    `${what} needs the website; a local workspace has only its own Project file. ${instead}`,
    "request-rejected",
  );
}

/**
 * The editor's answer as the relay would carry it: through JSON, and read
 * against the same response schema the HTTP client reads it with.
 */
function relayed<T>(schema: z.ZodType<T>, resource: string, value: unknown) {
  const parsed = schema.safeParse(JSON.parse(JSON.stringify(value)));
  if (!parsed.success)
    throw new AgentSessionError(
      "INVALID_RESPONSE",
      `The local editor's ${resource} response failed schema validation`,
      "request-rejected",
    );
  return parsed.data;
}

function wire<T>(request: T): T {
  return JSON.parse(JSON.stringify(request)) as T;
}

/**
 * The Agent client's transport in local mode: where the HTTP client sends a
 * request to the relay and on to a paired page, this hands it to the
 * editor's own host for the workspace in this process. Pairing is
 * immediate, with every scope: the workspace is its owner's own. After each
 * call the Project is written if the call changed it, so the file always
 * holds what the Agent was told. Simulation needs the website and is refused.
 */
export class LocalAgentHttp extends AgentHttpClient {
  private saving: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly workspace: LocalWorkspaceHandle,
    private readonly scopes: readonly string[],
  ) {
    super({
      baseUrl: pathToFileURL(workspace.dir).href,
      // Every request is answered in process; one that is not fails here.
      fetch: async () => {
        throw new Error("A local workspace reaches no network");
      },
    });
  }

  private credential(): ClaimSuccess {
    const project = this.workspace.editor.project;
    return {
      sessionId: LOCAL_SESSION_ID,
      agentToken: LOCAL_TOKEN,
      tokenExpiresAt: Number.MAX_SAFE_INTEGER,
      connectorToken: LOCAL_TOKEN,
      connectorExpiresAt: Number.MAX_SAFE_INTEGER,
      scopes: [...this.scopes],
      projectId: project.id,
      documentIds: project.documents.map((document) => document.id),
    };
  }

  /** The connector a local session resumes from: always this workspace's. */
  storedCredential(): StoredConnectorCredential {
    return {
      version: 1,
      apiBaseUrl: this.baseUrl,
      sessionId: LOCAL_SESSION_ID,
      connectorToken: LOCAL_TOKEN,
      connectorExpiresAt: Number.MAX_SAFE_INTEGER,
      storedAt: Date.now(),
    };
  }

  /** Write the Project if the last call changed it, one write at a time. */
  private persist(): Promise<void> {
    const saved = this.saving.then(() => this.workspace.save());
    this.saving = saved.catch(() => undefined);
    return saved.then(
      () => undefined,
      (error: unknown) => {
        throw new AgentSessionError(
          "WORKSPACE_SAVE_FAILED",
          `The call was applied, but the Project file could not be written (${error instanceof Error ? error.message : String(error)}). Do not repeat the call: the next one, or the end of this process, writes the file again.`,
          "request-rejected",
        );
      },
    );
  }

  /** Every write started so far has finished. */
  async settled(): Promise<void> {
    await this.saving;
  }

  override async claim(): Promise<ClaimSuccess> {
    return this.credential();
  }

  override async resumeConnector(): Promise<ClaimSuccess> {
    return this.credential();
  }

  override async circuit(
    _sessionId: string,
    _agentToken: string,
    request: AgentCircuitRequest,
  ): Promise<AgentCircuitResponse> {
    const response = relayed(
      AgentCircuitResponseSchema,
      "Circuit",
      this.workspace.editor.circuit(wire(request)),
    );
    await this.persist();
    return response;
  }

  override async files(
    _sessionId: string,
    _agentToken: string,
    request: AgentFileResourceRequest,
  ): Promise<AgentFileResourceResponse> {
    // The editor measures a figure file's crop in a browser page.
    if (
      request.operation === "download" &&
      FIGURE_ARTIFACTS.has(request.artifact)
    )
      throw websiteRequired(
        `${request.artifact.toUpperCase()} export`,
        "Use render for the formal SVG.",
      );
    const response = relayed(
      AgentFileResourceResponseSchema,
      "File",
      await this.workspace.editor.files(wire(request)),
    );
    await this.persist();
    return response;
  }

  override async projects(
    _sessionId: string,
    _agentToken: string,
    request: AgentProjectResourceRequest,
  ): Promise<AgentProjectResourceResponse> {
    if (WEBSITE_PROJECT_OPERATIONS.has(request.operation))
      throw websiteRequired(
        `The ${request.operation} operation`,
        "This Project's own Cells, Project Code and netlist work here.",
      );
    const response = relayed(
      AgentProjectResourceResponseSchema,
      "Project",
      await this.workspace.editor.projects(wire(request)),
    );
    await this.persist();
    return response;
  }

  override async simulation(): Promise<AgentSimulationResourceResponse> {
    throw simulationUnavailable();
  }

  override async downloadArtifact(): Promise<Response> {
    throw simulationUnavailable();
  }

  /** Nothing to revoke: the workspace stays this process's until it ends. */
  override async disconnect(): Promise<void> {
    await this.persist();
  }

  override async status(): Promise<AgentSessionStatusResponse> {
    const { projectId, documentIds } = this.credential();
    return {
      ok: true,
      sessionId: LOCAL_SESSION_ID,
      projectId,
      documentIds,
      authorization: "active",
      editor: "attached",
      observedAt: Date.now(),
      expiresAt: Number.MAX_SAFE_INTEGER,
    };
  }

  /** No relay keeps a record of the calls. */
  override async activity(): Promise<AgentRelayOperation[]> {
    return [];
  }
}

/** A local session resumes without a claim, again after a disconnect too. */
class LocalConnectorStore extends ConnectorStore {
  constructor(private readonly http: LocalAgentHttp) {
    super("");
  }

  override async load(): Promise<StoredConnectorCredential> {
    return this.http.storedCredential();
  }

  override async save(): Promise<void> {}

  override async clear(): Promise<void> {}
}

export interface LocalMode {
  readonly session: OperationSession;
  readonly workspace: LocalWorkspaceHandle;
  /** The lock file naming this process while it holds the workspace. */
  readonly lockPath: string;
  /** Finish the writes, save, and release the workspace; once. */
  close(): Promise<void>;
}

/**
 * Open (with `create`, first create) one workspace for this process: its
 * lock is held until `close`, and the session's every tool works on its
 * Project, as the stdio server and the one-shot command line both use it.
 */
export async function openLocalMode(
  options: LocalArguments,
  dependencies: {
    headless?: HeadlessWorkspace;
    env?: Record<string, string | undefined>;
  } = {},
): Promise<LocalMode> {
  const headless =
    dependencies.headless ?? (await loadHeadlessWorkspace(dependencies.env));
  if (
    options.process !== undefined &&
    !headless.NETLIST_PROFILE_IDS.includes(options.process)
  )
    throw new Error(
      `--process ${options.process} is not a Process; use one of ${headless.NETLIST_PROFILE_IDS.join(", ")}`,
    );
  const dir = resolve(options.dir);
  const exists = () =>
    access(headless.workspaceProjectPath(dir)).then(
      () => true,
      () => false,
    );
  if (!(await exists())) {
    if (!options.create)
      throw new Error(`${dir} holds no workspace; add --new to create one`);
    const { name, referencePath } = options.create;
    const reference =
      referencePath === undefined
        ? undefined
        : await readFile(resolve(referencePath), "utf8");
    try {
      await headless.createWorkspace(dir, {
        ...(name === undefined ? {} : { name }),
        ...(reference === undefined ? {} : { reference }),
      });
    } catch (error) {
      // Another process created it a moment earlier: open that one.
      if (!(await exists())) throw error;
    }
  }
  const workspace = await headless.openLocalWorkspace(
    dir,
    options.process === undefined ? {} : { process: options.process },
  );
  const http = new LocalAgentHttp(workspace, headless.LOCAL_AGENT_SCOPES);
  let closing: Promise<void> | undefined;
  return {
    session: {
      client: new AgentSessionClient({
        http,
        connectorStore: new LocalConnectorStore(http),
      }),
    },
    workspace,
    lockPath: join(dir, headless.WORKSPACE_LOCK_FILE),
    close: () => (closing ??= http.settled().then(() => workspace.close())),
  };
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/**
 * Let the workspace go however the process ends: on a signal, save and
 * release it, then end as the signal would have; on any other exit, release
 * a lock still naming this process. A crash that skips both leaves a lock
 * the next process takes over, since it names a process no longer running.
 * Returns the undo, for after `close`.
 */
export function releaseOnExit(mode: LocalMode): () => void {
  const release = () => {
    try {
      if (Number(readFileSync(mode.lockPath, "utf8")) === process.pid)
        rmSync(mode.lockPath, { force: true });
    } catch {
      // Already released.
    }
  };
  const handlers = SIGNALS.map((signal) => {
    const handler = () => {
      void mode
        .close()
        .catch(() => undefined)
        .finally(() => process.kill(process.pid, signal));
    };
    process.once(signal, handler);
    return [signal, handler] as const;
  });
  process.once("exit", release);
  return () => {
    process.off("exit", release);
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}
