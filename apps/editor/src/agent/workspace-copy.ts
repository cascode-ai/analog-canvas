import type {
  AgentProjectResourceRequest,
  AgentProjectResourceResponse,
} from "@icm/agent-adapter";
import type { EditorDocumentController } from "../document/document-controller";
import type * as copyMethods from "../features/clipboard/project-copy";

type CopyRequest = Extract<
  Extract<AgentProjectResourceRequest, { operation: "workspace" }>["request"],
  { action: "copy" }
>;

export function workspaceResponses(requestId: string) {
  const base = {
    apiVersion: "3.0" as const,
    requestId,
    operation: "workspace" as const,
  };
  return {
    fail: (code: string, message: string): AgentProjectResourceResponse => ({
      ...base,
      ok: false,
      error: { code, message, recovery: "refresh" },
    }),
    success: (
      result: Extract<
        AgentProjectResourceResponse,
        { operation: "workspace"; ok: true }
      >["result"],
    ): AgentProjectResourceResponse => ({ ...base, ok: true, result }),
  };
}

export function listWorkspaceProjects(
  entries: {
    id: string;
    session: {
      controller: EditorDocumentController;
      file: { cloudBinding: { id: string } | null };
      dirty: boolean;
    };
  }[],
) {
  return entries.map(({ id, session }) => ({
    workspaceId: id,
    projectId: session.controller.project.id,
    name: session.controller.project.name,
    cloudProjectId: session.file.cloudBinding?.id ?? null,
    dirty: session.dirty,
    structureRevision: session.controller.project.structureRevision,
    cells: session.controller.project.documents.map((d) => ({
      documentId: d.id,
      name: d.name,
      revision: d.revision,
    })),
  }));
}

/** Optional Agent operation; planning and commit remain synchronous after loading. */
export function copyWorkspaceCell(
  request: CopyRequest,
  source: EditorDocumentController | undefined,
  destination: EditorDocumentController | undefined,
  {
    captureProjectCopy,
    planProjectCopyPlacement,
    applyProjectCopyPlacement,
  }: {
    captureProjectCopy: typeof copyMethods.captureProjectCopy;
    planProjectCopyPlacement: typeof copyMethods.planProjectCopyPlacement;
    applyProjectCopyPlacement: typeof copyMethods.applyProjectCopyPlacement;
  },
) {
  const fail = (code: string, message: string) => ({
    error: { code, message },
  });
  const sourceDocument = source?.project.documents.find(
    (d) => d.id === request.sourceDocumentId,
  );
  const targetDocument = destination?.project.documents.find(
    (d) => d.id === request.targetDocumentId,
  );
  if (!source || !sourceDocument || !destination || !targetDocument)
    return fail(
      "WORKSPACE_NOT_FOUND",
      "Source or target Cell is no longer open",
    );
  if (
    source.project.structureRevision !== request.sourceStructureRevision ||
    sourceDocument.revision !== request.sourceRevision ||
    targetDocument.revision !== request.expectedRevision ||
    destination.project.structureRevision !== request.expectedStructureRevision
  )
    return fail(
      "PROJECT_CONTEXT_STALE",
      "Source or target changed; inspect before copying",
    );
  if (request.selection) {
    const available = {
      instanceIds: sourceDocument.instances,
      draftingIds: sourceDocument.drafting?.objects ?? [],
      routeIds: sourceDocument.routes,
      junctionIds: sourceDocument.junctions,
      annotationIds: sourceDocument.annotations,
    };
    for (const key of Object.keys(available) as (keyof typeof available)[]) {
      if (
        request.selection[key].some(
          (id) => !available[key].some((object) => object.id === id),
        )
      )
        return fail(
          "COPY_SELECTION_NOT_FOUND",
          `A selected ${key} object is no longer present; no content copied`,
        );
    }
  }
  const clipboard = captureProjectCopy(
    source.project,
    sourceDocument,
    request.selection,
    true,
  );
  if (!clipboard) return fail("COPY_EMPTY", "The requested selection is empty");
  const before = destination.project;
  const plan = planProjectCopyPlacement(
    before,
    targetDocument,
    clipboard,
    request.offset,
    1,
  );
  const next = applyProjectCopyPlacement(plan, {
    kind: "agent",
    id: "workspace-copy",
  });
  destination.commitProjectStructure(next, destination.document.id);
  return {
    result: {
      action: "copy" as const,
      structureRevision: next.structureRevision,
      revision: next.documents.find((d) => d.id === targetDocument.id)!
        .revision,
      instanceIds: [...plan.instanceIds],
      mapping: plan.mapping,
      importedDocumentIds: next.documents
        .filter((d) => !before.documents.some((old) => old.id === d.id))
        .map((d) => d.id),
      importedFileIds: next.source.files
        .filter((f) => !before.source.files.some((old) => old.id === f.id))
        .map((f) => f.id),
    },
  };
}
