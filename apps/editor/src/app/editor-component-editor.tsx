import {
  useRef,
  useEffect,
  useState,
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
};

const ComponentSession = lazyChunk(
  "dialog",
  () => import("./editor-component-session-body"),
);
const ComponentLibrary = lazyChunk(
  "dialog",
  () => import("./editor-component-library"),
);

/** Keep navigation and Library state while session code loads on demand. */
export function EditorComponentEditor(props: EditorComponentEditorProps) {
  const {
    capabilities,
    componentEditor,
    setComponentEditor,
    userComponentsOpen,
    setUserComponentsOpen,
  } = props;
  const returnToLibrary = useRef(false);
  const [libraryOpened, setLibraryOpened] = useState(false);
  useEffect(() => {
    if (userComponentsOpen) {
      setLibraryOpened(true);
      preloadComponentDefinitionEditor();
    }
  }, [userComponentsOpen]);
  if (!capabilities.community && !capabilities.localComponents) return null;
  const cancelSession = () => {
    setComponentEditor(null);
    if (returnToLibrary.current) setUserComponentsOpen(true);
  };
  return (
    <>
      {componentEditor ? (
        <Suspense
          fallback={<ComponentEditorLoading onCancel={cancelSession} />}
        >
          <ComponentSession
            key={componentEditor.key}
            {...props}
            componentEditor={componentEditor}
            returnToLibrary={returnToLibrary}
            onClose={cancelSession}
          />
        </Suspense>
      ) : null}
      {userComponentsOpen || libraryOpened ? (
        <Suspense fallback={null}>
          <div hidden={!userComponentsOpen}>
            <ComponentLibrary
              {...props}
              returnToLibrary={returnToLibrary}
              onClose={() => setUserComponentsOpen(false)}
            />
          </div>
        </Suspense>
      ) : null}
    </>
  );
}
