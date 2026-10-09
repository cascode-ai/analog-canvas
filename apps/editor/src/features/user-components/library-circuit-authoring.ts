import { useRef, useState } from "react";
import {
  buildCircuitComponentPackage,
  createCircuitComponentPackageProject,
  executeProjectTransaction,
  type CircuitComponentPackage,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import type { SharedComponent } from "./component-library-contract";
import { parseSharedDefinition } from "./component-library-contract";
import type { CircuitComponentAuthoring } from "./native-component-editor";
import { definitionError } from "./component-definition-error";
import { createEmptyProject, type ComponentAuthoringDraft } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { parseSharedComponentEntry } from "./component-library-client";

/** The Project stores the isolated library session as a non-executable draft. */
export function readLibraryAuthoringDraft(draft: ComponentAuthoringDraft) {
  if (!draft.library) throw Error("This is not a library authoring draft.");
  const snapshot: unknown = JSON.parse(draft.text);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw Error("Invalid library authoring snapshot.");
  const data = snapshot as Record<string, unknown>;
  const entry = parseSharedComponentEntry(data.entry);
  if (
    entry.id !== draft.library.componentId ||
    entry.revision !== draft.library.revision
  )
    throw Error("Library draft identity does not match its snapshot.");
  if (typeof data.definitionText === "string")
    return {
      kind: "definition" as const,
      entry,
      text: data.definitionText,
      ...(data.appliedDefinition !== undefined &&
      typeof data.appliedText === "string"
        ? {
            appliedDefinition: parseSharedDefinition(data.appliedDefinition),
            appliedText: data.appliedText,
          }
        : {}),
    };
  if (typeof data.project !== "string" || typeof data.definitionId !== "string")
    throw Error("Invalid library circuit snapshot.");
  const project = parseProject(data.project);
  if (
    !project.externalSubcircuitDefinitions.some(
      (d) => d.id === data.definitionId,
    )
  )
    throw Error("The library draft's model owner is missing.");
  return {
    kind: "circuit" as const,
    entry,
    project,
    definitionId: data.definitionId,
  };
}

/** Opening a public record never edits the active drawing or an earlier capture. */
export function useLibraryCircuitAuthoring(
  entry: SharedComponent | undefined,
  onPlace: (packaged: CircuitComponentPackage) => void,
  onCopyText: (text: string) => Promise<void>,
  persistence: {
    draft?: ComponentAuthoringDraft | undefined;
    onSave(text: string, entry: SharedComponent): string | null;
  },
):
  | (CircuitComponentAuthoring & {
      onPublished(entry: SharedComponent): string | null;
    })
  | undefined {
  const [restored] = useState(() => {
    const saved = persistence.draft?.library
      ? readLibraryAuthoringDraft(persistence.draft)
      : undefined;
    return saved?.kind === "circuit" ? saved : undefined;
  });
  const [project, setProject] = useState(
    () =>
      restored?.project ??
      (entry?.circuit
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
          : null),
  );
  const current = useRef(project);
  const [definitionId, setDefinitionId] = useState(
    restored?.definitionId ?? entry?.circuit?.externalDefinition.id,
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
        const error = persistence.onSave(
          JSON.stringify({
            entry,
            project: serializeProject(result.project),
            definitionId,
          }),
          entry!,
        );
        if (error) return { ok: false, definitionId, message: error };
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
    onPublished: (published) =>
      persistence.draft?.library
        ? persistence.onSave(
            JSON.stringify({
              entry: published,
              project: serializeProject(current.current!),
              definitionId,
            }),
            published,
          )
        : null,
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
