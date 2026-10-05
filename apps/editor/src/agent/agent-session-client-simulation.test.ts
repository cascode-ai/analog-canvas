import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AgentSimulationResourceResponse } from "@icm/agent-adapter";
import { createSimulationFolder } from "@icm/model";
import type {
  ArtifactRef,
  Capabilities,
  ExecutionInput,
} from "@icm/simulation-service";
import {
  assembleNgspiceOutput,
  createSimulationEnvironmentMetadata,
} from "@icm/spice-run";
import { AgentSessionError } from "../../../../packages/agent-client/src/errors";
import {
  emptyAgentProject,
  liveAgentEditor,
} from "./live-agent-editor.test-support";

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../../fixtures/ngspice-rawfile/${name}`, import.meta.url),
    "utf8",
  );
/** A deck and the rawfile ngspice 46 wrote for it. */
const divider = {
  deck: fixture("divider-op.deck.spi"),
  rawfile: fixture("divider-op.raw"),
};
const PROFILE = "ngspice-46";

/** The hosted service's discovery: one ngspice Profile. */
const capabilities: Capabilities = {
  configured: true,
  rawfileCollection: "declared-single-ascii",
  maxInputFiles: 24,
  inputs: ["structured", "raw"],
  analyses: ["op", "dc", "ac", "tran", "noise"],
  parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
  profiles: [
    { id: PROFILE, label: "ngspice 46", engine: "ngspice", corners: [] },
  ],
  maxTimeoutMs: 120_000,
  maxInputBytes: 1_048_576,
  maxOutputBytes: 2_097_152,
  cancel: true,
};

/** What the editor sends the service to execute. */
type ExecutionRequest = ExecutionInput & {
  runToken: string;
  timeoutMs?: number;
};

/**
 * The service's answer to one execution, assembled by the same code the
 * hosted service uses, with its collector's status. A truncated rawfile
 * makes the collection partial.
 */
async function ngspiceAnswer(
  run: ExecutionRequest & { collection: { rawfile: string | null } },
  truncated: boolean,
) {
  const payload = await assembleNgspiceOutput(
    {
      log: "Circuit: * resistive divider, operating point.\nNo. of Data Rows : 1\n",
      exitCode: 0,
      signal: null,
      timedOut: false,
      cancelled: false,
      durationMs: 4,
      environment: await createSimulationEnvironmentMetadata({
        executor: "hosted-container",
        reproducibility: "observed",
        profileId: run.environment.profileId,
        platform: "linux/x64",
        simulator: {
          name: "ngspice",
          version: "ngspice-46",
          binarySha256: null,
        },
        models: null,
        startupSha256: null,
      }),
      rawfile: truncated ? divider.rawfile.slice(0, 200) : divider.rawfile,
      rawfileFormat: "ascii",
      rawfileRequested: run.collection.rawfile !== null,
      rawfileName: run.collection.rawfile,
      collection: run.collection,
      truncatedOutputs: truncated ? ["rawfile"] : [],
    },
    {
      netlist: run.netlist,
      testbench: run.testbench,
      deck: run.testbench,
      inputRevision: run.inputRevision,
      timeoutMs: run.timeoutMs ?? 120_000,
      modelLibrary: null,
      collection: run.collection,
      execution: { target: "cloudflare-container" },
      runToken: run.runToken,
    },
  );
  return {
    ...payload,
    collectionStatus: truncated || !payload.data ? "partial" : "complete",
  };
}

/**
 * The hosted simulation service the editor calls at /api/simulate, scripted
 * to its contract. `hold()` keeps execution answers back until released;
 * with `truncate`, it answers as a collector that cut the rawfile short.
 */
function simulationService() {
  const runs: ExecutionRequest[] = [];
  let gate = Promise.resolve();
  const service = {
    runs,
    truncate: false,
    hold() {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return release;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "/api/simulate" || init?.method !== "POST")
        return new Response(null, { status: 404 });
      const body = JSON.parse(String(init.body)) as
        ExecutionRequest | { operation: string };
      if ("operation" in body)
        return body.operation === "capabilities"
          ? Response.json(capabilities)
          : Response.json({ error: "invalid-operation" }, { status: 400 });
      if (!body.collection || !("rawfile" in body.collection))
        return Response.json(
          { error: "invalid-output-collection" },
          { status: 400 },
        );
      runs.push(body);
      await gate;
      return Response.json(
        await ngspiceAnswer(
          { ...body, collection: body.collection },
          service.truncate,
        ),
      );
    }) as typeof globalThis.fetch,
  };
  return service;
}

/** A Project whose one ngspice experiment is the divider deck. */
function dividerProject() {
  const project = emptyAgentProject();
  const folder = createSimulationFolder({
    id: "divider",
    name: "Divider",
    profileId: PROFILE,
    engine: "ngspice",
  });
  folder.input.files.find((file) => file.path === folder.input.entry)!.text =
    divider.deck;
  project.simulationFolders.push(folder);
  return project;
}

type LiveEditor = ReturnType<typeof liveAgentEditor>;

/** The editor's answer under `key`, after checking it said ok. */
function answer<
  K extends "prepared" | "run" | "catalog" | "capabilities" | "artifacts",
>(response: AgentSimulationResourceResponse, key: K) {
  if (!response.ok || !(key in response))
    throw new Error(JSON.stringify(response));
  return (
    response as Extract<AgentSimulationResourceResponse, Record<K, unknown>>
  )[key];
}

const source = ({ controller }: LiveEditor) => ({
  kind: "project-folder" as const,
  folderId: "divider",
  expectedStructureRevision: controller.project.structureRevision,
});

async function prepareDivider(editor: LiveEditor) {
  return answer(
    await editor.client.simulationResource({
      apiVersion: "3.0",
      requestId: "prepare",
      operation: "prepare",
      source: source(editor),
    }),
    "prepared",
  );
}

/** Submit the divider; with `waitMs`, the editor answers once it ends. */
async function runDivider(
  editor: LiveEditor,
  requestId: string,
  waitMs?: number,
) {
  return answer(
    await editor.client.simulationResource({
      apiVersion: "3.0",
      requestId,
      operation: "run",
      source: source(editor),
      ...(waitMs === undefined ? {} : { waitMs }),
    }),
    "run",
  );
}

const catalog = (runId: string) =>
  ({
    apiVersion: "3.0",
    requestId: "catalog",
    operation: "catalog",
    runId,
  }) as const;

/** The relay refused the request before the editor saw it. */
const offline = () =>
  new AgentSessionError("EDITOR_OFFLINE", "offline", "editor-offline", 503);

/** The editor took the request, but its reply never came back. */
const lostReply = () =>
  new AgentSessionError(
    "EDITOR_DISCONNECTED",
    "response lost",
    "editor-offline",
    503,
  );

/** The editor handles the next Simulation request; its reply is lost. */
function loseNextSimulationReply(http: LiveEditor["http"]) {
  const handle = http.simulation.bind(http);
  vi.spyOn(http, "simulation").mockImplementationOnce(async (...call) => {
    await handle(...call);
    throw lostReply();
  });
}

/**
 * The relay's artifact storage behind the session's transfer: the editor
 * uploads each file it keeps, and the relay serves it at the session's
 * download route once stored. Uploads finish when the test says so.
 */
function relayArtifactStorage() {
  const stored = new Map<string, string>();
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return {
    stored,
    upload: async (ref: ArtifactRef, text: string) => {
      await opened;
      const path = `/api/agent/sessions/session-1/artifacts/${ref.fileId ?? ref.id}`;
      stored.set(path, text);
      return path;
    },
    /** Finish every upload, and give the editor a turn to record it. */
    async finish() {
      open();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("the Agent client's Simulation requests against the live editor", () => {
  it("reuses the editor's exact recent capabilities only internally, with explicit refresh, TTL and context isolation", async () => {
    let now = 1000;
    const { client, http } = liveAgentEditor({
      simulationService: simulationService().fetch,
      client: { now: () => now },
    });
    await client.connect("session-1.code");
    const editorReads = () => http.simulationCalls.length;
    const request = {
      apiVersion: "3.0",
      requestId: "discovery",
      operation: "capabilities",
      detail: "summary",
    } as const;
    const summary = await client.simulationResource(request);
    expect(answer(summary, "capabilities")).toMatchObject({
      discovery: { detail: "summary" },
      profiles: [{ id: PROFILE, engine: "ngspice" }],
    });
    // An internal read of the same selection reuses that answer.
    expect(
      await client.simulationMetadataResource({
        requestId: "create",
        detail: "summary",
        operation: "capabilities",
        apiVersion: "3.0",
      }),
    ).toEqual({ ...summary, requestId: "create" });
    expect(editorReads()).toBe(1);
    // Full detail is another question for the editor.
    expect(
      answer(
        await client.simulationMetadataResource({ ...request, detail: "full" }),
        "capabilities",
      ).discovery,
    ).toMatchObject({ detail: "full" });
    expect(editorReads()).toBe(2);
    // Explicit calls and refreshes always ask.
    await client.simulationResource(request);
    await client.simulationMetadataResource(request, { refresh: true });
    expect(editorReads()).toBe(4);
    now += 30_000;
    await client.simulationMetadataResource(request);
    expect(editorReads()).toBe(5);
    // The relay reports a new browser context, as after a reload.
    http.contextRevision = "next-context";
    await client.simulationMetadataResource(request);
    expect(editorReads()).toBe(6);
    await client.connect("session-1.code");
    await client.simulationMetadataResource(request);
    expect(editorReads()).toBe(7);
  });

  it("does not reuse the editor's pending or partial catalogs, and drops a complete one after export or a failed refresh", async () => {
    const service = simulationService();
    const editor = liveAgentEditor({
      project: dividerProject(),
      simulationService: service.fetch,
    });
    const { client, http } = editor;
    await client.connect("session-1.code");
    const catalogReads = () =>
      http.simulationCalls.filter((request) => request.operation === "catalog")
        .length;
    // The service still has the first run: its catalog is pending.
    const release = service.hold();
    service.truncate = true;
    const first = await runDivider(editor, "run-1");
    expect(first.state).toBe("running");
    expect(
      answer(
        await client.simulationMetadataResource(catalog(first.id)),
        "catalog",
      ),
    ).toMatchObject({ execution: "pending", collection: "pending" });
    await client.simulationMetadataResource(catalog(first.id));
    expect(catalogReads()).toBe(2);
    // Its collector cut the rawfile short: the run ended, partly collected.
    release();
    expect(
      answer(
        await client.simulationResource({
          apiVersion: "3.0",
          requestId: "wait-1",
          operation: "read",
          runId: first.id,
          waitMs: 20_000,
        }),
        "run",
      ).state,
    ).toBe("finished");
    expect(
      answer(
        await client.simulationMetadataResource(catalog(first.id)),
        "catalog",
      ),
    ).toMatchObject({ execution: "failed", collection: "partial" });
    await client.simulationMetadataResource(catalog(first.id));
    expect(catalogReads()).toBe(4);
    // A complete catalog is reused.
    service.truncate = false;
    const second = await runDivider(editor, "run-2", 20_000);
    expect(second.state).toBe("finished");
    const complete = await client.simulationMetadataResource(
      catalog(second.id),
    );
    expect(answer(complete, "catalog")).toMatchObject({
      execution: "completed",
      collection: "complete",
    });
    expect(await client.simulationMetadataResource(catalog(second.id))).toEqual(
      complete,
    );
    expect(catalogReads()).toBe(5);
    // Export can repair publication, so nothing read before it is reused.
    expect(
      answer(
        await client.simulationResource({
          apiVersion: "3.0",
          requestId: "export",
          operation: "export",
          runId: second.id,
        }),
        "artifacts",
      ).length,
    ).toBeGreaterThan(0);
    await client.simulationMetadataResource(catalog(second.id));
    expect(catalogReads()).toBe(6);
    // A refresh drops the reused catalog before it asks, so a lost reply
    // leaves nothing to reuse.
    loseNextSimulationReply(http);
    await expect(
      client.simulationResource(catalog(second.id)),
    ).rejects.toMatchObject({ code: "EDITOR_DISCONNECTED" });
    expect(catalogReads()).toBe(7);
    await client.simulationMetadataResource(catalog(second.id));
    expect(catalogReads()).toBe(8);
    expect(service.runs).toHaveLength(2);
  });

  it("retries a simulation start only after a pre-dispatch offline rejection, with its original request identity", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const service = simulationService();
    const editor = liveAgentEditor({
      project: dividerProject(),
      simulationService: service.fetch,
      client: { sleep },
    });
    const { client, http } = editor;
    await client.connect("session-1.code");
    const prepared = await prepareDivider(editor);
    const method = vi.spyOn(http, "simulation");
    method.mockRejectedValueOnce(offline());
    const call = () =>
      client.simulationResource({
        apiVersion: "3.0",
        requestId: "stable-id",
        operation: "start",
        preparedId: prepared.id,
        digest: prepared.digest,
        waitMs: 20_000,
      });
    // The retry reaches the editor, which starts the run.
    expect(await call()).toMatchObject({
      ok: true,
      operation: "start",
      requestId: "stable-id",
      run: { preparedId: prepared.id, state: "finished" },
    });
    expect(sleep).toHaveBeenCalledWith(500);
    expect(method).toHaveBeenCalledTimes(2);
    expect(method.mock.calls[0]![2]).toEqual(method.mock.calls[1]![2]);
    expect(http.simulationCalls.map((item) => item.operation)).toEqual([
      "prepare",
      "start",
    ]);
    expect(service.runs).toHaveLength(1);
    // An uncertain failure may follow a start: it is never sent again.
    method.mockClear();
    method.mockRejectedValueOnce(lostReply());
    await expect(call()).rejects.toMatchObject({
      code: "EDITOR_DISCONNECTED",
    });
    expect(method).toHaveBeenCalledTimes(1);
    expect(service.runs).toHaveLength(1);
  });

  it("bounds offline recovery of a simulation start and never retries explicit revocation", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const service = simulationService();
    const editor = liveAgentEditor({
      project: dividerProject(),
      simulationService: service.fetch,
      client: { sleep },
    });
    const { client, http } = editor;
    await client.connect("session-1.code");
    const prepared = await prepareDivider(editor);
    // The relay finds the editor offline every time.
    const method = vi.spyOn(http, "simulation").mockRejectedValue(offline());
    const request = {
      apiVersion: "3.0" as const,
      requestId: "start-id",
      operation: "start" as const,
      preparedId: prepared.id,
      digest: prepared.digest,
    };
    await expect(client.simulationResource(request)).rejects.toMatchObject({
      code: "EDITOR_OFFLINE",
    });
    expect(method).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000, 2000]);
    // A person ends the session; the relay says so.
    method.mockReset();
    method.mockRejectedValue(
      new AgentSessionError(
        "SESSION_REVOKED",
        "revoked",
        "unrecoverable-credential",
        410,
      ),
    );
    await expect(client.simulationResource(request)).rejects.toMatchObject({
      code: "SESSION_REVOKED",
    });
    expect(method).toHaveBeenCalledTimes(1);
    expect((await client.status({ refresh: false })).sessionId).toBeNull();
    // The editor saw only the prepare; nothing ran.
    expect(http.simulationCalls.map((item) => item.operation)).toEqual([
      "prepare",
    ]);
    expect(service.runs).toEqual([]);
  });

  it("waits for the editor to publish a run's file using fresh descriptor IDs, without restarting the simulation", async () => {
    const service = simulationService();
    const relay = relayArtifactStorage();
    const editor = liveAgentEditor({
      project: dividerProject(),
      simulationService: service.fetch,
    });
    const { client, http, fileHost } = editor;
    // The session's transfer to the relay, which the session hook attaches.
    fileHost.setArtifactPublisher(relay.upload);
    await client.connect("session-1.code");
    const run = await runDivider(editor, "run-1", 20_000);
    expect(run.state).toBe("finished");
    const raw = answer(
      await client.simulationResource(catalog(run.id)),
      "catalog",
    ).files.find((file) => file.role === "raw")!;
    const simulationCalls = http.simulationCalls.length;
    const files = vi.spyOn(http, "files");
    const sleep = vi.fn(async (_ms: number) => {
      // The relay finishes storing the uploads during the second wait.
      if (sleep.mock.calls.length === 2) await relay.finish();
    });
    const descriptor = await client.prepareArtifactDownload(raw.id, "first", {
      sleep,
    });
    // The editor said the transfer was pending twice, then ready.
    const answers = await Promise.all(
      files.mock.results.map(({ value }) => value),
    );
    expect(answers).toMatchObject([
      { result: { ok: false, error: { code: "ARTIFACT_TRANSFER_PENDING" } } },
      { result: { ok: false, error: { code: "ARTIFACT_TRANSFER_PENDING" } } },
      {
        result: {
          ok: true,
          artifact: raw,
          download: { path: expect.any(String) },
        },
      },
    ]);
    expect(descriptor).toEqual(answers[2]);
    // Each poll was a new request, after the wait the editor suggested.
    const ids = files.mock.calls.map(([, , request]) => request.requestId);
    expect(ids[0]).toBe("first");
    expect(new Set(ids).size).toBe(3);
    expect(sleep.mock.calls).toEqual([[2000], [2000]]);
    // Only descriptors were read: nothing reached the Simulation resource,
    // nothing ran again and the session was not paired again.
    expect(http.simulationCalls).toHaveLength(simulationCalls);
    expect(service.runs).toHaveLength(1);
    expect(http.claims).toHaveLength(1);
    // The relay holds what ngspice wrote, where the descriptor points.
    expect(relay.stored.get(answers[2].result.download.path)).toBe(
      divider.rawfile,
    );
  });
});
