import { expect, it } from "vitest";
import {
  AgentProjectResourceResponseSchema,
  type AgentComponentLibraryAction,
} from "@icm/agent-adapter";
import { createEmptyProject } from "@icm/model";
import { liveAgentEditor } from "./live-agent-editor.test-support";
import {
  ComponentAuthoringWorkspace,
  registerComponentAuthoring,
} from "../features/user-components/component-authoring-workspace";
import {
  componentLibraryHarness,
  nativePackage,
} from "../../../../worker/component-library.test-support";

it("guards a shared source while publication has invalidated candidate validation", async () => {
  const project = createEmptyProject("shared-drafts", "Shared drafts");
  project.modelSources = [
    {
      id: "shared",
      revision: 0,
      language: "spice",
      entry: "a.spice",
      files: [{ path: "a.spice", text: "* applied" }],
      dependencies: [],
      draft: {
        baseRevision: 0,
        entry: "a.spice",
        files: [{ path: "a.spice", text: "* pending" }],
        authoring: [
          {
            definitionId: "peer",
            entry: "peer",
            symbolMode: "automatic",
            artworkText: "",
            portMaps: {},
          },
        ],
      },
    },
  ];
  const editor = liveAgentEditor({ project });
  await editor.client.connect("claim");
  const workspace = new ComponentAuthoringWorkspace(
    {
      projectId: project.id,
      projectSessionId: editor.controller.projectSessionId,
      draftId: "active",
    },
    "new",
  );
  workspace.document("definition", "raw");
  workspace.activate("definition");
  workspace.bindCommands("definition", {
    canApply: false,
    diagnostics: [],
    context: { sourceId: "shared", definitionId: "active" },
    save: () => null,
    apply: () => null,
  });
  const close = registerComponentAuthoring(workspace);
  try {
    workspace.setOperationPending(true);
    expect(workspace.snapshot()?.context).toBeUndefined();
    const response = await editor.client.projectResource({
      apiVersion: "3.0",
      operation: "components",
      requestId: "delete-peer",
      request: {
        action: "delete-drafts",
        projectId: project.id,
        projectSessionId: editor.controller.projectSessionId,
        expectedStructureRevision: 0,
        targets: [
          { kind: "circuit", sourceId: "shared", definitionId: "peer" },
        ],
        dryRun: false,
      },
    });
    expect(response).toMatchObject({
      ok: false,
      error: { code: "AUTHORING_OPERATION_BUSY" },
    });
    expect(editor.controller.project).toEqual(project);
  } finally {
    close();
  }
});

