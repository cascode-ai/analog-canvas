import type { EditorComponentEditorProps } from "./editor-component-editor";
import type { RefObject } from "react";
import { componentEditorPlacement } from "./component-editor-placement";
import { Suspense, useMemo } from "react";
import { lazyChunk } from "../components/chunk-load-fallback";
import {
  componentDraftCatalog,
  planComponentDraftDeletion,
} from "@icm/edit-engine";
import { deleteComponentDrafts } from "../features/user-components/component-draft-management";
import { newComponentDefinition } from "../features/user-components/component-definition-edit";
import { captureLibraryComponent as componentLibraryCapture } from "../features/user-components/component-publication-host";
import {
  readComponentVariantDraft,
  isComponentVariantDraft,
} from "../features/user-components/component-variant-draft";
import {
  readLibraryAuthoringDraft,
  isLibraryAuthoringDraft,
} from "../features/user-components/library-circuit-authoring";
const UserComponentsLibrary = import.meta.env?.ICM_DESKTOP
  ? lazyChunk("dialog", () => import("../hosts/native-components-library"))
  : lazyChunk(
      "dialog",
      () => import("../features/user-components/user-components-library"),
    );

export default function EditorComponentLibrary(
  props: EditorComponentEditorProps & {
    returnToLibrary: RefObject<boolean>;
    onClose(): void;
  },
) {
  const {
    project,
    projectSessionId,
    dispatchProjectTransaction,
    setStatus,
    setComponentEditor,
    componentLibraryRefresh,
    userComponentsOpen,
    setUserComponentsOpen,
    definitionProjectRef,
    cancelAllTransientInteraction,
    returnToLibrary,
  } = props;
  const { insertSharedComponent } = componentEditorPlacement(props);
  const draftCatalog = useMemo(
    () => (userComponentsOpen ? componentDraftCatalog(project) : undefined),
    [
      userComponentsOpen,
      project.componentAuthoringDrafts,
      project.modelSources,
    ],
  );
  return (
    <Suspense fallback={null}>
      <UserComponentsLibrary
        open={userComponentsOpen}
        refresh={componentLibraryRefresh}
        {...(draftCatalog ? { drafts: draftCatalog } : {})}
        previewDraftDeletion={(targets) =>
          planComponentDraftDeletion(
            definitionProjectRef.current.project,
            targets,
          ).reclaimBytes
        }
        onDeleteDrafts={(targets) => {
          try {
            const current = definitionProjectRef.current;
            deleteComponentDrafts(
              current.project,
              current.projectSessionId,
              targets,
              (edits) => {
                const result = dispatchProjectTransaction({
                  transactionId: crypto.randomUUID(),
                  projectId: current.project.id,
                  expectedStructureRevision: current.project.structureRevision,
                  actor: { kind: "human", id: "component-drafts" },
                  edits,
                });
                return result.ok ? null : result.error.message;
              },
            );
            return null;
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        }}
        onOpenDraft={(target) => {
          const id =
            target.kind === "component"
              ? target.draftId
              : target.kind === "circuit"
                ? target.definitionId
                : definitionProjectRef.current.project.externalSubcircuitDefinitions.find(
                    (d) => d.implementation?.sourceId === target.sourceId,
                  )?.id;
          if (!id && target.kind === "source") {
            returnToLibrary.current = true;
            setComponentEditor({
              key: crypto.randomUUID(),
              projectSessionId,
              mode: "new",
              definition: newComponentDefinition(),
              externalSourceId: target.sourceId,
            });
            return;
          }
          returnToLibrary.current = true;
          const current = definitionProjectRef.current.project;
          const draft =
            target.kind === "component"
              ? current.componentAuthoringDrafts?.find(
                  (draft) => draft.id === id,
                )
              : undefined;
          if (!draft) {
            const candidate = current.modelSources
              ?.filter(
                (source) =>
                  target.kind !== "component" && source.id === target.sourceId,
              )
              .flatMap((source) => source.draft?.authoring ?? [])
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
          if (isComponentVariantDraft(draft.text)) {
            try {
              const restored = readComponentVariantDraft(current, draft.text);
              const instance = current.documents
                .find((d) => d.id === restored.documentId)!
                .instances.find((i) => i.id === restored.instanceId)!;
              setComponentEditor({
                key: crypto.randomUUID(),
                projectSessionId,
                mode: "instance",
                definition: restored.definition,
                variant: restored.variant,
                variantArtworkText: restored.artworkText,
                externalDefinitionId: restored.variant.definitionId,
                publicationIntent: "new",
                draft,
                target: {
                  projectSessionId,
                  documentId: restored.documentId,
                  instance,
                },
              });
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
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
              setStatus(error instanceof Error ? error.message : String(error));
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
          returnToLibrary.current = true;
          cancelAllTransientInteraction();
          setComponentEditor({
            key: crypto.randomUUID(),
            projectSessionId,
            mode: "new",
            definition: newComponentDefinition(),
          });
        }}
        onEdit={async (entry, publicationIntent) => {
          returnToLibrary.current = true;
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
              setStatus(error instanceof Error ? error.message : String(error));
            }
            return;
          }
          try {
            const captured = await componentLibraryCapture(entry);
            setComponentEditor({
              key: crypto.randomUUID(),
              projectSessionId,
              mode: "library",
              definition: captured.definition,
              entry: { ...entry, ...captured },
              publicationIntent,
            });
          } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
          }
        }}
        onInsert={insertSharedComponent}
      />
    </Suspense>
  );
}
