import type { EditorComponentEditorProps } from "./editor-component-editor";
import type { RefObject } from "react";
import { componentEditorPlacement } from "./component-editor-placement";
import {
  prepareComponentVariant,
  executeProjectTransaction,
  planComponentDefinitionApply,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import type { CircuitProject, ComponentDefinition } from "@icm/model";
import type { ComponentEditorSession } from "./component-editor-session";
import { componentDraftCheckpoint } from "../features/user-components/component-draft-checkpoint";
import { componentLibraryAssociation } from "../features/user-components/component-library-origin";
import { componentDefinitionInsertRequest } from "../features/user-components/component-definition-edit";
import { writeComponentVariantDraft } from "../features/user-components/component-variant-draft";
import { reloadedLibraryDraft } from "../features/user-components/library-circuit-authoring";
import { publishedDefinition } from "../features/user-components/component-library-contract";
import ComponentDefinitionEditor from "../features/user-components/component-definition-editor";

export default function EditorComponentSessionBody(
  props: Omit<EditorComponentEditorProps, "componentEditor"> & {
    componentEditor: ComponentEditorSession;
    returnToLibrary: RefObject<boolean>;
    onClose(): void;
  },
) {
  const {
    project,
    projectSessionId,
    dispatchProjectTransaction,
    setExternalSubcircuitDefinition,
    removeExternalSubcircuitDefinition,
    onBeforePlace,
    copyText,
    capabilities,
    setStatus,
    componentEditor,
    setComponentEditor,
    setComponentLibraryRefresh,
    setUserComponentsOpen,
    editorDocumentController,
    synchronizeExternalCommit,
    definitionProjectRef,
    selectOnly,
    editorCommands,
    returnToLibrary,
  } = props;
  const { insertCircuitComponent, placeExternalComponent } =
    componentEditorPlacement(props);
  function savedDraftPrecondition() {
    if (!componentEditor) return null;
    const id = componentEditor.draft?.id ?? componentEditor.key;
    return definitionProjectRef.current.project.componentAuthoringDrafts?.some(
      (draft) => draft.id === id,
    )
      ? (componentEditor.draft?.text ?? null)
      : null;
  }
  function commitModelEdits(
    edits: ProjectStructureEdit[],
    definitionId: string,
    message: string,
    onApplied?: (project: CircuitProject) => void,
    dryRun = false,
  ) {
    const current = definitionProjectRef.current.project;
    const variant = componentEditor?.variant;
    if (variant && current.structureRevision !== variant.baseRevision)
      return {
        ok: false,
        definitionId,
        message: "The Project changed. Reopen the variant before applying.",
      };
    const transaction = {
      transactionId: `model-${crypto.randomUUID()}`,
      projectId: current.id,
      expectedStructureRevision: current.structureRevision,
      actor: { kind: "human" as const, id: "human-local" },
      edits: variant
        ? [
            ...variant.edits,
            ...edits,
            ...(componentEditor?.draft
              ? [
                  {
                    kind: "remove_component_authoring_draft" as const,
                    draftId: componentEditor.draft.id,
                    expectedText: componentEditor.draft.text,
                  },
                ]
              : []),
          ]
        : edits,
    };
    const result = dryRun
      ? executeProjectTransaction(current, { ...transaction, dryRun: true })
      : dispatchProjectTransaction(transaction);
    if (result.ok && !dryRun) {
      definitionProjectRef.current = {
        ...definitionProjectRef.current,
        project: result.project,
      };
      onApplied?.(result.project);
      if (variant)
        setComponentEditor((session) => {
          if (!session || session.key !== componentEditor?.key) return session;
          const {
            variant: _variant,
            draft: _draft,
            variantArtworkText: _artwork,
            ...applied
          } = session;
          const target = applied.target;
          const instance =
            target &&
            result.project.documents
              .find((d) => d.id === target.documentId)
              ?.instances.find((i) => i.id === target.instance.id);
          return {
            ...applied,
            ...(variant.definitionId
              ? { externalDefinitionId: definitionId }
              : {}),
            ...(target && instance ? { target: { ...target, instance } } : {}),
          };
        });
    }
    return {
      ok: result.ok,
      definitionId,
      ...(result.ok
        ? {
            draftCheckpoint: componentDraftCheckpoint(
              result.project,
              definitionId,
            ),
          }
        : {}),
      message: result.ok
        ? message
        : (result.diagnostics[0]?.message ?? result.error.message),
    };
  }

  function saveVariantDraft(
    edits: ProjectStructureEdit[],
    artworkText?: string,
  ) {
    const session = componentEditor!;
    const variant = session.variant!;
    const current = definitionProjectRef.current.project;
    const target = session.target!;
    if (current.structureRevision !== variant.baseRevision)
      return {
        ok: false,
        message: "The Project changed. Reopen the variant before saving.",
      };
    let candidate = variant.project;
    if (edits.length) {
      const result = executeProjectTransaction(candidate, {
        projectId: candidate.id,
        expectedStructureRevision: candidate.structureRevision,
        transactionId: "variant-draft",
        actor: { kind: "human", id: "variant-draft" },
        edits,
      });
      if (!result.ok)
        return {
          ok: false,
          message: result.diagnostics[0]?.message ?? result.error.message,
        };
      candidate = result.project;
    }
    const draft = {
      id: session.draft?.id ?? session.key,
      text: writeComponentVariantDraft(
        current,
        target.documentId,
        target.instance.id,
        variant,
        candidate,
        artworkText ?? session.variantArtworkText,
      ),
    };
    const result = dispatchProjectTransaction({
      projectId: current.id,
      expectedStructureRevision: current.structureRevision,
      transactionId: "save-variant-" + crypto.randomUUID(),
      actor: { kind: "human", id: "variant-draft" },
      edits: [
        {
          kind: "save_component_authoring_draft",
          draft,
          expectedText: session.draft?.text ?? null,
        },
      ],
    });
    if (result.ok) {
      definitionProjectRef.current = {
        ...definitionProjectRef.current,
        project: result.project,
      };
      setComponentEditor({
        ...session,
        draft,
        variantArtworkText: artworkText ?? session.variantArtworkText,
        variant: {
          ...variant,
          project: candidate,
          baseRevision: result.project.structureRevision,
        },
      });
    }
    return {
      ok: result.ok,
      ...(result.ok
        ? {
            draftCheckpoint: componentDraftCheckpoint(
              candidate,
              variant.definitionId,
            ),
          }
        : {}),
      message: result.ok
        ? "Saved variant draft. Existing instances are unchanged."
        : result.error.message,
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
    if (!componentSessionIsCurrent())
      return {
        ok: false,
        message: "The Project changed. Reopen the component before applying.",
      };
    try {
      return action();
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not apply the component definition.",
      };
    }
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
      componentEditor?.variant?.project ?? live.project,
      target.documentId,
      target.instance.id,
      componentEditor?.variant?.project.documents
        .find((d) => d.id === target.documentId)
        ?.instances.find((i) => i.id === target.instance.id) ?? target.instance,
      definition,
      "definition",
    );
  }

  return (
    <>
      {(capabilities.community || capabilities.localComponents) &&
      componentEditor ? (
        <ComponentDefinitionEditor
          key={componentEditor.key}
          authoringIdentity={{
            projectId: project.id,
            projectSessionId: editorDocumentController.projectSessionId,
            draftId: componentEditor.draft?.id ?? componentEditor.key,
          }}
          authoringRevision={JSON.stringify([
            project.structureRevision,
            project.documents.map((document) => [
              document.id,
              document.revision,
            ]),
          ])}
          onAgentEdit={() => editorDocumentController.noteAgentEdit()}
          definition={componentEditor.definition}
          mode={componentEditor.mode}
          publicationIntent={componentEditor.publicationIntent}
          isVariant={!!componentEditor.variant}
          onCreateVariant={
            componentEditor.target && !componentEditor.variant
              ? () => {
                  try {
                    const current = definitionProjectRef.current.project;
                    const target = componentEditor.target!;
                    const variant = prepareComponentVariant(
                      current,
                      target.documentId,
                      target.instance.id,
                      crypto.randomUUID(),
                    );
                    const {
                      draft: _draft,
                      variantArtworkText: _artwork,
                      ...originalSession
                    } = componentEditor;
                    setComponentEditor({
                      ...originalSession,
                      key: crypto.randomUUID(),
                      definition: variant.definition,
                      externalDefinitionId: variant.definitionId,
                      publicationIntent: "new",
                      variant: {
                        ...variant,
                        baseRevision: current.structureRevision,
                      },
                    });
                  } catch (error) {
                    setStatus(
                      error instanceof Error ? error.message : String(error),
                    );
                  }
                }
              : undefined
          }
          {...(componentEditor.target
            ? {
                repairTarget: {
                  documentId: componentEditor.target.documentId,
                  instanceId: componentEditor.target.instance.id,
                },
              }
            : {})}
          {...(componentEditor.draft &&
          (!componentEditor.variant ||
            componentEditor.variantArtworkText !== undefined)
            ? {
                draft: componentEditor.variant
                  ? {
                      ...componentEditor.draft,
                      text: componentEditor.variantArtworkText!,
                    }
                  : componentEditor.draft,
              }
            : {})}
          circuit={{
            project: componentEditor.variant?.project ?? project,
            pendingVariant: !!componentEditor.variant,
            definitionId: componentEditor.externalDefinitionId,
            sourceId: componentEditor.externalSourceId,
            symbolId:
              componentEditor.variant?.symbolId ??
              componentEditor.target?.instance.symbolId,
            onRepair: (edits, definitionId, expectedProject, dryRun) =>
              withComponentSession(() => {
                if (
                  JSON.stringify(
                    componentEditor.variant?.project ??
                      definitionProjectRef.current.project,
                  ) !== JSON.stringify(expectedProject)
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
                  dryRun,
                );
              }),
            onApply: (edit, dryRun = false) =>
              withComponentSession(() => {
                const target = componentEditor.target;
                const current = definitionProjectRef.current.project;
                if (current.structureRevision !== project.structureRevision)
                  return {
                    ok: false,
                    message:
                      "The Project changed. Reopen the candidate before applying.",
                  };
                if (target && componentEditor.externalDefinitionId) {
                  const instance = current.documents
                    .find((d) => d.id === target.documentId)
                    ?.instances.find((i) => i.id === target.instance.id);
                  if (
                    JSON.stringify(instance) !== JSON.stringify(target.instance)
                  )
                    return {
                      ok: false,
                      message:
                        "The instance changed. Reopen it before applying its artwork.",
                    };
                  edit = planComponentDefinitionApply(
                    componentEditor.variant?.project ?? current,
                    edit,
                  );
                }
                return commitModelEdits(
                  [edit],
                  edit.definitions[0]!.definitionId,
                  "Applied shared model definition",
                  target
                    ? (applied) => {
                        const instance = applied.documents
                          .find((d) => d.id === target.documentId)
                          ?.instances.find((i) => i.id === target.instance.id);
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
                  dryRun,
                );
              }),
            onSaveDraft: (edits, definitionId) =>
              withComponentSession(() => {
                if (componentEditor.variant) return saveVariantDraft(edits);
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
                const outcome = commitModelEdits(
                  plan.edits,
                  definition.symbol.id,
                  "Applied component definition locally",
                  (applied) => {
                    const target = componentEditor.target!;
                    const instance = applied.documents
                      .find((d) => d.id === target.documentId)
                      ?.instances.find((i) => i.id === target.instance.id);
                    if (instance)
                      setComponentEditor((session) =>
                        session?.key === componentEditor.key
                          ? { ...session, target: { ...target, instance } }
                          : session,
                      );
                  },
                );
                if (!outcome.ok) return outcome.message;
                selectOnly("instance", [componentEditor.target.instance.id]);
                setStatus("Applied component definition locally");
              } catch (error) {
                return error instanceof Error ? error.message : String(error);
              }
            }
            return null;
          }}
          onPlaceDefinition={(definition) => {
            returnToLibrary.current = false;
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
            if (componentEditor.variant) {
              const result = saveVariantDraft([], text);
              return result.ok ? null : result.message;
            }
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
                  expectedText: savedDraftPrecondition(),
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
                  expectedText: savedDraftPrecondition(),
                },
              ],
              draft.id,
              "Saved library authoring snapshot",
            );
            if (outcome.ok) setComponentEditor({ ...componentEditor, draft });
            return outcome.ok ? null : outcome.message;
          }}
          onManaged={() => setComponentLibraryRefresh((value) => value + 1)}
          onAssociateLibrary={(payload) => {
            if (!componentEditor.target) return null;
            if (!componentSessionIsCurrent())
              return "The Project changed. Reopen to recover the association.";
            const current = definitionProjectRef.current.project;
            const instance = current.documents
              .find((item) => item.id === componentEditor.target!.documentId)
              ?.instances.find(
                (item) => item.id === componentEditor.target!.instance.id,
              );
            if (!instance) return "The edited instance is no longer available.";
            try {
              const edits = componentLibraryAssociation(
                current,
                instance.symbolId,
                payload,
              );
              if (!edits.length) return null;
              const outcome = commitModelEdits(
                edits,
                instance.symbolId,
                "Associated published component",
              );
              return outcome.ok ? null : outcome.message;
            } catch (error) {
              return error instanceof Error ? error.message : String(error);
            }
          }}
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
                  expectedText: savedDraftPrecondition(),
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
            insertCircuitComponent(packaged, `component-${componentEditor.key}`)
          }
          onBackToLibrary={
            returnToLibrary.current
              ? () => {
                  setComponentEditor(null);
                  setUserComponentsOpen(true);
                  returnToLibrary.current = false;
                }
              : undefined
          }
          onClose={() => {
            setComponentEditor(null);
            returnToLibrary.current = false;
          }}
        />
      ) : null}
    </>
  );
}
