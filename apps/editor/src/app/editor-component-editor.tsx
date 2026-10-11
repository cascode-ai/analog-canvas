// The shared-component editor and the public component library, opened over
// the editor.
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  type Dispatch,
  type ComponentProps,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  planCircuitComponentCapture,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import type { SymbolDefinition } from "@icm/symbols";
import type { CircuitComponentAuthoring } from "../features/user-components/native-component-editor";
import type { CircuitProject, ComponentDefinition } from "@icm/model";
import type { createEditorCommandRouter } from "../commands/editor-command";
import type {
  EditorDocumentController,
  useDocumentController,
} from "../document/document-controller";
import type { useSelectionController } from "../features/selection/selection-controller";
import {
  publishedDefinition,
  type SharedComponent,
} from "../features/user-components/component-library-contract";
import {
  newComponentDefinition,
  sharedComponentInsertRequest,
  componentDefinitionInsertRequest,
} from "../features/user-components/component-definition-edit";
import type { EditorServices } from "../services/editor-services";
import type { ComponentEditorSession } from "./component-editor-session";
import {
  readLibraryAuthoringDraft,
  reloadedLibraryDraft,
  isLibraryAuthoringDraft,
} from "../features/user-components/library-circuit-authoring";
import { LazyComponentDefinitionEditor as ComponentDefinitionEditor } from "./lazy-editor-dialogs";

const UserComponentsLibrary = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../features/user-components/user-components-library").default
      >,
    ) => null
  : lazy(() => import("../features/user-components/user-components-library"));

type DocumentControllerState = ReturnType<typeof useDocumentController>;

