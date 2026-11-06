import {
  useEffect,
  useRef,
  Suspense,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { SymbolDefinition } from "@icm/symbols";
import type { CircuitProject } from "@icm/model";
import type { CircuitComponentAuthoring } from "../features/user-components/native-component-editor";
import type { createEditorCommandRouter } from "../commands/editor-command";
import type {
  EditorDocumentController,
  useDocumentController,
} from "../document/document-controller";
import type { useSelectionController } from "../features/selection/selection-controller";
import type { EditorServices } from "../services/editor-services";
import type { ComponentEditorSession } from "./component-editor-session";
import { lazyChunk } from "../components/chunk-load-fallback";
import type { LibraryFold } from "../features/editor-shell/shapes-panel";
import { preloadComponentDefinitionEditor } from "./lazy-editor-dialogs";
import { ComponentEditorLoading } from "../features/user-components/component-editor-loading";

type DocumentControllerState = ReturnType<typeof useDocumentController>;
export type EditorComponentEditorProps = {
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
  editorDocumentController: EditorDocumentController;
  synchronizeExternalCommit: DocumentControllerState["synchronizeExternalCommit"];
  definitionProjectRef: RefObject<{
    project: CircuitProject;
    projectSessionId: string;
  }>;
  selectOnly: ReturnType<typeof useSelectionController>["selectOnly"];
  cancelAllTransientInteraction: () => void;
  editorCommands: ReturnType<typeof createEditorCommandRouter>;
  returnToLibrary: RefObject<boolean>;
};

const ComponentSession = lazyChunk(
  "dialog",
  () => import("./editor-component-session-body"),
);
const ComponentLibrary = lazyChunk(
  "inline",
  () => import("./editor-component-library"),
);

/** The Library panel's component fold, loaded once that fold first opens. */
export function EditorLibraryComponents(
  props: EditorComponentEditorProps & {
    fold: LibraryFold;
    onDropPlacement(clientX: number, clientY: number): void;
  },
) {
  useEffect(() => {
    preloadComponentDefinitionEditor();
  }, []);
  return (
    <Suspense
      fallback={
        <p className="user-components-message" role="status">
          Loading components…
        </p>
      }
    >
      <ComponentLibrary {...props} />
    </Suspense>
  );
}

/** Keep navigation while the definition editor's code loads on demand. */
export function EditorComponentEditor(props: EditorComponentEditorProps) {
  const {
    capabilities,
    componentEditor,
    setComponentEditor,
    setComponentLibraryRefresh,
    setUserComponentsOpen,
    returnToLibrary,
  } = props;
  // The Library panel stays open under an editing session, which may publish,
  // so the list is checked again when the session ends.
  const editing = componentEditor !== null;
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing)
      setComponentLibraryRefresh((value) => value + 1);
    wasEditing.current = editing;
  }, [editing]);
  if (!capabilities.community && !capabilities.localComponents) return null;
  const cancelSession = () => {
    setComponentEditor(null);
    if (returnToLibrary.current) setUserComponentsOpen(true);
  };
  return componentEditor ? (
    <Suspense fallback={<ComponentEditorLoading onCancel={cancelSession} />}>
      <ComponentSession
        key={componentEditor.key}
        {...props}
        componentEditor={componentEditor}
        onClose={cancelSession}
      />
    </Suspense>
  ) : null;
}
