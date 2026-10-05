import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionStatusResponse } from "@icm/agent-adapter";
import { createSimulationFolder } from "@icm/model";
import { describe, expect, it, vi } from "vitest";
import { ConnectorStore } from "../../../../packages/agent-client/src/connector-store";
import { AgentSessionError } from "../../../../packages/agent-client/src/errors";
import type {
  AgentHttpClient,
  ClaimSuccess,
} from "../../../../packages/agent-client/src/http-client";
import { AgentSessionClient } from "../../../../packages/agent-client/src/session-client";
import type { EditorDocumentController } from "../document/document-controller";
import {
  ALL_AGENT_SCOPES,
  emptyAgentProject,
  liveAgentEditor,
  personEdits,
} from "./live-agent-editor.test-support";

const place = (symbol: string, reference: string, x: number) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y: 100 },
});
const pin = (instance: string, name: string) => ({
  kind: "pin",
  instance,
  pin: name,
});

/** The relay's answer to a claim, for the live editor's empty Project. */
const claim = (changes: Partial<ClaimSuccess> = {}): ClaimSuccess => ({
  sessionId: "session-1",
  agentToken: "token-0123456789abcdef0123456789abcdef",
  tokenExpiresAt: Number.MAX_SAFE_INTEGER,
  connectorToken: "connector-0123456789abcdef0123456789abcdef",
  connectorExpiresAt: Number.MAX_SAFE_INTEGER,
  scopes: [...ALL_AGENT_SCOPES],
  projectId: "project-1",
  documentIds: ["main"],
  ...changes,
});

/** What the relay observes of the session: the editor's Project, attached. */
const observation = (
  controller: EditorDocumentController,
  changes: Partial<AgentSessionStatusResponse> = {},
): AgentSessionStatusResponse => ({
  ok: true,
  sessionId: "session-1",
  projectId: controller.project.id,
  documentIds: controller.project.documents.map((item) => item.id),
  authorization: "active",
  editor: "attached",
  observedAt: 1000,
  expiresAt: 999_999,
  ...changes,
});

