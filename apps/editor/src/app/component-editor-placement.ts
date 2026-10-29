import { prepareComponentCapture } from "../features/user-components/component-placement";
import { captureLibraryComponent as componentLibraryCapture } from "../features/user-components/component-publication-host";
import { sharedComponentInsertRequest } from "../features/user-components/component-definition-edit";
import type {
  SharedComponent,
  SharedDefinitionPayload,
} from "../features/user-components/component-library-contract";
import type { EditorComponentEditorProps } from "./editor-component-editor";
import type { RefObject } from "react";

export function componentEditorPlacement({
  returnToLibrary,
  editorDocumentController,
  synchronizeExternalCommit,
  editorCommands,
  setStatus,
  definitionProjectRef,
  resolver,
  onBeforePlace,
  externalSubcircuitInsertCandidates,
}: EditorComponentEditorProps & { returnToLibrary: RefObject<boolean> }) {
  async function insertSharedComponent(entry: SharedComponent): Promise<void> {
    returnToLibrary.current = false;
    try {
      const captured = await componentLibraryCapture(entry);
      if (entry.circuit) {
        insertCircuitComponent(
          captured,
          `component-${entry.id}-r${entry.revision}`,
          entry,
        );
        return;
      }
      const current = editorDocumentController.project;
      const prepared = prepareComponentCapture(
        current,
        captured,
        `component-${entry.id}-r${entry.revision}`,
      );
      editorDocumentController.offerComponentDefinition(
        current.componentDefinitions?.find(
          (item) => item.symbol.id === prepared.symbolId,
        ) ?? captured.definition,
      );
      synchronizeExternalCommit();
      editorCommands.execute({
        id: "insert.start",
        launch: {
          kind: "quick",
          request: {
            ...sharedComponentInsertRequest(entry),
            capture: {
              payload: captured,
              identity: `component-${entry.id}-r${entry.revision}`,
              projectId: current.id,
              documentId: editorDocumentController.activeDocumentId,
              structureRevision: current.structureRevision,
              documentRevision: current.documents.find(
                (d) => d.id === editorDocumentController.activeDocumentId,
              )!.revision,
              library: {
                id: entry.id,
                revision: entry.revision,
                status: entry.status,
              },
            },
          },
        },
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function insertCircuitComponent(
    packaged: SharedDefinitionPayload,
    identity: string,
    library?: SharedComponent,
  ) {
    try {
      const current = definitionProjectRef.current.project;
      const prepared = prepareComponentCapture(current, packaged, identity);
      if (!resolver.resolve(prepared.symbolId)) {
        editorDocumentController.offerComponentDefinition({
          symbol: prepared.symbol,
        });
        synchronizeExternalCommit();
      }
      onBeforePlace();
      returnToLibrary.current = false;
      editorCommands.execute({
        id: "insert.start",
        launch: {
          kind: "quick",
          request: {
            kind: "external-subcircuit",
            definitionId: prepared.definitionId!,
            symbolId: prepared.symbolId,
            symbolName: prepared.symbol.name,
            masterName: packaged.circuit!.externalDefinition.name,
            parameters: {},
            initialRotation: 0,
            showReference: !prepared.symbol.hierarchicalBlock,
            referenceText: null,
            showValue: true,
            capture: {
              payload: packaged,
              identity,
              projectId: current.id,
              documentId: editorDocumentController.activeDocumentId,
              structureRevision: current.structureRevision,
              documentRevision: current.documents.find(
                (d) => d.id === editorDocumentController.activeDocumentId,
              )!.revision,
              ...(library
                ? {
                    library: {
                      id: library.id,
                      revision: library.revision,
                      status: library.status,
                    },
                  }
                : {}),
            },
          },
        },
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function placeExternalComponent(definitionId: string): boolean {
    returnToLibrary.current = false;
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

  return {
    insertSharedComponent,
    insertCircuitComponent,
    placeExternalComponent,
  };
}
