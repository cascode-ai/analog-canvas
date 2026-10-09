import { useRef, useState } from "react";
import {
  buildCircuitComponentPackage,
  createCircuitComponentPackageProject,
  executeProjectTransaction,
  type CircuitComponentPackage,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import type { SharedComponent } from "./component-library-contract";
import type { CircuitComponentAuthoring } from "./native-component-editor";
import { definitionError } from "./component-definition-error";
import { createEmptyProject } from "@icm/model";

/** Opening a public record never edits the active drawing or an earlier capture. */
export function useLibraryCircuitAuthoring(
  entry: SharedComponent | undefined,
  onPlace: (packaged: CircuitComponentPackage) => void,
  onCopyText: (text: string) => Promise<void>,
): CircuitComponentAuthoring | undefined {
  const [project, setProject] = useState(() =>
    entry?.circuit
      ? createCircuitComponentPackageProject(
          { definition: entry.definition, circuit: entry.circuit },
          `library-${entry.id}-r${entry.revision}`,
        )
      : entry?.definition.subcircuit
        ? {
            ...createEmptyProject(
              `library-${entry.id}-r${entry.revision}`,
              "Component repair",
            ),
            componentDefinitions: [entry.definition],
          }
        : null,
  );
  const current = useRef(project);
  const [definitionId, setDefinitionId] = useState(
    entry?.circuit?.externalDefinition.id,
  );
  current.current = project;
  if (!project || !entry) return undefined;
  function commit(edits: ProjectStructureEdit[], definitionId: string) {
    const source = current.current!;
    try {
      const result = executeProjectTransaction(source, {
        transactionId: `library-${crypto.randomUUID()}`,
        projectId: source.id,
        expectedStructureRevision: source.structureRevision,
        actor: { kind: "human", id: "human-local" },
        edits,
      });
      if (result.ok) {
        setDefinitionId(definitionId);
        current.current = result.project;
        setProject(result.project);
      }
      return {
        ok: result.ok,
        definitionId,
        message: result.ok
          ? "Applied component definition"
          : (result.diagnostics[0]?.message ?? result.error.message),
      };
    } catch (error) {
      return { ok: false, definitionId, message: definitionError(error) };
    }
  }
  return {
    project,
    definitionId,
    onRepair: (edits, definitionId, expectedProject) =>
      JSON.stringify(current.current) === JSON.stringify(expectedProject)
        ? commit(edits, definitionId)
        : {
            ok: false,
            message:
              "The Project changed. Reopen the component before repairing.",
          },
    onApply: (edit) => commit([edit], edit.definitions[0]!.definitionId),
    onSaveDraft: commit,
    onSetDefinition: (definition) =>
      commit(
        [{ kind: "upsert_external_subcircuit_definition", definition }],
        definition.id,
      ),
    onRemoveDefinition: (definitionId) =>
      commit(
        [{ kind: "remove_external_subcircuit_definition", definitionId }],
        definitionId,
      ),
    onPlace: (definitionId) => {
      const applied = {
        ...current.current!,
        modelSources: current.current!.modelSources?.map(
          ({ draft: _draft, ...source }) => source,
        ),
      };
      // Placement captures the applied implementation; draft publication stays blocked.
      onPlace(buildCircuitComponentPackage(applied, definitionId));
    },
    onCopyText,
  };
}
