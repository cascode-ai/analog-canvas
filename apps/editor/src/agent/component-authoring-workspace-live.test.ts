import { expect, it } from "vitest";
import {
  AGENT_API_VERSION,
  type AgentComponentLibraryAction,
} from "@icm/agent-adapter";
import { liveAgentEditor } from "./live-agent-editor.test-support";
import {
  ComponentAuthoringWorkspace,
  registerComponentAuthoring,
} from "../features/user-components/component-authoring-workspace";

it("retains explicitly empty Custom artwork when an Agent edits the native candidate", async () => {
  const editor = liveAgentEditor();
  await editor.client.connect("claim");
  const workspace = new ComponentAuthoringWorkspace(
    {
      projectId: editor.controller.project.id,
      projectSessionId: editor.controller.projectSessionId,
      draftId: "native-draft",
    },
    "new",
  );
  workspace.document("circuit", {
    language: "spice",
    entryPath: "model.spice",
    files: [{ path: "model.spice", text: ".subckt empty\n.ends empty" }],
    dependencies: [],
    entry: "empty",
    portMaps: {},
    symbolMode: "automatic",
    artworkText: "",
    artworkInitialized: false,
    terminalDirections: {},
  });
  const close = registerComponentAuthoring(workspace);
  try {
    const initial = workspace.snapshot()!;
    if (initial.candidate.kind !== "circuit")
      throw Error("Expected native candidate");
    const response = await editor.client.projectResource({
      apiVersion: "3.0",
      operation: "components",
      requestId: "custom-empty",
      request: {
        action: "authoring-update",
        target: initial.target,
        expectedCandidateRevision: initial.candidateRevision,
        candidate: {
          kind: "circuit",
          value: { ...initial.candidate.value, symbolMode: "custom" },
        },
      },
    });
    expect(response).toMatchObject({
      ok: true,
      result: {
        workspace: {
          candidate: {
            kind: "circuit",
            value: { artworkText: "", artworkInitialized: true },
          },
        },
      },
    });
    const custom = workspace.snapshot()!;
    if (custom.candidate.kind !== "circuit")
      throw Error("Expected native candidate");
    expect(
      await editor.client.projectResource({
        apiVersion: "3.0",
        operation: "components",
        requestId: "automatic-retained",
        request: {
          action: "authoring-update",
          target: custom.target,
          expectedCandidateRevision: custom.candidateRevision,
          candidate: {
            kind: "circuit",
            value: {
              ...custom.candidate.value,
              symbolMode: "automatic",
              artworkInitialized: false,
            },
          },
        },
      }),
    ).toMatchObject({
      ok: true,
      result: {
        workspace: {
          candidate: {
            value: {
              symbolMode: "automatic",
              artworkText: "",
              artworkInitialized: true,
            },
          },
        },
      },
    });
  } finally {
    close();
  }
});

it("reads and edits unfinished native dependency fields as raw input", async () => {
  const editor = liveAgentEditor();
  await editor.client.connect("claim");
  const before = structuredClone(editor.controller.project);
  const workspace = new ComponentAuthoringWorkspace(
    {
      projectId: before.id,
      projectSessionId: editor.controller.projectSessionId,
      draftId: "raw-dependency",
    },
    "new",
  );
  const initial = {
    language: "spice" as const,
    entryPath: "model.spice",
    files: [{ path: "model.spice", text: "* unfinished" }],
    dependencies: [],
    entry: "",
    portMaps: {},
    symbolMode: "automatic" as const,
    artworkText: "",
    terminalDirections: {},
  };
  workspace.document("circuit", initial);
  const close = registerComponentAuthoring(workspace);
  try {
    const snapshot = workspace.snapshot()!;
    const candidate = {
      kind: "circuit" as const,
      value: {
        ...initial,
        dependencies: [{ id: "", mountPath: "../unfinished", sha256: "abc" }],
      },
    };
    expect(
      await editor.client.projectResource({
        apiVersion: "3.0",
        operation: "components",
        requestId: "unfinished-dependency",
        request: {
          action: "authoring-update",
          target: snapshot.target,
          expectedCandidateRevision: snapshot.candidateRevision,
          candidate,
        },
      }),
    ).toMatchObject({ ok: true, result: { workspace: { candidate } } });
    expect(
      await editor.client.projectResource({
        apiVersion: "3.0",
        operation: "components",
        requestId: "read-unfinished-dependency",
        request: { action: "authoring-read" },
      }),
    ).toMatchObject({ ok: true, result: { workspace: { candidate } } });
    expect(editor.controller.project).toEqual(before);
  } finally {
    close();
  }
});