it("manages saved checkpoints over the live bridge while preserving current raw input", async () => {
  const project = createEmptyProject("drafts", "drafts");
  project.componentAuthoringDrafts = [{ id: "draft", text: "{ broken 中" }];
  const editor = liveAgentEditor({ project });
  await editor.client.connect("claim");
  const target = {
    projectId: project.id,
    projectSessionId: editor.controller.projectSessionId,
  };
  const workspace = new ComponentAuthoringWorkspace(
    { ...target, draftId: "draft" },
    "new",
  );
  const document = workspace.document("definition", "{ broken 中", "saved");
  workspace.activate("definition");
  const close = registerComponentAuthoring(workspace);
  const call = async (request: AgentComponentLibraryAction) =>
    AgentProjectResourceResponseSchema.parse(
      await editor.client.projectResource({
        apiVersion: "3.0",
        operation: "components",
        requestId: crypto.randomUUID(),
        request,
      }),
    );
  try {
    expect(await call({ action: "drafts", ...target })).toMatchObject({
      ok: true,
      result: {
        catalog: {
          entries: [{ target: { kind: "component", draftId: "draft" } }],
        },
      },
    });
    document.set("new unsaved 中");
    const stale = workspace.snapshot()!;
    const request = {
      action: "delete-drafts" as const,
      ...target,
      expectedStructureRevision: 0,
      targets: [{ kind: "component" as const, draftId: "draft" }],
      dryRun: false,
    };
    expect(await call({ ...request, dryRun: true })).toMatchObject({
      ok: true,
    });
    expect(editor.controller.project.componentAuthoringDrafts).toHaveLength(1);
    workspace.setOperationPending(true);
    expect(await call(request)).toMatchObject({
      ok: false,
      error: { code: "AUTHORING_OPERATION_BUSY" },
    });
    workspace.setOperationPending(false);
    expect(await call(request)).toMatchObject({
      ok: true,
      result: { catalog: { entries: [] } },
    });
    expect(document.read()).toBe("new unsaved 中");
    expect(document.checkpoints.saved).toBe(false);
    expect(document.dirty).toBe(true);
    expect(
      await call({
        action: "authoring-update",
        target: stale.target,
        expectedCandidateRevision: stale.candidateRevision,
        candidate: { kind: "definition", text: "overwrite" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "AUTHORING_REVISION_CONFLICT" },
    });
    expect(await call(request)).toMatchObject({
      ok: false,
      error: { code: "STALE_STRUCTURE_REVISION" },
    });
  } finally {
    close();
  }
});

it("shares lifecycle permissions with HTTP even for malformed public records", async () => {
  const library = componentLibraryHarness();
  library.seed({
    id: "invalid-record",
    authorId: "alice",
    definition: { bad: true },
  });
  const editor = liveAgentEditor({
    projectHost: {
      fetch: async (input, init) => {
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
  await editor.client.connect("claim");
  const call = async (request: AgentComponentLibraryAction) =>
    AgentProjectResourceResponseSchema.parse(
      await editor.client.projectResource({
        apiVersion: "3.0",
        operation: "components",
        requestId: crypto.randomUUID(),
        request,
      }),
    );
  expect(
    await call({
      action: "delete",
      componentId: "invalid-record",
      expectedLibraryRevision: 1,
    }),
  ).toMatchObject({
    ok: true,
    result: { entry: { status: "deleted", revision: 2 } },
  });
  expect(await call({ action: "browse", deleted: true })).toMatchObject({
    ok: true,
    result: { entries: [{ id: "invalid-record", capability: "needs-repair" }] },
  });
  expect(
    await call({
      action: "record",
      componentId: "invalid-record",
      expectedLibraryRevision: 2,
      deleted: true,
    }),
  ).toMatchObject({
    ok: true,
    result: {
      record: {
        id: "invalid-record",
        status: "deleted",
        definition: { bad: true },
      },
    },
  });
  expect(
    await call({
      action: "restore",
      componentId: "invalid-record",
      expectedLibraryRevision: 2,
    }),
  ).toMatchObject({
    ok: true,
    result: { entry: { status: "shared", revision: 3 } },
  });
  library.seed({
    id: "valid-deleted",
    authorId: "alice",
    status: "deleted",
    definition: { symbol: nativePackage().definition.symbol },
  });
  expect(
    await call({ action: "read", componentId: "valid-deleted" }),
  ).toMatchObject({
    ok: true,
    result: { entry: { id: "valid-deleted", status: "deleted" } },
  });
});

it("acknowledges only deletion from the checkpoint the editor already expected", () => {
  const workspace = new ComponentAuthoringWorkspace(
    { projectId: "p", projectSessionId: "s", draftId: "d" },
    "new",
  );
  workspace.acknowledgeSourceCheckpoint({
    sourceId: "source",
    before: "external edit B",
    value: "after deletion C",
  });
  expect(
    workspace.acceptsManagedCheckpoint(
      "source",
      "open input A",
      "after deletion C",
    ),
  ).toBe(false);
  expect(
    workspace.acceptsManagedCheckpoint(
      "source",
      "external edit B",
      "after deletion C",
    ),
  ).toBe(true);
  expect(
    workspace.acceptsManagedCheckpoint(
      "source",
      "external edit B",
      "later edit D",
    ),
  ).toBe(false);
});
