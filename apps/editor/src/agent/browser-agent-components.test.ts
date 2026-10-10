import { describe, expect, it } from "vitest";
import {
  AGENT_API_VERSION,
  AgentProjectResourceRequestSchema,
  AgentProjectResourceResponseSchema,
} from "@icm/agent-adapter";
import { createEmptyProject } from "@icm/model";
import {
  createCircuitComponentPackageProject,
  executeProjectTransaction,
} from "@icm/edit-engine";
import { BrowserAgentProjectHost } from "./browser-agent-project-host";
import {
  componentLibraryHarness,
  nativePackage,
} from "../../../../worker/component-library.test-support";

describe("Agent User Components", () => {
  it("reports invalid historical source explicitly instead of silently omitting it from Agent listings", async () => {
    let project = createEmptyProject("destination", "Destination");
    const before = structuredClone(project);
    const definition = nativePackage().definition;
    const legacy = {
      ...definition,
      circuitBinding: undefined,
      subcircuit: {
        id: "legacy-interface",
        symbolId: definition.symbol.id,
        target: "legacy",
        ports: [{ name: "A", pinName: "1", direction: "input" }],
      },
    };
    const host = new BrowserAgentProjectHost({
      getProject: () => project,
      getProjectSessionId: () => "session",
      getActiveDocumentId: () => project.topDocumentId,
      commitProjectStructure: (next) => {
        project = next;
      },
      dispatchProjectTransaction: (request) =>
        executeProjectTransaction(project, request),
      fetch: async () =>
        Response.json({
          entries: [
            {
              id: "legacy-device",
              revision: 1,
              authorId: "alice",
              author: "Alice",
              status: "shared",
              createdAt: "2026-01-01",
              updatedAt: "2026-01-01",
              definition: legacy,
            },
          ],
          nextCursor: null,
        }),
    });
    const result = await host.handle(
      AgentProjectResourceRequestSchema.parse({
        apiVersion: AGENT_API_VERSION,
        operation: "components",
        requestId: "invalid-list",
        request: { action: "list" },
      }),
    );
    expect(AgentProjectResourceResponseSchema.parse(result)).toMatchObject({
      ok: false,
      error: { code: "COMPONENT_INVALID", recovery: "fix-input" },
    });
    if (result.ok) throw Error("Invalid source was accepted");
    expect(result.error.message).toContain("legacy-device");
    expect(result.error.message).toContain("missing 2");
    expect(project).toEqual(before);
  });
  it("recovers an unknown public write with the same identity and rejects a Project changed during an insertion read", async () => {
    const library = componentLibraryHarness();
    const packaged = nativePackage();
    let project = createCircuitComponentPackageProject(packaged, "authoring");
    let loseReply = true;
    let changeProjectOnRead = false;
    let commits = 0;
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "authoring-session",
      getProject: () => project,
      getActiveDocumentId: () => project.topDocumentId,
      commitProjectStructure: (next) => {
        project = next;
      },
      fetch: async (input, init) => {
        const url = new URL(String(input), "https://components.test");
        const response = await library(
          init?.method ?? "GET",
          url.pathname.slice("/api/components".length) + url.search,
          init?.body ? JSON.parse(String(init.body)) : undefined,
          "alice",
        );
        if (init?.method === "PUT" && loseReply) {
          loseReply = false;
          throw new TypeError("Network reply lost");
        }
        if (!init?.method && changeProjectOnRead)
          project = {
            ...project,
            structureRevision: project.structureRevision + 1,
          };
        return response;
      },
      dispatchProjectTransaction: (request) => {
        const result = executeProjectTransaction(project, request);
        if (result.ok) {
          project = result.project;
          commits++;
        }
        return result;
      },
    });
    const call = (request: unknown) =>
      host.handle(
        AgentProjectResourceRequestSchema.parse({
          apiVersion: AGENT_API_VERSION,
          operation: "components",
          requestId: crypto.randomUUID(),
          request,
        }),
      );
    const publish = {
      action: "publish",
      componentId: "reply-lost-model",
      idempotencyKey: "reply-lost",
      projectId: project.id,
      expectedStructureRevision: project.structureRevision,
      selection: {
        kind: "circuit",
        definitionId: packaged.circuit.externalDefinition.id,
        symbolId: packaged.definition.symbol.id,
        sourceRevision: 1,
      },
    };
    expect(await call(publish)).toMatchObject({
      ok: false,
      error: { code: "COMPONENT_WRITE_UNKNOWN", recovery: "retry" },
    });
    expect(await call(publish)).toMatchObject({
      ok: true,
      result: { entry: { revision: 1 } },
    });
    project = createEmptyProject("destination", "Destination");
    changeProjectOnRead = true;
    expect(
      await call({
        action: "insert",
        componentId: "reply-lost-model",
        expectedLibraryRevision: 1,
        projectId: project.id,
        targetDocumentId: project.topDocumentId,
        expectedStructureRevision: 0,
        expectedRevision: 0,
        position: { x: 0, y: 0 },
      }),
    ).toMatchObject({ ok: false, error: { code: "STALE_STRUCTURE_REVISION" } });
    expect(commits).toBe(0);
    expect(project.modelSources ?? []).toEqual([]);
    expect(project.documents[0]!.instances).toEqual([]);
  });
  it("publishes, recovers, forks and captures a fixed public revision through the ordinary Project transaction", async () => {
    const library = componentLibraryHarness();
    let user = "alice";
    const fetchLibrary: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        "https://components.test",
      );
      return library(
        init?.method ?? "GET",
        url.pathname.slice("/api/components".length) + url.search,
        init?.body ? JSON.parse(String(init.body)) : undefined,
        user,
      );
    };
    const packaged = nativePackage();
    let project = createCircuitComponentPackageProject(packaged, "authoring");
    let session = "original";
    let commits = 0;
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => session,
      getProject: () => project,
      getActiveDocumentId: () => project.topDocumentId,
      fetch: fetchLibrary,
      commitProjectStructure: (next) => {
        project = next;
      },
      dispatchProjectTransaction: (request) => {
        const result = executeProjectTransaction(project, request);
        if (result.ok) {
          project = result.project;
          commits++;
        }
        return result;
      },
    });
    const call = async (request: unknown, requestId = crypto.randomUUID()) => {
      const input = AgentProjectResourceRequestSchema.parse({
        apiVersion: AGENT_API_VERSION,
        operation: "components",
        requestId,
        request,
      });
      return AgentProjectResourceResponseSchema.parse(await host.handle(input));
    };
    const publish = {
      action: "publish",
      componentId: "agent-resistor",
      idempotencyKey: "publish-resistor",
      projectId: project.id,
      expectedStructureRevision: 0,
      selection: {
        kind: "circuit",
        definitionId: packaged.circuit.externalDefinition.id,
        symbolId: packaged.definition.symbol.id,
        sourceRevision: 1,
      },
    };
    const first = await call(publish);
    expect(first).toMatchObject({
      ok: true,
      result: {
        action: "publish",
        entry: { id: "agent-resistor", revision: 1, authorId: "alice" },
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(await call(publish)).toEqual({
      ...first,
      requestId: expect.any(String),
    });
    expect(
      await call({ action: "read", componentId: "agent-resistor" }),
    ).toMatchObject({
      ok: true,
      result: {
        entry: {
          revision: 1,
          circuit: { source: { files: packaged.circuit.source.files } },
        },
      },
    });
    expect(await call({ action: "list", query: "Packaged" })).toMatchObject({
      ok: true,
      result: { entries: [expect.objectContaining({ id: "agent-resistor" })] },
    });
    user = "bob";
    expect(
      await call({
        ...publish,
        action: "update",
        expectedLibraryRevision: 1,
        idempotencyKey: "bob-update",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "COMPONENT_PERMISSION_DENIED" },
    });
    expect(
      await call({
        action: "fork",
        componentId: "agent-resistor",
        expectedLibraryRevision: 1,
        newComponentId: "bob-resistor",
        idempotencyKey: "bob-fork",
      }),
    ).toMatchObject({
      ok: true,
      result: { entry: { authorId: "bob", revision: 1 } },
    });
    project = createEmptyProject("destination", "Destination");
    const insert = {
      action: "insert",
      componentId: "agent-resistor",
      expectedLibraryRevision: 1,
      projectId: project.id,
      targetDocumentId: project.topDocumentId,
      expectedStructureRevision: 0,
      expectedRevision: 0,
      position: { x: 120, y: 80 },
    };
    expect(await call(insert)).toMatchObject({
      ok: true,
      result: { action: "insert", structureRevision: 1, revision: 1 },
    });
    expect(commits).toBe(1);
    expect(project.documents[0]!.instances[0]).toMatchObject({
      symbolId: "user-agent-resistor-r1",
      reference: "X1",
      placement: { position: { x: 120, y: 80 } },
      netlist: { binding: { kind: "external-subcircuit" } },
    });
    expect(project.modelSources?.[0]?.files).toEqual(
      packaged.circuit.source.files,
    );
    expect(
      project.componentDefinitions?.[0]?.circuitBinding?.terminals,
    ).toHaveLength(2);
    expect(await call({ ...insert, expectedLibraryRevision: 2 })).toMatchObject(
      { ok: false, error: { code: "COMPONENT_REVISION_CONFLICT" } },
    );
    expect(await call(insert)).toMatchObject({
      ok: false,
      error: { code: "STALE_STRUCTURE_REVISION" },
    });
    expect(commits).toBe(1);
    session = "replacement";
    expect(
      await call({ action: "read", componentId: "agent-resistor" }),
    ).toMatchObject({ ok: false, error: { code: "PROJECT_REPLACED" } });
  });
});