/** The component editor session and the library it opens from. */
export function EditorComponentEditor({
  project,
  projectSessionId,
  resolver,
  dispatchProjectTransaction,
  externalSubcircuitInsertCandidates,
  setExternalSubcircuitDefinition,
  removeExternalSubcircuitDefinition,
  onBeforePlace,
  copyText,
  capabilities,
  setStatus,
  componentEditor,
  setComponentEditor,
  componentLibraryRefresh,
  setComponentLibraryRefresh,
  userComponentsOpen,
  setUserComponentsOpen,
  commitProjectStructure,
  editorDocumentController,
  synchronizeExternalCommit,
  definitionProjectRef,
  selectOnly,
  cancelAllTransientInteraction,
  editorCommands,
}: {
  project: CircuitProject;
  projectSessionId: string;
  resolver: DocumentControllerState["resolver"];
  dispatchProjectTransaction: DocumentControllerState["dispatchProjectTransaction"];
  externalSubcircuitInsertCandidates: readonly {
    definitionId: string;
    masterName: string;
    symbol: SymbolDefinition;
  }[];
  setExternalSubcircuitDefinition: CircuitComponentAuthoring["onSetDefinition"];
  removeExternalSubcircuitDefinition: CircuitComponentAuthoring["onRemoveDefinition"];
  onBeforePlace: () => void;
  copyText: CircuitComponentAuthoring["onCopyText"];
  capabilities: EditorServices["capabilities"];
  setStatus: Dispatch<SetStateAction<string>>;
  componentEditor: ComponentEditorSession | null;
  setComponentEditor: Dispatch<SetStateAction<ComponentEditorSession | null>>;
  componentLibraryRefresh: number;
  setComponentLibraryRefresh: Dispatch<SetStateAction<number>>;
  userComponentsOpen: boolean;
  setUserComponentsOpen: Dispatch<SetStateAction<boolean>>;
  commitProjectStructure: DocumentControllerState["commitProjectStructure"];
  editorDocumentController: EditorDocumentController;
  synchronizeExternalCommit: DocumentControllerState["synchronizeExternalCommit"];
  definitionProjectRef: RefObject<{
    project: CircuitProject;
    projectSessionId: string;
  }>;
  selectOnly: ReturnType<typeof useSelectionController>["selectOnly"];
  cancelAllTransientInteraction: () => void;
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
}) {
  const [pendingPublicComponent, setPendingPublicComponent] = useState<{
    projectSessionId: string;
    definitionId: string;
    symbolId: string;
  } | null>(null);

  function insertSharedComponent(entry: SharedComponent): void {
    try {
      if (entry.circuit) {
        insertCircuitComponent(
          { definition: entry.definition, circuit: entry.circuit },
          `component-${entry.id}-r${entry.revision}`,
        );
        return;
      }
      editorDocumentController.offerComponentDefinition(entry.definition);
      synchronizeExternalCommit();
      editorCommands.execute({
        id: "insert.start",
        launch: { kind: "quick", request: sharedComponentInsertRequest(entry) },
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function insertCircuitComponent(
    packaged: Parameters<typeof planCircuitComponentCapture>[1],
    identity: string,
  ) {
    try {
      const captured = planCircuitComponentCapture(
        definitionProjectRef.current.project,
        packaged,
        identity,
      );
      if (captured.edits.length) {
        const result = commitModelEdits(
          captured.edits,
          captured.definitionId,
          "Captured component model",
        );
        if (!result.ok) throw Error(result.message);
      }
      setPendingPublicComponent({
        projectSessionId,
        definitionId: captured.definitionId,
        symbolId: captured.symbolId,
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function commitModelEdits(
    edits: ProjectStructureEdit[],
    definitionId: string,
    message: string,
    onApplied?: (project: CircuitProject) => void,
  ) {
    const current = definitionProjectRef.current.project;
    const result = dispatchProjectTransaction({
      transactionId: `model-${crypto.randomUUID()}`,
      projectId: current.id,
      expectedStructureRevision: current.structureRevision,
      actor: { kind: "human", id: "human-local" },
      edits,
    });
    if (result.ok) onApplied?.(result.project);
    return {
      ok: result.ok,
      definitionId,
      message: result.ok
        ? message
        : (result.diagnostics[0]?.message ?? result.error.message),
    };
  }

  function componentSessionIsCurrent() {
    return (
      componentEditor?.projectSessionId ===
      definitionProjectRef.current.projectSessionId
    );
  }

  function withComponentSession<T extends { ok: boolean; message: string }>(
    action: () => T,
  ) {
    return componentSessionIsCurrent()
      ? action()
      : {
          ok: false,
          message: "The Project changed. Reopen the component before applying.",
        };
  }

  function placeExternalComponent(definitionId: string): boolean {
    const candidate = externalSubcircuitInsertCandidates.find(
      (item) => item.definitionId === definitionId,
    );
    if (!candidate) {
      setStatus("The selected external master has no resolved symbol");
      return false;
    }
    onBeforePlace();
    editorCommands.execute({
      id: "insert.start",
      launch: {
        kind: "quick",
        request: {
          kind: "external-subcircuit",
          definitionId,
          symbolId: candidate.symbol.id,
          symbolName: candidate.masterName,
          masterName: candidate.masterName,
          parameters: {},
          initialRotation: 0,
          showReference: !candidate.symbol.hierarchicalBlock,
          referenceText: null,
          showValue: true,
        },
      },
    });
    return true;
  }

  function componentEditPlan(
    definition: ComponentDefinition,
    planComponentDefinitionEdit: typeof import("../features/user-components/component-definition-plan").planComponentDefinitionEdit,
  ) {
    const target = componentEditor?.target;
    const live = definitionProjectRef.current;
    if (!target || live.projectSessionId !== target.projectSessionId)
      return {
        ok: false as const,
        message: "The Project changed. Reopen the component before applying.",
      };
    return planComponentDefinitionEdit(
      live.project,
      target.documentId,
      target.instance.id,
      target.instance,
      definition,
    );
  }

  useEffect(() => {
    if (!pendingPublicComponent) return;
    if (pendingPublicComponent.projectSessionId !== projectSessionId) {
      setPendingPublicComponent(null);
      return;
    }
    const owner = project.externalSubcircuitDefinitions.find(
      (definition) => definition.id === pendingPublicComponent.definitionId,
    );
    const symbol = resolver.resolve(
      pendingPublicComponent.symbolId,
    )?.definition;
    if (!owner || !symbol) return;
    setPendingPublicComponent(null);
    editorCommands.execute({
      id: "insert.start",
      launch: {
        kind: "quick",
        request: {
          kind: "external-subcircuit",
          definitionId: owner.id,
          symbolId: symbol.id,
          symbolName: symbol.name,
          masterName: owner.name,
          parameters: {},
          initialRotation: 0,
          showReference: !symbol.hierarchicalBlock,
          referenceText: null,
          showValue: true,
        },
      },
    });
  }, [
    pendingPublicComponent,
    project,
    projectSessionId,
    resolver,
    editorCommands,
  ]);

  return (
    <>
      {capabilities.community && componentEditor ? (
        <Suspense fallback={null}>
          <ComponentDefinitionEditor
            key={componentEditor.key}
            definition={componentEditor.definition}
            mode={componentEditor.mode}
            publicationIntent={componentEditor.publicationIntent}
            {...(componentEditor.target
              ? {
                  repairTarget: {
                    documentId: componentEditor.target.documentId,
                    instanceId: componentEditor.target.instance.id,
                  },
                }
              : {})}
            {...(componentEditor.draft ? { draft: componentEditor.draft } : {})}
            circuit={{
              project,
              definitionId: componentEditor.externalDefinitionId,
              symbolId: componentEditor.target?.instance.symbolId,
              onRepair: (edits, definitionId, expectedProject) =>
                withComponentSession(() => {
                  if (
                    JSON.stringify(definitionProjectRef.current.project) !==
                    JSON.stringify(expectedProject)
                  )
                    return {
                      ok: false,
                      message:
                        "The Project changed. Reopen the component before repairing.",
                    };
                  return commitModelEdits(
                    edits,
                    definitionId,
                    "Applied component repair",
                    (applied) => {
                      const target = componentEditor.target;
                      const instance =
                        target &&
                        applied.documents
                          .find((d) => d.id === target.documentId)
                          ?.instances.find((i) => i.id === target.instance.id);
                      setComponentEditor((session) =>
                        session === componentEditor
                          ? {
                              ...session,
                              externalDefinitionId: definitionId,
                              ...(target && instance
                                ? { target: { ...target, instance } }
                                : {}),
                            }
                          : session,
                      );
                    },
                  );
                }),
              onApply: (edit) =>
                withComponentSession(() => {
                  const target = componentEditor.target;
                  const current = definitionProjectRef.current.project;
                  if (target && componentEditor.externalDefinitionId) {
                    const instance = current.documents
                      .find((d) => d.id === target.documentId)
                      ?.instances.find((i) => i.id === target.instance.id);
                    if (
                      JSON.stringify(instance) !==
                      JSON.stringify(target.instance)
                    )
                      return {
                        ok: false,
                        message:
                          "The instance changed. Reopen it before applying its artwork.",
                      };
                    edit = {
                      ...edit,
                      definitions: edit.definitions.map((definition) =>
                        definition.definitionId ===
                        componentEditor.externalDefinitionId
                          ? {
                              ...definition,
                              callers: [
                                {
                                  documentId: target.documentId,
                                  instanceId: target.instance.id,
                                  expectedSymbolId: target.instance.symbolId,
                                },
                              ],
                            }
                          : definition,
                      ),
                    };
                  }
                  return commitModelEdits(
                    [edit],
                    edit.definitions[0]!.definitionId,
                    "Applied shared model definition",
                    target
                      ? (applied) => {
                          const instance = applied.documents
                            .find((d) => d.id === target.documentId)
                            ?.instances.find(
                              (i) => i.id === target.instance.id,
                            );
                          if (instance)
                            setComponentEditor((session) =>
                              session === componentEditor
                                ? {
                                    ...session,
                                    target: { ...target, instance },
                                  }
                                : session,
                            );
                        }
                      : undefined,
                  );
                }),
              onSaveDraft: (edits, definitionId) =>
                withComponentSession(() => {
                  if (
                    definitionProjectRef.current.project.structureRevision !==
                    project.structureRevision
                  )
                    return {
                      ok: false,
                      message:
                        "The Project changed. Reopen the draft before saving.",
                    };
                  return commitModelEdits(
                    edits,
                    definitionId,
                    "Saved draft. Applied model bytes are unchanged.",
                  );
                }),
              onSetDefinition: (definition) =>
                withComponentSession(() =>
                  setExternalSubcircuitDefinition(definition),
                ),
              onRemoveDefinition: (id) =>
                withComponentSession(() =>
                  removeExternalSubcircuitDefinition(id),
                ),
              onPlace: (id) => {
                if (!componentSessionIsCurrent()) {
                  setStatus(
                    "The Project changed. Reopen the component before placing.",
                  );
                  return;
                }
                if (placeExternalComponent(id)) setComponentEditor(null);
              },
              onCopyText: (text) => copyText(text),
            }}
            {...(componentEditor.entry ? { entry: componentEditor.entry } : {})}
            validateApply={(definition, planner) => {
              if (!componentEditor.target) return null;
              const plan = componentEditPlan(
                publishedDefinition(definition, componentEditor.key, 1),
                planner,
              );
              return plan.ok ? null : plan.message;
            }}
            onApplyDefinition={(definition, planner) => {
              if (componentEditor.target) {
                const plan = componentEditPlan(definition, planner);
                if (!plan.ok) return plan.message;
                try {
                  commitProjectStructure(plan.project, plan.activeDocumentId);
                  selectOnly("instance", [componentEditor.target.instance.id]);
                  const instance = plan.project.documents
                    .find(
                      (document) =>
                        document.id === componentEditor.target!.documentId,
                    )
                    ?.instances.find(
                      (item) => item.id === componentEditor.target!.instance.id,
                    );
                  if (instance)
                    setComponentEditor({
                      ...componentEditor,
                      target: { ...componentEditor.target, instance },
                    });
                  setStatus("Applied component definition locally");
                } catch (error) {
                  return error instanceof Error ? error.message : String(error);
                }
              }
              return null;
            }}
            onPlaceDefinition={(definition) => {
              if (!componentSessionIsCurrent())
                return "The Project changed. Reopen the component before placing.";
              try {
                editorDocumentController.offerComponentDefinition(definition);
                synchronizeExternalCommit();
                onBeforePlace();
                editorCommands.execute({
                  id: "insert.start",
                  launch: {
                    kind: "quick",
                    request: componentDefinitionInsertRequest(definition),
                  },
                });
                return null;
              } catch (error) {
                return error instanceof Error ? error.message : String(error);
              }
            }}
            onSaveDefinitionDraft={(text) => {
              if (!componentSessionIsCurrent())
                return "The Project changed. Reopen before saving.";
              const draft = {
                id: componentEditor.draft?.id ?? componentEditor.key,
                text,
                ...(componentEditor.target
                  ? {
                      baselineSymbolId: componentEditor.definition.symbol.id,
                      target: {
                        documentId: componentEditor.target.documentId,
                        instanceId: componentEditor.target.instance.id,
                        expectedSymbolId:
                          componentEditor.target.instance.symbolId,
                      },
                    }
                  : {}),
              };
              const outcome = commitModelEdits(
                [
                  {
                    kind: "save_component_authoring_draft",
                    draft,
                    expectedText: componentEditor.draft?.text ?? null,
                  },
                ],
                draft.id,
                "Saved component authoring draft",
              );
              if (outcome.ok) setComponentEditor({ ...componentEditor, draft });
              return outcome.ok ? null : outcome.message;
            }}
            onSaveLibraryDraft={(text, entry) => {
              if (!componentSessionIsCurrent())
                return "The Project changed. Reopen before saving.";
              const draft = {
                id: componentEditor.draft?.id ?? componentEditor.key,
                text,
                ...(entry
                  ? {
                      library: {
                        componentId: entry.id,
                        revision: entry.revision,
                      },
                    }
                  : {}),
              };
              const outcome = commitModelEdits(
                [
                  {
                    kind: "save_component_authoring_draft",
                    draft,
                    expectedText: componentEditor.draft?.text ?? null,
                  },
                ],
                draft.id,
                "Saved library authoring snapshot",
              );
              if (outcome.ok) setComponentEditor({ ...componentEditor, draft });
              return outcome.ok ? null : outcome.message;
            }}
            onManaged={() => setComponentLibraryRefresh((value) => value + 1)}
            onReloadLibrary={(entry) => {
              if (!componentSessionIsCurrent())
                return "The Project changed. Reopen before reloading.";
              const draft = reloadedLibraryDraft(
                componentEditor.draft?.id ?? componentEditor.key,
                entry,
              );
              const outcome = commitModelEdits(
                [
                  {
                    kind: "save_component_authoring_draft",
                    draft,
                    expectedText: componentEditor.draft?.text ?? null,
                  },
                ],
                draft.id,
                "Reloaded published component",
              );
              if (!outcome.ok) return outcome.message;
              setComponentEditor({
                key: crypto.randomUUID(),
                projectSessionId,
                mode: "library",
                publicationIntent: "update",
                definition: entry.definition,
                entry,
                draft,
              });
              setComponentLibraryRefresh((value) => value + 1);
              return null;
            }}
            onPlaceCircuit={(packaged) =>
              insertCircuitComponent(
                packaged,
                `component-${componentEditor.key}`,
              )
            }
            onClose={() => setComponentEditor(null)}
          />
        </Suspense>
      ) : null}
      {!import.meta.env?.ICM_DESKTOP && capabilities.community ? (
        <Suspense fallback={null}>
          <UserComponentsLibrary
            open={userComponentsOpen}
            refresh={componentLibraryRefresh}
            drafts={[
              ...(project.componentAuthoringDrafts ?? []).map((draft) => ({
                id: draft.id,
                label: isLibraryAuthoringDraft(draft)
                  ? (() => {
                      try {
                        return (
                          "Library draft " +
                          readLibraryAuthoringDraft(draft).definition.symbol
                            .name
                        );
                      } catch {
                        return "Invalid library draft " + draft.id.slice(0, 8);
                      }
                    })()
                  : "Artwork draft " + draft.id.slice(0, 8),
              })),
              ...(project.modelSources ?? []).flatMap(
                (source) =>
                  source.draft?.authoring?.map((draft) => ({
                    id: draft.definitionId,
                    label: "Circuit draft " + (draft.entry || source.entry),
                  })) ?? [],
              ),
            ]}
            onOpenDraft={(id) => {
              const current = definitionProjectRef.current.project;
              const draft = current.componentAuthoringDrafts?.find(
                (draft) => draft.id === id,
              );
              if (!draft) {
                const candidate = current.modelSources
                  ?.flatMap((source) => source.draft?.authoring ?? [])
                  .find((candidate) => candidate.definitionId === id);
                const legacy = candidate?.legacyRepair;
                const document =
                  legacy &&
                  current.documents.find((document) =>
                    document.instances.some(
                      (instance) =>
                        instance.symbolId === legacy.baseline.symbol.id &&
                        (!legacy.selected ||
                          (document.id === legacy.selected.documentId &&
                            instance.id === legacy.selected.instanceId)),
                    ),
                  );
                const instance = document?.instances.find(
                  (instance) =>
                    instance.symbolId === legacy?.baseline.symbol.id &&
                    (!legacy.selected ||
                      instance.id === legacy.selected.instanceId),
                );
                if (legacy && !instance) {
                  setStatus(
                    "The repair draft's original captured class changed. Reopen its current definition.",
                  );
                  return;
                }
                setComponentEditor({
                  key: crypto.randomUUID(),
                  projectSessionId,
                  mode: legacy ? "instance" : "new",
                  definition: legacy?.baseline ?? newComponentDefinition(),
                  externalDefinitionId: id,
                  ...(instance && document
                    ? {
                        target: {
                          projectSessionId,
                          documentId: document.id,
                          instance,
                        },
                      }
                    : {}),
                });
                return;
              }
              if (isLibraryAuthoringDraft(draft)) {
                try {
                  const snapshot = readLibraryAuthoringDraft(draft);
                  setComponentEditor({
                    key: crypto.randomUUID(),
                    projectSessionId,
                    mode: "library",
                    definition: snapshot.definition,
                    ...(snapshot.entry ? { entry: snapshot.entry } : {}),
                    draft,
                  });
                } catch (error) {
                  setStatus(
                    error instanceof Error ? error.message : String(error),
                  );
                }
                return;
              }
              const document = current.documents.find(
                (d) => d.id === draft.target?.documentId,
              );
              const instance = document?.instances.find(
                (i) => i.id === draft.target?.instanceId,
              );
              if (
                draft.target &&
                instance?.symbolId !== draft.target.expectedSymbolId
              ) {
                setStatus(
                  "The draft's original component changed. Open its current definition before applying.",
                );
                return;
              }
              const definition =
                current.componentDefinitions?.find(
                  (d) => d.symbol.id === instance?.symbolId,
                ) ?? newComponentDefinition();
              setComponentEditor({
                key: crypto.randomUUID(),
                projectSessionId,
                mode: instance ? "instance" : "new",
                definition,
                draft,
                ...(instance && document
                  ? {
                      target: {
                        projectSessionId,
                        documentId: document.id,
                        instance,
                      },
                    }
                  : {}),
              });
            }}
            onClose={() => setUserComponentsOpen(false)}
            onCreate={() => {
              cancelAllTransientInteraction();
              setComponentEditor({
                key: crypto.randomUUID(),
                projectSessionId,
                mode: "new",
                definition: newComponentDefinition(),
              });
            }}
            onEdit={(entry, publicationIntent) => {
              cancelAllTransientInteraction();
              const draft =
                definitionProjectRef.current.project.componentAuthoringDrafts?.find(
                  (d) => {
                    if (d.library?.componentId !== entry.id) return false;
                    try {
                      return (
                        readLibraryAuthoringDraft(d).publication?.kind ===
                        publicationIntent
                      );
                    } catch {
                      return false;
                    }
                  },
                );
              if (draft) {
                try {
                  const saved = readLibraryAuthoringDraft(draft);
                  setComponentEditor({
                    key: crypto.randomUUID(),
                    projectSessionId,
                    mode: "library",
                    definition: saved.definition,
                    ...(saved.entry ? { entry: saved.entry } : {}),
                    draft,
                  });
                } catch (error) {
                  setStatus(
                    error instanceof Error ? error.message : String(error),
                  );
                }
                return;
              }
              setComponentEditor({
                key: crypto.randomUUID(),
                projectSessionId,
                mode: "library",
                definition: entry.definition,
                entry,
                publicationIntent,
              });
            }}
            onInsert={insertSharedComponent}
          />
        </Suspense>
      ) : null}
    </>
  );
}
