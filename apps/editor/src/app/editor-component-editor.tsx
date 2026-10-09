// The shared-component editor and the public component library, opened over
// the editor.
import {
  lazy,
  Suspense,
  useState,
  useEffect,
  type Dispatch,
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
} from "../features/user-components/component-definition-edit";
import type { EditorServices } from "../services/editor-services";
import type { ComponentEditorSession } from "./component-editor-session";
import { LazyComponentDefinitionEditor as ComponentDefinitionEditor } from "./lazy-editor-dialogs";

const UserComponentsLibrary = lazy(
  () => import("../features/user-components/user-components-library"),
);

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
                withComponentSession(() =>
                  commitModelEdits(
                    edits,
                    definitionId,
                    "Saved draft. Applied model bytes are unchanged.",
                  ),
                ),
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
            onSaved={(entry, planner) => {
              setComponentLibraryRefresh((value) => value + 1);
              if (componentEditor.target) {
                const plan = componentEditPlan(entry.definition, planner);
                if (!plan.ok) return plan.message;
                try {
                  commitProjectStructure(plan.project, plan.activeDocumentId);
                  selectOnly("instance", [componentEditor.target.instance.id]);
                  setStatus(
                    "Saved publicly and applied to the selected component",
                  );
                } catch (error) {
                  return error instanceof Error ? error.message : String(error);
                }
              } else if (componentEditor.mode === "new")
                insertSharedComponent(entry);
              if (componentEditor.mode !== "library") setComponentEditor(null);
              return null;
            }}
            onManaged={() => setComponentLibraryRefresh((value) => value + 1)}
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
      {capabilities.community ? (
        <Suspense fallback={null}>
          <UserComponentsLibrary
            open={userComponentsOpen}
            refresh={componentLibraryRefresh}
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
            onEdit={(entry) => {
              cancelAllTransientInteraction();
              setComponentEditor({
                key: crypto.randomUUID(),
                projectSessionId,
                mode: "library",
                definition: entry.definition,
                entry,
              });
            }}
            onInsert={insertSharedComponent}
          />
        </Suspense>
      ) : null}
    </>
  );
}