it("shares raw candidates with the Agent while refusing stale versions, composition and closed targets", async () => {
  const editor = liveAgentEditor();
  await editor.client.connect("claim");
  const before = structuredClone(editor.controller.project);
  const workspace = new ComponentAuthoringWorkspace(
    {
      projectId: before.id,
      projectSessionId: editor.controller.projectSessionId,
      draftId: "draft-one",
    },
    "new",
  );
  const document = workspace.document("definition", "{ unfinished");
  workspace.activate("definition");
  const close = registerComponentAuthoring(workspace);
  let requestId = 0;
  const send = (request: AgentComponentLibraryAction) =>
    editor.client.projectResource({
      apiVersion: AGENT_API_VERSION,
      operation: "components",
      requestId: `draft-${requestId++}`,
      request,
    });
  try {
    expect(await send({ action: "authoring-read" })).toMatchObject({
      ok: true,
      result: {
        workspace: {
          candidate: { kind: "definition", text: "{ unfinished" },
          scope: "new",
        },
      },
    });
    const initial = workspace.snapshot()!;
    document.set("{ person is typing");
    expect(
      await send({
        action: "authoring-update",
        target: initial.target,
        expectedCandidateRevision: initial.candidateRevision,
        candidate: { kind: "definition", text: "{ agent" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "AUTHORING_REVISION_CONFLICT" },
    });
    const current = workspace.snapshot()!;
    workspace.setComposing(true);
    const update = {
      action: "authoring-update" as const,
      target: current.target,
      expectedCandidateRevision: current.candidateRevision,
      candidate: { kind: "definition" as const, text: "{ agent candidate" },
    };
    expect(await send(update)).toMatchObject({
      ok: false,
      error: { code: "AUTHORING_INPUT_BUSY" },
    });
    workspace.setComposing(false);
    expect(await send(update)).toMatchObject({
      ok: true,
      result: { workspace: { candidate: update.candidate, dirty: true } },
    });
    expect(document.read()).toBe(update.candidate.text);
    workspace.setOperationPending(true);
    const publishing = workspace.snapshot()!;
    expect(
      await send({
        action: "authoring-save",
        target: publishing.target,
        expectedCandidateRevision: publishing.candidateRevision,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "AUTHORING_OPERATION_BUSY" },
    });
    expect(document.read()).toBe(update.candidate.text);
    workspace.setOperationPending(false);
    expect(
      await send({
        action: "authoring-apply",
        target: current.target,
        expectedCandidateRevision: workspace.snapshot()!.candidateRevision,
        dryRun: true,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "AUTHORING_VALIDATION_PENDING" },
    });
    const appliedRevision = workspace.snapshot()!.candidateRevision;
    expect(document.undo()).toBe(true);
    expect(document.read()).toBe("{ person is typing");
    expect(workspace.snapshot()!.candidateRevision).toBeGreaterThan(
      appliedRevision,
    );
    expect(await send(update)).toMatchObject({
      ok: false,
      error: { code: "AUTHORING_REVISION_CONFLICT" },
    });
    expect(document.redo()).toBe(true);
    document.markSaved();
    expect(workspace.snapshot()!.dirty).toBe(false);
    expect(editor.controller.project).toEqual(before);
    close();
    const replacement = new ComponentAuthoringWorkspace(
      { ...initial.target },
      "new",
    );
    replacement.document("definition", "{}");
    replacement.activate("definition");
    const closeReplacement = registerComponentAuthoring(replacement);
    try {
      expect(
        await send({
          ...update,
          expectedCandidateRevision: replacement.snapshot()!.candidateRevision,
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "AUTHORING_TARGET_CLOSED" },
      });
    } finally {
      closeReplacement();
    }
  } finally {
    close();
  }
});
