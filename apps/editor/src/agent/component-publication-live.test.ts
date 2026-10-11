import { describe, expect, it } from "vitest";
import { liveAgentEditor } from "./live-agent-editor.test-support";
import {
  AGENT_API_VERSION,
  AgentProjectResourceRequestSchema,
  AgentProjectResourceResponseSchema,
} from "@icm/agent-adapter";
import {
  componentLibraryHarness,
  nativePackage,
} from "../../../../worker/component-library.test-support";
import { createCircuitComponentPackageProject } from "@icm/edit-engine";
import { serializeProject, parseProject } from "@icm/project-protocol";
import {
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import { createEmptyProject } from "@icm/model";
import { EditorDocumentController } from "../document/document-controller";
import type { CircuitProject } from "@icm/model";
import { externalSubcircuitSymbolId } from "@icm/symbols";

function publicationEditor(project: CircuitProject) {
  const library = componentLibraryHarness();
  return liveAgentEditor({
    project,
    projectHost: {
      fetch: async (input, init) => {
        if (input === "/api/auth/me")
          return Response.json({ user: { id: "alice", isAdmin: false } });
        const url = new URL(String(input), "https://components.test");
        return library(
          init?.method ?? "GET",
          url.pathname.slice("/api/components".length) + url.search,
          init?.body ? JSON.parse(String(init.body)) : undefined,
          "alice",
        );
      },
    },
  });
}

describe("publication through a live Editor", () => {
  it("shares identity decisions, exact duplicate diagnostics, unchanged updates and captured provenance", async () => {
    const packaged = nativePackage();
    const { client, controller } = publicationEditor(
      createCircuitComponentPackageProject(packaged, "live-publication"),
    );
    const selection = {
      kind: "circuit",
      definitionId: packaged.circuit.externalDefinition.id,
      symbolId: packaged.definition.symbol.id,
      sourceRevision: 1,
    };
    await client.connect("session-1.code");
    await client.snapshot();
    const call = async (request: unknown) =>
      AgentProjectResourceResponseSchema.parse(
        await client.projectResource(
          AgentProjectResourceRequestSchema.parse({
            apiVersion: AGENT_API_VERSION,
            operation: "components",
            requestId: crypto.randomUUID(),
            request,
          }),
        ),
      );
    const published = await call({
      action: "publish",
      componentId: "live-publication-one",
      idempotencyKey: "live-one",
      publicationVersion: 1,
      projectId: controller.project.id,
      expectedStructureRevision: controller.project.structureRevision,
      selection,
    });
    expect(published).toMatchObject({
      ok: true,
      result: {
        publication: { outcome: "created", association: "associated" },
      },
    });
    const origin = controller.project.componentDefinitions![0]!.libraryOrigin;
    expect(origin).toMatchObject({
      componentId: "live-publication-one",
      revision: 1,
      authorId: "alice",
    });
    expect((await client.snapshot()).snapshot.project.structureRevision).toBe(
      controller.project.structureRevision,
    );
    expect(
      await call({
        action: "inspect",
        projectId: controller.project.id,
        expectedStructureRevision: controller.project.structureRevision,
        selection,
      }),
    ).toMatchObject({
      ok: true,
      result: {
        destination: {
          kind: "update",
          componentId: "live-publication-one",
          expectedLibraryRevision: 1,
        },
        stale: false,
      },
    });
    expect(
      await call({
        action: "publish",
        componentId: "live-publication-duplicate",
        idempotencyKey: "live-duplicate",
        publicationVersion: 1,
        projectId: controller.project.id,
        expectedStructureRevision: controller.project.structureRevision,
        selection,
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "COMPONENT_ALREADY_PUBLISHED",
        component: { id: "live-publication-one", revision: 1 },
      },
    });
    expect(
      await call({
        action: "update",
        componentId: "live-publication-one",
        expectedLibraryRevision: 1,
        idempotencyKey: "live-unchanged",
        publicationVersion: 1,
        projectId: controller.project.id,
        expectedStructureRevision: controller.project.structureRevision,
        selection,
      }),
    ).toMatchObject({
      ok: true,
      result: { entry: { revision: 1 }, publication: { outcome: "unchanged" } },
    });
    const inserted = await call({
      action: "insert",
      componentId: "live-publication-one",
      expectedLibraryRevision: 1,
      projectId: controller.project.id,
      targetDocumentId: controller.document.id,
      expectedStructureRevision: controller.project.structureRevision,
      expectedRevision: controller.document.revision,
      position: { x: 100, y: 100 },
    });
    expect(inserted).toMatchObject({ ok: true });
    const reloaded = parseProject(serializeProject(controller.project));
    const capture = captureProjectCopy(reloaded, reloaded.documents[0]!, {
      instanceIds: [reloaded.documents[0]!.instances[0]!.id],
      draftingIds: [],
      routeIds: [],
      junctionIds: [],
      annotationIds: [],
    });
    if (!capture) throw Error("Copy capture failed");
    const destination = new EditorDocumentController(
      createEmptyProject("copy-target", "Copy"),
    );
    const planned = planProjectCopyPlacement(
      destination.project,
      destination.document,
      capture,
      { x: 200, y: 100 },
      1,
    );
    const result = destination.dispatchProjectTransaction({
      transactionId: "copy-origin",
      projectId: destination.project.id,
      expectedStructureRevision: destination.project.structureRevision,
      actor: { kind: "human", id: "test" },
      edits: planned.edits,
    });
    expect(result.ok).toBe(true);
    expect(
      destination.project.componentDefinitions!.find(
        (definition) => definition.libraryOrigin,
      )?.libraryOrigin,
    ).toEqual(origin);
    const beforeUndo = destination.project;
    expect(destination.transact([{ kind: "undo" }]).ok).toBe(true);
    expect(destination.document.instances).toHaveLength(0);
    expect(destination.transact([{ kind: "redo" }]).ok).toBe(true);
    expect(destination.project.componentDefinitions).toEqual(
      beforeUndo.componentDefinitions,
    );
  });
  it("associates and inspects automatic native artwork while keeping legacy snapshots free of publication metadata", async () => {
    const project = createCircuitComponentPackageProject(
      nativePackage(),
      "automatic-native",
    );
    const owner = project.externalSubcircuitDefinitions[0]!;
    delete owner.symbolId;
    project.componentDefinitions = [];
    const { client, controller } = publicationEditor(project);
    await client.connect("session-1.code");
    const selection = {
      kind: "circuit" as const,
      definitionId: owner.id,
      symbolId: externalSubcircuitSymbolId(owner.id),
      sourceRevision: 1,
    };
    const call = (action: Record<string, unknown>) =>
      client.projectResource(
        AgentProjectResourceRequestSchema.parse({
          apiVersion: AGENT_API_VERSION,
          requestId: crypto.randomUUID(),
          operation: "components",
          request: {
            ...action,
            projectId: controller.project.id,
            expectedStructureRevision: controller.project.structureRevision,
            selection,
          },
        }),
      );
    expect(
      await call({
        action: "publish",
        componentId: "automatic-native-publication",
        idempotencyKey: "automatic-native-request",
        publicationVersion: 1,
      }),
    ).toMatchObject({
      ok: true,
      result: {
        publication: { outcome: "created", association: "associated" },
      },
    });
    expect(await call({ action: "inspect" })).toMatchObject({
      ok: true,
      result: {
        origin: { componentId: "automatic-native-publication" },
        destination: { kind: "update", expectedLibraryRevision: 1 },
      },
    });
    const snapshot = await client.snapshot();
    expect(
      snapshot.snapshot.project.externalSubcircuitDefinitions![0],
    ).not.toHaveProperty("libraryOrigin");
    expect(
      parseProject(serializeProject(controller.project))
        .externalSubcircuitDefinitions[0]!.libraryOrigin?.componentId,
    ).toBe("automatic-native-publication");
  });
});