/** A connector file in a fresh directory, removed afterwards. */
async function withConnectorFile(
  run: (store: ConnectorStore) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "analog-connector-"));
  try {
    await run(new ConnectorStore(join(directory, "connector.json")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A new Helper process on the same relay, with only the connector file. */
const restartedHelper = (http: AgentHttpClient, store: ConnectorStore) =>
  new AgentSessionClient({
    http,
    connectorStore: store,
    sleep: async () => {},
  });

describe("pairing the Agent client with the live editor", () => {
  it("starts capabilities and bootstrap Snapshot in the same post-claim wave", async () => {
    const { client, http, controller } = liveAgentEditor();
    // Hold every answer until both requests have left.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const editor = http.circuitHandler;
    http.circuitHandler = async (call) => {
      await gate;
      return editor(call);
    };
    const pending = client.connect("session-1.claim-code");
    await vi.waitFor(() => expect(http.circuitCalls).toHaveLength(2));
    expect(
      new Set(http.circuitCalls.map((call) => call.request.operation)),
    ).toEqual(new Set(["capabilities", "snapshot"]));
    release();
    await expect(pending).resolves.toMatchObject({
      mode: "claimed",
      context: { revision: controller.document.revision },
    });
  });

  it("reads state and folder directory without a full Snapshot, then reuses a clean cache", async () => {
    const project = emptyAgentProject();
    project.simulationFolders.push(
      createSimulationFolder({
        id: "bias",
        name: "Bias",
        profileId: "test",
        documentId: "main",
      }),
    );
    const { client, http, controller } = liveAgentEditor({ project });
    await client.connect("session-1.claim-code");
    expect((await client.applyActions([place("resistor", "R1", 100)])).ok).toBe(
      true,
    );
    const state = await client.documentState();
    expect(state).toMatchObject({
      projection: "state",
      revision: controller.document.revision,
      instanceCount: 1,
    });
    const directory = await client.simulationFolderDirectory();
    expect(directory).toMatchObject({
      projection: "folder-directory",
      revision: controller.document.revision,
      folders: [
        {
          id: "bias",
          name: "Bias",
          entry: "run.cir",
          circuitBindings: [{ documentId: "main" }],
        },
      ],
    });
    expect(
      http.circuitCalls
        .filter((call) => call.request.operation === "snapshot")
        .map((call) =>
          call.request.operation === "snapshot"
            ? call.request.projection
            : undefined,
        ),
    ).toEqual(["bootstrap", "state", "folder-directory"]);
    await client.refreshSnapshot("main");
    const calls = http.circuitCalls.length;
    // The full Snapshot answers both, as the editor did.
    expect(await client.documentState()).toMatchObject({
      revision: state.revision,
      counts: state.counts,
    });
    expect(await client.simulationFolderDirectory()).toMatchObject({
      folders: directory.folders,
    });
    expect(http.circuitCalls).toHaveLength(calls);
  });

  it("marks a cached full Snapshot dirty when a lightweight read observes a person's newer revision", async () => {
    const { client, controller } = liveAgentEditor();
    await client.connect("session-1.claim-code");
    expect((await client.applyActions([place("resistor", "R1", 100)])).ok).toBe(
      true,
    );
    const cached = await client.refreshSnapshot("main");
    // A person moves R1 while the Agent holds its full Snapshot.
    personEdits(controller, [
      {
        kind: "move_instance",
        instanceId: controller.document.instances[0]!.id,
        position: { x: 300, y: 300 },
      },
    ]);
    expect(controller.document.revision).toBeGreaterThan(cached.revision);
    expect(
      await client.documentState(undefined, { refresh: true }),
    ).toMatchObject({ revision: controller.document.revision });
    expect(client.cachedSnapshot("main")?.dirty).toBe(true);
    expect(await client.simulationFolderDirectory()).toMatchObject({
      revision: controller.document.revision,
    });
  });

  it("reads relay observations without a Circuit probe and retains pairing on network failure", async () => {
    const { client, http, controller } = liveAgentEditor();
    await client.connect("session-1.code");
    const calls = http.circuitCalls.length;
    const probe = vi
      .spyOn(http, "status")
      .mockResolvedValue(observation(controller, { authorization: "paused" }));
    expect(await client.status({ refresh: true })).toMatchObject({
      state: "paused",
    });
    probe.mockRejectedValueOnce(
      new AgentSessionError("NETWORK_FAILURE", "timeout", "network"),
    );
    expect(await client.status({ refresh: true })).toMatchObject({
      state: "unknown",
      projectId: controller.project.id,
      tokenValid: true,
    });
    probe.mockResolvedValue(observation(controller, { observedAt: 2000 }));
    expect(await client.status({ refresh: true })).toMatchObject({
      state: "attached",
    });
    expect(http.circuitCalls).toHaveLength(calls);
    expect((await client.snapshot("main", { refresh: true })).revision).toBe(
      controller.document.revision,
    );
    expect((await client.status()).state).toBe("online");
    expect(http.claims).toHaveLength(1);
  });

  it("never exposes the token through status or connect reports", async () => {
    const { client } = liveAgentEditor();
    const report = await client.connect("session-1.claim-code");
    const status = JSON.stringify({ report, status: await client.status() });
    expect(status).not.toContain("token-0123456789abcdef");
    expect(status).not.toContain("agentToken");
  });

  it("re-checks the active session without a new claim", async () => {
    const { client, http, controller } = liveAgentEditor();
    await client.connect("session-1.claim-code");
    expect((await client.applyActions([place("resistor", "R1", 100)])).ok).toBe(
      true,
    );
    // A person moves R1 before the Agent checks back.
    personEdits(controller, [
      {
        kind: "move_instance",
        instanceId: controller.document.instances[0]!.id,
        position: { x: 300, y: 300 },
      },
    ]);
    vi.spyOn(http, "status").mockResolvedValue(observation(controller));
    const capabilityCalls = http.circuitCalls.filter(
      (call) => call.request.operation === "capabilities",
    ).length;
    const callsBeforeResume = http.circuitCalls.length;
    const report = await client.connect();
    expect(report.mode).toBe("resumed");
    expect(report.context?.revision).toBe(controller.document.revision);
    expect(http.claims).toEqual(["session-1.claim-code"]);
    expect(
      http.circuitCalls.filter(
        (call) => call.request.operation === "capabilities",
      ),
    ).toHaveLength(capabilityCalls);
    expect(
      http.circuitCalls.slice(callsBeforeResume).map((call) => call.request),
    ).toEqual([
      expect.objectContaining({
        operation: "snapshot",
        projection: "bootstrap",
      }),
    ]);
  });

  it("resumes a browser-approved connector in a new Helper process", async () => {
    await withConnectorFile(async (store) => {
      const { client, http, controller } = liveAgentEditor({
        client: { connectorStore: store },
      });
      await client.connect("session-1.claim-code");
      expect(
        (await client.applyActions([place("resistor", "R1", 100)])).ok,
      ).toBe(true);

      const restarted = restartedHelper(http, store);
      vi.spyOn(http, "status").mockResolvedValue(observation(controller));
      const report = await restarted.connect();
      expect(report.mode).toBe("resumed");
      expect(http.resumes).toEqual([
        {
          sessionId: "session-1",
          connectorToken: "connector-0123456789abcdef0123456789abcdef",
        },
      ]);
      // The new process sees the Document the first one left.
      expect(report.context).toMatchObject({
        projectId: controller.project.id,
        revision: controller.document.revision,
        instanceCount: 1,
      });
      expect(JSON.stringify(await restarted.status())).not.toContain(
        "connectorToken",
      );
    });
  });

  it.each(["snapshot", "refreshSnapshot", "render", "traceNet"] as const)(
    "resumes before selecting the default document for %s in a fresh process",
    async (operation) => {
      await withConnectorFile(async (store) => {
        const { client, http, controller } = liveAgentEditor({
          client: { connectorStore: store },
        });
        await client.connect("session-1.code");
        for (const actions of [
          [place("resistor", "R1", 100), place("resistor", "R2", 300)],
          [{ kind: "connect", from: pin("R1", "2"), to: pin("R2", "1") }],
        ]) {
          const report = await client.applyActions(actions);
          expect(report.ok, report.message).toBe(true);
        }
        const restarted = restartedHelper(http, store);
        const callsBeforeProbe = http.circuitCalls.length;
        // A cache probe stays local: no resume, no request.
        expect(restarted.cachedSnapshot()).toBeNull();
        expect(http.resumes).toHaveLength(0);
        expect(http.circuitCalls).toHaveLength(callsBeforeProbe);
        const revision = controller.document.revision;
        if (operation === "traceNet") {
          const netId = controller.document.nets[0]!.id;
          const traced = await restarted.traceNet({ netId });
          expect(traced.revision).toBe(revision);
          expect(traced.trace?.highlights.map((item) => item.netId)).toContain(
            netId,
          );
        } else if (operation === "render") {
          const rendered = await restarted.render();
          expect(rendered.revision).toBe(revision);
          expect(rendered.artifact.mediaType).toBe("image/svg+xml");
          expect(restarted.cachedSnapshot("main")).toBeNull();
        } else {
          const read = await restarted[operation]();
          expect(read.revision).toBe(revision);
          expect(
            read.snapshot.document.instances
              .map((item) => item.reference)
              .sort(),
          ).toEqual(["R1", "R2"]);
          expect(restarted.cachedSnapshot()).toEqual(
            restarted.cachedSnapshot("main"),
          );
          expect(restarted.cachedSnapshot()).not.toBeNull();
        }
        expect(http.resumes).toHaveLength(1);
        expect(http.claims).toHaveLength(1);
        // One request, for the editor's top Document.
        expect(
          http.circuitCalls.slice(callsBeforeProbe).map((call) => call.request),
        ).toEqual([expect.objectContaining({ documentId: "main" })]);
      });
    },
  );

  it("does not retry a revoked connector or fetch a document after failed recovery", async () => {
    await withConnectorFile(async (store) => {
      const { client, http } = liveAgentEditor({
        client: { connectorStore: store },
      });
      await client.connect("session-1.code");
      const calls = http.circuitCalls.length;
      const resume = vi
        .spyOn(http, "resumeConnector")
        .mockRejectedValue(
          new AgentSessionError(
            "SESSION_REVOKED",
            "revoked",
            "unrecoverable-credential",
          ),
        );
      const restarted = restartedHelper(http, store);
      expect(restarted.cachedSnapshot()).toBeNull();
      expect(restarted.cachedSnapshot("main")).toBeNull();
      expect(resume).not.toHaveBeenCalled();
      await expect(restarted.snapshot()).rejects.toMatchObject({
        code: "SESSION_REVOKED",
      });
      expect(resume).toHaveBeenCalledTimes(1);
      expect(http.circuitCalls).toHaveLength(calls);
      expect(await store.load()).toBeNull();
    });
  });

  it("refreshes an expired bearer even after the saved connector deadline passed", async () => {
    await withConnectorFile(async (store) => {
      let nowMs = 1_000;
      const paired = claim({
        agentToken: "initial-token",
        tokenExpiresAt: 50_000,
        connectorToken: "connector-token",
        connectorExpiresAt: 60_000,
        scopes: ["circuit.snapshot"],
      });
      const { client, http, controller } = liveAgentEditor({
        scopes: ["circuit.snapshot"],
        relay: {
          claim: () => paired,
          resume: () => ({
            ...paired,
            agentToken: "refreshed-token",
            tokenExpiresAt: 400_000,
          }),
        },
        client: { connectorStore: store, now: () => nowMs },
      });
      await client.connect("session-1.code");
      nowMs = 100_000;
      const refreshed = await client.refreshSnapshot();
      expect(refreshed.revision).toBe(controller.document.revision);
      expect(http.resumes).toHaveLength(1);
      expect(http.circuitCalls.at(-1)?.token).toBe("refreshed-token");
    });
  });

  it("fails with TOKEN_EXPIRED when the clock passes tokenExpiresAt", async () => {
    let nowMs = 1_000;
    const { client, http } = liveAgentEditor({
      relay: {
        claim: () =>
          claim({
            tokenExpiresAt: 1_000_000,
            connectorToken: "connector-expiring-token",
            connectorExpiresAt: 3_000_000,
          }),
      },
      client: { now: () => nowMs },
    });
    await client.connect("session-1.code");
    const calls = http.circuitCalls.length;
    nowMs = 2_000_000;
    await expect(client.status()).resolves.toMatchObject({ tokenValid: false });
    await expect(client.refreshSnapshot()).rejects.toMatchObject({
      code: "TOKEN_EXPIRED",
    });
    expect(client.connection.snapshot.state).toBe("revoked");
    // The expired bearer never reached the editor.
    expect(http.circuitCalls).toHaveLength(calls);
  });

  it("clears the active credential when the server revokes the session", async () => {
    const { client, http } = liveAgentEditor();
    await client.connect("session-1.code");
    // The relay refuses the bearer once the person revokes the session.
    vi.spyOn(http, "circuit").mockRejectedValueOnce(
      new AgentSessionError(
        "SESSION_REVOKED",
        "revoked",
        "unrecoverable-credential",
        401,
      ),
    );
    await expect(client.capabilities({ force: true })).rejects.toMatchObject({
      code: "SESSION_REVOKED",
    });
    expect(client.connection.snapshot.state).toBe("revoked");
    await expect(client.connect()).rejects.toMatchObject({
      code: "CLAIM_REQUIRED",
    });
  });
});
