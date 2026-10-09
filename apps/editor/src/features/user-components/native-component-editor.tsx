import { useEffect, useState } from "react";
import type { CircuitProject, ExternalSubcircuitDefinition } from "@icm/model";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import {
  ExternalModelSourceEditor,
  type ApplyModelSourceEdit,
} from "../hierarchy/external-model-source-editor";
import type { ExternalDefinitionResult } from "../hierarchy/project-structure-commands";

export interface CircuitComponentAuthoring {
  project: CircuitProject;
  definitionId?: string | undefined;
  symbolId?: string | undefined;
  onApply(edit: ApplyModelSourceEdit): ExternalDefinitionResult;
  onSaveDraft(
    edits: ProjectStructureEdit[],
    definitionId: string,
  ): ExternalDefinitionResult;
  onSetDefinition(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
  onRemoveDefinition(definitionId: string): ExternalDefinitionResult;
  onPlace(definitionId: string): void;
  onCopyText(text: string): Promise<void>;
}

/** Native authoring uses the same Project owner, Apply and symbol as Cell Manager. */
export function NativeComponentEditor({
  authoring,
  onDirtyChange,
  onRequestLeave,
}: {
  authoring: CircuitComponentAuthoring;
  onDirtyChange(dirty: boolean): void;
  onRequestLeave(action: () => void): void;
}) {
  const [definitionId, setDefinitionId] = useState(authoring.definitionId);
  const [pendingPlacement, setPendingPlacement] = useState<string | null>(null);
  const definition = authoring.project.externalSubcircuitDefinitions.find(
    (item) => item.id === definitionId,
  );
  useEffect(() => {
    if (
      !pendingPlacement ||
      !authoring.project.externalSubcircuitDefinitions.some(
        (item) => item.id === pendingPlacement,
      )
    )
      return;
    setPendingPlacement(null);
    authoring.onPlace(pendingPlacement);
  }, [pendingPlacement, authoring]);
  function remember(result: ExternalDefinitionResult) {
    if (result.ok && result.definitionId) setDefinitionId(result.definitionId);
    return result;
  }
  return (
    <div className="component-definition-native">
      <ExternalModelSourceEditor
        customSymbols
        initialSymbolId={authoring.symbolId}
        project={authoring.project}
        definition={definition}
        onApply={(edit) => remember(authoring.onApply(edit))}
        onSaveDraft={(edits, id) => remember(authoring.onSaveDraft(edits, id))}
        onMetadata={authoring.onSetDefinition}
        onDelete={() => {
          if (!definition)
            return { ok: false, message: "No definition to delete." };
          const result = authoring.onRemoveDefinition(definition.id);
          if (result.ok) setDefinitionId(undefined);
          return result;
        }}
        onPlace={setPendingPlacement}
        onCopyText={authoring.onCopyText}
        onDirtyChange={onDirtyChange}
        onRequestLeave={onRequestLeave}
      />
    </div>
  );
}
