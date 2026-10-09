// The shared-component editor and the public component library, opened over
// the editor.
import {
  lazy,
  Suspense,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
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
  function insertSharedComponent(entry: SharedComponent): void {
    try {
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

  return (
    <>
      {capabilities.community && componentEditor ? (
        <Suspense fallback={null}>
          <ComponentDefinitionEditor
            key={componentEditor.key}
            definition={componentEditor.definition}
            mode={componentEditor.mode}
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
                mode: "new",
                definition: newComponentDefinition(),
              });
            }}
            onEdit={(entry) => {
              cancelAllTransientInteraction();
              setComponentEditor({
                key: crypto.randomUUID(),
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
