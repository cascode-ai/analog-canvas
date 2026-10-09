import { useEffect, useState, type ReactNode } from "react";
import type {
  CircuitProject,
  ExternalSubcircuitDefinition,
  ComponentDefinition,
} from "@icm/model";
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
  pendingRepair?: boolean;
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
  onRepair(
    edits: ProjectStructureEdit[],
    definitionId: string,
    expectedProject: CircuitProject,
  ): ExternalDefinitionResult;
}

/** Native authoring uses the same Project owner, Apply and symbol as Cell Manager. */
export function NativeComponentEditor({
  authoring,
  onDirtyChange,
  onRequestLeave,
  onApplied,
  onAppliedViewChange,
  publicationAction,
  legacyDefinition,
}: {
  authoring: CircuitComponentAuthoring;
  publicationAction?: ReactNode;
  legacyDefinition?: ComponentDefinition | undefined;
  onDirtyChange(dirty: boolean): void;
  onRequestLeave(action: () => void): void;
  onApplied(definitionId: string): void;
  onAppliedViewChange?(viewingApplied: boolean): void;
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
    if (result.ok && result.definitionId) {
      setDefinitionId(result.definitionId);
      onApplied(result.definitionId);
    }
    return result;
  }
  return (
    <div className="component-definition-native">
      <ExternalModelSourceEditor
        customSymbols
        publicationAction={publicationAction}
        legacyDefinition={legacyDefinition}
        canPlace={!authoring.pendingRepair}
        initialSymbolId={authoring.symbolId}
        allowOwnerChange={!!authoring.pendingRepair}
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
        onAppliedViewChange={onAppliedViewChange}
        onRequestLeave={onRequestLeave}
      />
    </div>
  );
}
