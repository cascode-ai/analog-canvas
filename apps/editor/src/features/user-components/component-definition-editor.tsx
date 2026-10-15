import { planComponentDefinitionEdit } from "./component-definition-plan";
import {
  publicationFromOrigin,
  type ComponentPublication,
} from "./component-publication";
import {
  saveLibraryComponent,
  captureLibraryComponent as componentLibraryCapture,
} from "./component-publication-host";
import { componentPublicationContent } from "./component-publication-content";
import { definitionError } from "./component-definition-error";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { InlineConfirm } from "../../components/inline-confirm";
import {
  NativeComponentEditor,
  type CircuitComponentAuthoring,
} from "./native-component-editor";
import type { ComponentDefinition, ComponentAuthoringDraft } from "@icm/model";
import { hasBuiltInSubcircuitInterface } from "@icm/devices";
import {
  buildCircuitComponentPackage,
  createCircuitComponentPackageProject,
  prepareLegacyCircuitRepair,
  prepareLegacyCircuitDraft,
  type LegacyCircuitRepair,
  type CircuitComponentPackage,
} from "@icm/edit-engine";
import {
  useLibraryCircuitAuthoring,
  readLibraryAuthoringDraft,
  isLibraryAuthoringDraft,
} from "./library-circuit-authoring";
import { serializeProject } from "@icm/project-protocol";
import { localComponentDefinition } from "./component-definition-edit";
import {
  AccountMenu,
  fetchSessionUser,
  type SessionUser,
} from "../../components/account";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import { DefinitionWorkspace } from "./definition-workspace";
import {
  parseSharedDefinition,
  componentCapability,
  type SharedComponent,
} from "./component-library-contract";
import {
  manageSharedComponent,
  readSharedComponent,
} from "./component-library-client";
import { ComponentLibraryError } from "./component-library-error";
import { readNativeComponent } from "../../hosts/native-component-library";
const readLibraryComponent = import.meta.env?.ICM_DESKTOP
  ? readNativeComponent
  : readSharedComponent;

const ProjectTextEditor = lazy(
  () => import("../project-code/project-text-editor"),
);

export interface ComponentDefinitionEditorProps {
  definition: ComponentDefinition;
  entry?: SharedComponent;
  publicationIntent?: "new" | "update" | undefined;
  draft?: ComponentAuthoringDraft;
  repairTarget?: { documentId: string; instanceId: string };
  mode: "new" | "instance" | "library";
  circuit?: CircuitComponentAuthoring;
  validateApply?(
    definition: ComponentDefinition,
    planner: typeof planComponentDefinitionEdit,
  ): string | null;
  onApplyDefinition(
    definition: ComponentDefinition,
    planner: typeof planComponentDefinitionEdit,
  ): string | null;
  onPlaceDefinition(definition: ComponentDefinition): string | null;
  onSaveDefinitionDraft(text: string): string | null;
  onSaveLibraryDraft(text: string, entry?: SharedComponent): string | null;
  onManaged(): void;
  onAssociateLibrary?(
    payload: CircuitComponentPackage | { definition: ComponentDefinition },
  ): string | null;
  onReloadLibrary(entry: SharedComponent): string | null;
  onPlaceCircuit(packaged: CircuitComponentPackage): void;
  onClose(): void;
  onBackToLibrary?: (() => void) | undefined;
}

export default function ComponentDefinitionEditor(
  props: ComponentDefinitionEditorProps,
) {
  const latest = useRef(props);
  latest.current = props;
  const [savedArtwork] = useState(() => {
    const restored = isLibraryAuthoringDraft(props.draft)
      ? readLibraryAuthoringDraft(props.draft!)
      : undefined;
    return restored?.kind === "definition" ? restored : undefined;
  });
  const [source, setSource] = useState(
    () =>
      savedArtwork?.text ??
      (!isLibraryAuthoringDraft(props.draft) ? props.draft?.text : undefined) ??
      JSON.stringify(props.definition, null, 2),
  );
  const [baseline, setBaseline] = useState(source);
  const [localApplied, setLocalApplied] = useState<ComponentDefinition | null>(
    savedArtwork?.appliedDefinition ??
      (props.mode === "new" ? null : props.definition),
  );
  const [localAppliedText, setLocalAppliedText] = useState(
    savedArtwork?.appliedText ??
      (props.mode === "new" ? "" : JSON.stringify(props.definition, null, 2)),
  );
  const [record, setRecord] = useState(props.entry);
  const [publication, setPublication] = useState<ComponentPublication>(
    () =>
      (isLibraryAuthoringDraft(props.draft)
        ? readLibraryAuthoringDraft(props.draft!).publication
        : undefined) ?? {
        ...(!import.meta.env?.ICM_DESKTOP &&
        props.definition.libraryOrigin &&
        props.mode === "instance" &&
        !props.publicationIntent
          ? {
              kind: "update" as const,
              componentId: props.definition.libraryOrigin.componentId,
              expectedLibraryRevision: props.definition.libraryOrigin.revision,
            }
          : {
              kind:
                props.entry && props.publicationIntent === "update"
                  ? ("update" as const)
                  : ("new" as const),
              componentId:
                props.entry && props.publicationIntent === "update"
                  ? props.entry.id
                  : crypto.randomUUID(),
            }),
      },
  );
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publicationConflict, setPublicationConflict] = useState(false);
  const [duplicate, setDuplicate] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  const [linkId, setLinkId] = useState("");
  const originResolved = useRef(false);
  const [originLoading, setOriginLoading] = useState(
    () =>
      !import.meta.env?.ICM_DESKTOP &&
      !!props.definition.libraryOrigin &&
      props.mode === "instance" &&
      !props.publicationIntent &&
      !isLibraryAuthoringDraft(props.draft),
  );
  useEffect(() => {
    const origin = props.definition.libraryOrigin;
    if (
      import.meta.env?.ICM_DESKTOP ||
      !authReady ||
      !user ||
      originResolved.current ||
      props.publicationIntent ||
      isLibraryAuthoringDraft(props.draft) ||
      props.mode !== "instance" ||
      !origin
    )
      return;
    originResolved.current = true;
    void readSharedComponent(origin.componentId)
      .then((entry) => {
        setRecord(entry);
        setPublication(publicationFromOrigin(origin, entry, user));
        if (entry.authorId === user.id || user.isAdmin) {
          if (entry.revision !== origin.revision) {
            setPublicationConflict(true);
            setNotice(
              "The published version changed. Review it before updating.",
            );
          }
        }
      })
      .catch((error) => {
        setPublicationConflict(true);
        setNotice(definitionError(error));
      })
      .finally(() => setOriginLoading(false));
  }, [
    authReady,
    user,
    props.definition.libraryOrigin,
    props.publicationIntent,
    props.draft,
    props.mode,
  ]);
  const [pinNames, setPinNames] = useState(true);
  const [previewWarning, setPreviewWarning] = useState<string | null>(null);
  const libraryAuthoring = useLibraryCircuitAuthoring(
    record,
    (packaged) => {
      const placed = record
        ? componentLibraryCapture(record).then((captured) =>
            props.onPlaceCircuit({
              ...packaged,
              definition: {
                ...packaged.definition,
                libraryOrigin: captured.definition.libraryOrigin!,
              },
            }),
          )
        : Promise.resolve(props.onPlaceCircuit(packaged));
      void placed
        .then(props.onClose)
        .catch((error) => setNotice(definitionError(error)));
    },
    (text) => props.circuit!.onCopyText(text),
    {
      draft: props.draft,
      onSave: (text, entry) =>
        latest.current.onSaveLibraryDraft(
          JSON.stringify({
            ...JSON.parse(text),
            kind: "library-authoring",
            definition: entry?.definition ?? props.definition,
            publication,
          }),
          entry,
        ),
    },
  );
  const baseAuthoring = libraryAuthoring ?? props.circuit;
  const savedRepairCandidate = baseAuthoring?.project.modelSources
    ?.flatMap((source) => source.draft?.authoring ?? [])
    .find(
      (candidate) =>
        candidate.definitionId === baseAuthoring.definitionId &&
        candidate.legacyRepair,
    );
  const [repairIdentity] = useState(
    savedRepairCandidate?.legacyRepair?.identity ?? publication.componentId,
  );
  const [repair, setRepair] = useState<LegacyCircuitRepair | null>(() =>
    props.mode !== "new" &&
    props.definition.subcircuit &&
    !hasBuiltInSubcircuitInterface(props.definition) &&
    !props.entry?.circuit &&
    baseAuthoring &&
    (!baseAuthoring.definitionId || savedRepairCandidate?.legacyRepair)
      ? prepareLegacyCircuitRepair(
          baseAuthoring.project,
          props.definition,
          repairIdentity,
        )
      : null,
  );
  const [repairScope, setRepairScope] = useState<"class" | "selected">(
    savedRepairCandidate?.legacyRepair?.selected ? "selected" : "class",
  );
  const [disconnectPorts, setDisconnectPorts] = useState<string[]>(
    savedRepairCandidate?.legacyRepair?.disconnectPorts ?? [],
  );
  const authoring: CircuitComponentAuthoring | undefined =
    repair && baseAuthoring
      ? {
          ...baseAuthoring,
          project: repair.project,
          definitionId:
            savedRepairCandidate?.definitionId ?? repair.definitionId,
          symbolId: repair.symbolId,
          pendingRepair: true,
          onApply: (edit) => {
            try {
              const prepared = prepareLegacyCircuitRepair(
                repair.expectedProject,
                props.definition,
                repairIdentity,
                {
                  implementation: edit,
                  disconnectPorts,
                  ...(repairScope === "selected" && props.repairTarget
                    ? { selected: props.repairTarget }
                    : {}),
                },
              );
              const result = baseAuthoring.onRepair(
                prepared.edits,
                prepared.definitionId,
                prepared.expectedProject,
              );
              if (result.ok) setRepair(null);
              return {
                ...result,
                sourceRevision: prepared.project.modelSources!.find(
                  (source) => source.id === edit.source.id,
                )!.revision,
              };
            } catch (error) {
              return { ok: false, message: definitionError(error) };
            }
          },
          onSaveDraft: (edits, definitionId) => {
            try {
              const prepared = prepareLegacyCircuitDraft(
                repair.expectedProject,
                props.definition,
                repairIdentity,
                edits,
                definitionId,
                repairScope === "selected" ? props.repairTarget : undefined,
                disconnectPorts,
              );
              const result = baseAuthoring.onSaveDraft(
                prepared.edits,
                definitionId,
              );
              if (result.ok) setRepair(prepared.repair);
              return {
                ...result,
                message: result.ok
                  ? "Saved repair draft. The captured class is unchanged."
                  : result.message,
              };
            } catch (error) {
              return { ok: false, message: definitionError(error) };
            }
          },
          onSetDefinition: () => ({
            ok: false,
            message: "Apply the repair before editing metadata.",
          }),
          onRemoveDefinition: () => ({
            ok: false,
            message: "No applied repair to remove.",
          }),
          onPlace: () =>
            setNotice("Apply the repair before placing another instance."),
        }
      : baseAuthoring;
  const [definitionType, setDefinitionType] = useState(
    props.draft && (!isLibraryAuthoringDraft(props.draft) || savedArtwork)
      ? "json"
      : authoring?.definitionId || (props.mode === "new" && authoring)
        ? "circuit"
        : "json",
  );
  const [nativeDirty, setNativeDirty] = useState(false);
  const [viewingApplied, setViewingApplied] = useState(false);
  const [nativeDefinitionId, setNativeDefinitionId] = useState(
    authoring?.definitionId,
  );
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const native = definitionType === "circuit" && authoring;
  const nativeOwner = native
    ? native.project.externalSubcircuitDefinitions.find(
        (definition) => definition.id === nativeDefinitionId,
      )
    : undefined;
  const nativeSource = native
    ? native.project.modelSources?.find(
        (model) => model.id === nativeOwner?.implementation?.sourceId,
      )
    : undefined;
  const nativeReady =
    nativeOwner?.implementation?.kind === "source" &&
    !!nativeSource &&
    nativeSource.revision > 0 &&
    (!nativeSource.draft || viewingApplied);
  const dirty = nativeDirty || source !== baseline;
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    if (!import.meta.env?.ICM_DESKTOP)
      void fetchSessionUser().then((next) => {
        if (active) {
          setUser(next);
          setAuthReady(true);
        }
      });
    return () => {
      active = false;
      dialog.current?.close();
    };
  }, []);
  const parsed = useMemo(() => {
    try {
      return {
        definition: parseSharedDefinition(JSON.parse(source)),
        error: null,
      };
    } catch (error) {
      return { definition: null, error: definitionError(error) };
    }
  }, [source]);
  const lastValidDefinition = useRef(parsed.definition);
  if (parsed.definition) lastValidDefinition.current = parsed.definition;
  const previewDefinition = parsed.definition ?? lastValidDefinition.current;
  const canUpdate =
    !!record &&
    (import.meta.env?.ICM_DESKTOP ||
      user?.isAdmin ||
      (record.authorId === user?.id && record.status === "shared"));
  const id = publication.componentId;
  const revision =
    publication.kind === "update"
      ? (publication.expectedLibraryRevision ?? record?.revision ?? 0)
      : 0;
  function requestLeave(action: () => void) {
    if (dirty) setPendingLeave(() => action);
    else action();
  }
  function close() {
    if (busy) return;
    requestLeave(props.onClose);
  }
  function applyLocal(): ComponentDefinition | null {
    if (!parsed.definition) return null;
    const definition = localComponentDefinition(
      parsed.definition,
      crypto.randomUUID(),
    );
    const origin =
      localApplied?.libraryOrigin ?? props.definition.libraryOrigin;
    if (origin) definition.libraryOrigin = origin;
    const error = latest.current.onApplyDefinition(
      definition,
      planComponentDefinitionEdit,
    );
    if (error) {
      setNotice(error);
      return null;
    }
    if (props.mode === "library" || isLibraryAuthoringDraft(props.draft)) {
      const error = saveArtworkDraft(record, definition, source);
      if (error) {
        setNotice(error);
        return null;
      }
    }
    setLocalApplied(definition);
    setLocalAppliedText(source);
    setBaseline(source);
    setNotice("Applied component definition.");
    return definition;
  }
  function placeLocal() {
    const definition =
      source !== localAppliedText || !localApplied
        ? applyLocal()
        : localApplied;
    if (!definition) return;
    const error = latest.current.onPlaceDefinition(definition);
    if (error) setNotice(error);
    else props.onClose();
  }
  function saveLocalDraft() {
    const error =
      props.mode === "library" || isLibraryAuthoringDraft(props.draft)
        ? saveArtworkDraft(record)
        : latest.current.onSaveDefinitionDraft(source);
    if (error) setNotice(error);
    else {
      setBaseline(source);
      setNotice("Saved authoring draft. Applied definitions are unchanged.");
    }
  }
  function saveArtworkDraft(
    entry: SharedComponent | undefined,
    appliedDefinition = localApplied,
    appliedText = localAppliedText,
    destination = publication,
  ) {
    return latest.current.onSaveLibraryDraft(
      JSON.stringify({
        kind: "library-authoring",
        entry,
        definition: appliedDefinition ?? props.definition,
        publication: destination,
        definitionText: source,
        ...(appliedDefinition ? { appliedDefinition, appliedText } : {}),
      }),
      entry,
    );
  }
  function saveCircuitPublicationDraft(
    entry: SharedComponent | undefined,
    packaged: CircuitComponentPackage,
    destination = publication,
  ) {
    if (!native || !nativeDefinitionId) return "No applied native circuit.";
    return latest.current.onSaveLibraryDraft(
      JSON.stringify({
        kind: "library-authoring",
        entry,
        definition: packaged.definition,
        publication: destination,
        project: serializeProject(
          libraryAuthoring
            ? {
                ...native.project,
                componentDefinitions: native.project.componentDefinitions?.map(
                  (definition) =>
                    definition.symbol.id === packaged.definition.symbol.id
                      ? {
                          ...definition,
                          ...(packaged.definition.libraryOrigin
                            ? {
                                libraryOrigin:
                                  packaged.definition.libraryOrigin,
                              }
                            : {}),
                        }
                      : definition,
                ),
              }
            : createCircuitComponentPackageProject(
                packaged,
                `publication-${id}`,
              ),
        ),
        definitionId: nativeDefinitionId,
      }),
      entry,
    );
  }
  async function save() {
    if (native) {
      if (
        !nativeDefinitionId ||
        !nativeReady ||
        nativeDirty ||
        busy ||
        (!import.meta.env?.ICM_DESKTOP && !user) ||
        originLoading ||
        publicationConflict ||
        (publication.kind === "update" && !canUpdate)
      )
        return;
      setBusy(true);
      setNotice(null);
      try {
        const packaged = buildCircuitComponentPackage(
          viewingApplied
            ? {
                ...native.project,
                modelSources: native.project.modelSources?.map(
                  ({ draft: _draft, ...source }) => source,
                ),
              }
            : native.project,
          nativeDefinitionId,
          native.symbolId,
        );
        const pendingError = saveCircuitPublicationDraft(record, packaged);
        if (pendingError) throw Error(pendingError);
        const result = await saveLibraryComponent({
          componentId: id,
          revision,
          payload: packaged,
        });
        const saved = result.entry;
        const captured = await componentLibraryCapture(saved);
        const associationError = import.meta.env?.ICM_DESKTOP
          ? null
          : componentPublicationContent(packaged) !==
              componentPublicationContent(captured)
            ? "The local definition changed. Recover the published snapshot before associating."
            : latest.current.onAssociateLibrary?.(captured);
        setRecord(saved);
        setPublication({
          kind: "update",
          componentId: saved.id,
          expectedLibraryRevision: saved.revision,
        });
        const draftError = saveCircuitPublicationDraft(
          saved,
          {
            ...packaged,
            definition: associationError
              ? packaged.definition
              : {
                  ...packaged.definition,
                  libraryOrigin: captured.definition.libraryOrigin!,
                },
          },
          {
            kind: "update",
            componentId: saved.id,
            expectedLibraryRevision: saved.revision,
          },
        );
        latest.current.onManaged();
        setNotice(
          import.meta.env?.ICM_DESKTOP
            ? draftError
              ? `Saved to the local library. Draft: ${draftError}`
              : "Saved to the local library."
            : associationError
              ? `Published. Project association pending: ${associationError}`
              : draftError
                ? `Saved to the public library. Draft: ${draftError}`
                : result.outcome === "unchanged"
                  ? "Already up to date."
                  : "Saved to the public library.",
        );
      } catch (error) {
        if (
          error instanceof ComponentLibraryError &&
          error.code === "COMPONENT_ALREADY_PUBLISHED"
        )
          setDuplicate(error.existing ?? null);
        setPublicationConflict(
          error instanceof ComponentLibraryError &&
            error.code !== "COMPONENT_ALREADY_PUBLISHED" &&
            [403, 409].includes(error.status),
        );
        setNotice(definitionError(error));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (
      !localApplied ||
      source !== localAppliedText ||
      busy ||
      (!import.meta.env?.ICM_DESKTOP && !user) ||
      originLoading ||
      publicationConflict ||
      (publication.kind === "update" && !canUpdate)
    )
      return;
    const conflict = latest.current.validateApply?.(
      localApplied,
      planComponentDefinitionEdit,
    );
    if (conflict) {
      setNotice(conflict);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const pendingError = saveArtworkDraft(
        record,
        localApplied,
        localAppliedText,
      );
      if (pendingError) throw Error(pendingError);
      const result = await saveLibraryComponent({
        componentId: id,
        revision,
        payload: { definition: localApplied },
      });
      const saved = result.entry;
      const captured = await componentLibraryCapture(saved);
      const associationError = import.meta.env?.ICM_DESKTOP
        ? null
        : componentPublicationContent({ definition: localApplied }) !==
            componentPublicationContent(captured)
          ? "The local definition changed. Recover the published snapshot before associating."
          : latest.current.onAssociateLibrary?.(captured);
      const associated = associationError
        ? localApplied
        : {
            ...localApplied,
            libraryOrigin: captured.definition.libraryOrigin!,
          };
      setLocalApplied(associated);
      setRecord(saved);
      setPublication({
        kind: "update",
        componentId: saved.id,
        expectedLibraryRevision: saved.revision,
      });
      setBaseline(source);
      latest.current.onManaged();
      const draftError = saveArtworkDraft(saved, associated, localAppliedText, {
        kind: "update",
        componentId: saved.id,
        expectedLibraryRevision: saved.revision,
      });
      setNotice(
        import.meta.env?.ICM_DESKTOP
          ? draftError
            ? `Saved to the local library. Draft: ${draftError}`
            : "Saved to the local library."
          : associationError
            ? `Published. Project association pending: ${associationError}`
            : draftError
              ? `Published to the public library. Draft: ${draftError}`
              : result.outcome === "unchanged"
                ? "Already up to date."
                : "Published to the public library.",
      );
    } catch (error) {
      if (
        error instanceof ComponentLibraryError &&
        error.code === "COMPONENT_ALREADY_PUBLISHED"
      )
        setDuplicate(error.existing ?? null);
      setPublicationConflict(
        error instanceof ComponentLibraryError &&
          error.code !== "COMPONENT_ALREADY_PUBLISHED" &&
          [403, 409].includes(error.status),
      );
      setNotice(definitionError(error));
    } finally {
      setBusy(false);
    }
  }
  async function manage(status: "official" | "deleted" | "shared") {
    if (import.meta.env?.ICM_DESKTOP) return;
    if (!record || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      setRecord(await manageSharedComponent(record, status));
      props.onManaged();
      setNotice(
        status === "deleted"
          ? "Removed from the library."
          : status === "official"
            ? "Promoted to an official component."
            : "Restored to User Defined.",
      );
    } catch (error) {
      setNotice(definitionError(error));
    } finally {
      setBusy(false);
    }
  }
  async function associateExisting(
    componentId: string,
    expectedRevision?: number,
  ) {
    setBusy(true);
    try {
      const entry = await readSharedComponent(componentId);
      if (expectedRevision !== undefined && entry.revision !== expectedRevision)
        throw Error(
          "The existing component changed. Review it before associating.",
        );
      const captured = await componentLibraryCapture(entry);
      const candidate =
        native && nativeDefinitionId
          ? buildCircuitComponentPackage(
              native.project,
              nativeDefinitionId,
              native.symbolId,
            )
          : localApplied
            ? { definition: localApplied }
            : null;
      if (
        !candidate ||
        componentPublicationContent(candidate) !==
          componentPublicationContent(captured)
      )
        throw Error(
          "Apply the matching definition before associating this publication.",
        );
      const error = latest.current.onAssociateLibrary?.(captured);
      if (error) throw Error(error);
      const destination: ComponentPublication =
        entry.authorId === user?.id || user?.isAdmin
          ? {
              kind: "update",
              componentId: entry.id,
              expectedLibraryRevision: entry.revision,
            }
          : publication;
      const applied = localApplied
        ? { ...localApplied, libraryOrigin: captured.definition.libraryOrigin! }
        : null;
      setRecord(entry);
      setPublication(destination);
      setDuplicate(null);
      setLocalApplied(applied);
      const draftError = native
        ? saveCircuitPublicationDraft(
            entry,
            captured as CircuitComponentPackage,
            destination,
          )
        : saveArtworkDraft(entry, applied, localAppliedText, destination);
      setNotice(draftError ?? "Using the existing publication.");
    } catch (error) {
      setNotice(definitionError(error));
    } finally {
      setBusy(false);
    }
  }
  const publishAction = (
    <button
      type="button"
      className="primary"
      disabled={
        (!import.meta.env?.ICM_DESKTOP && (!authReady || !user)) ||
        originLoading ||
        publicationConflict ||
        (publication.kind === "update" && !canUpdate) ||
        (native
          ? !nativeReady || nativeDirty
          : !localApplied || source !== localAppliedText) ||
        busy ||
        (publication.kind === "update" && record?.status === "deleted")
      }
      onClick={() => void save()}
    >
      {import.meta.env?.ICM_DESKTOP
        ? busy
          ? "Saving…"
          : publication.kind === "update"
            ? "Update local component"
            : "Save to local library"
        : busy
          ? "Publishing…"
          : publication.kind === "new" && record
            ? "Publish as new component"
            : publication.kind === "update"
              ? user?.isAdmin && record?.authorId !== user.id
                ? "Update component (admin)"
                : "Update my component"
              : "Publish"}
    </button>
  );
  return (
    <dialog
      ref={dialog}
      className="component-definition-dialog"
      aria-label="Edit Component Definition"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (
          !native &&
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          saveLocalDraft();
        }
      }}
    >
      <header>
        <strong>
          {props.mode === "new"
            ? "Create Component"
            : props.mode === "library" && publication.kind === "new"
              ? "Create from Component"
              : "Edit Component"}
        </strong>
        {(props.mode === "new" || repair) && props.circuit ? (
          <label className="component-definition-type">
            Definition type{" "}
            <select
              aria-label="Definition type"
              value={definitionType}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setDefinitionType(next);
              }}
            >
              <option value="circuit">Circuit</option>
              <option value="json">Primitive / Artwork (advanced)</option>
            </select>
          </label>
        ) : null}
        <div className="component-definition-actions">
          {props.onBackToLibrary ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => requestLeave(props.onBackToLibrary!)}
            >
              Back to library
            </button>
          ) : null}
          {!import.meta.env?.ICM_DESKTOP && !user && authReady ? (
            <AccountMenu inEditor />
          ) : null}
          {dirty || pendingLeave ? (
            <InlineConfirm
              aria-label="Close component editor"
              disabled={busy}
              open={!!pendingLeave}
              onOpenChange={(open) =>
                setPendingLeave(open ? () => props.onClose : null)
              }
              confirmLabel="Discard changes"
              cancelLabel="Keep editing"
              onConfirm={() => {
                const action = pendingLeave;
                setPendingLeave(null);
                if (!native) setSource(baseline);
                action?.();
              }}
            >
              ×
            </InlineConfirm>
          ) : (
            <button
              type="button"
              aria-label="Close component editor"
              disabled={busy}
              onClick={close}
            >
              ×
            </button>
          )}
        </div>
      </header>
      {authoring ? (
        <div className="component-native-session" hidden={!native}>
          {repair ? (
            <label className="component-definition-type">
              Apply to{" "}
              <select
                aria-label="Repair scope"
                value={repairScope}
                onChange={(event) =>
                  setRepairScope(
                    event.currentTarget.value as "class" | "selected",
                  )
                }
              >
                <option value="class">Captured class in this Project</option>
                {props.repairTarget ? (
                  <option value="selected">Selected instance</option>
                ) : null}
              </select>
            </label>
          ) : null}
          {repair ? (
            <details className="component-repair-connections">
              <summary>Repair connections</summary>
              <p>
                {repairScope === "selected"
                  ? 1
                  : baseAuthoring!.project.documents
                      .flatMap((document) => document.instances)
                      .filter(
                        (instance) =>
                          instance.symbolId === props.definition.symbol.id,
                      ).length}{" "}
                legacy instance(s) in this Project.
              </p>
              {props.definition.subcircuit!.ports.map((port) => (
                <label key={port.name}>
                  <input
                    type="checkbox"
                    checked={disconnectPorts.includes(port.name)}
                    onChange={(event) =>
                      setDisconnectPorts(
                        event.currentTarget.checked
                          ? [...disconnectPorts, port.name]
                          : disconnectPorts.filter(
                              (name) => name !== port.name,
                            ),
                      )
                    }
                  />
                  Disconnect {port.name} and keep wires
                </label>
              ))}
            </details>
          ) : null}
          <NativeComponentEditor
            authoring={authoring}
            publicationAction={publishAction}
            legacyDefinition={repair ? props.definition : undefined}
            onDirtyChange={setNativeDirty}
            onRequestLeave={requestLeave}
            onApplied={setNativeDefinitionId}
            onAppliedViewChange={setViewingApplied}
          />
        </div>
      ) : null}
      {!native ? (
        <>
          {parsed.definition &&
          componentCapability({ definition: parsed.definition }) ===
            "symbol-only" ? (
            <p className="component-definition-note">
              Symbol only · add a circuit implementation to simulate.
            </p>
          ) : null}
          {parsed.definition ? (
            <label className="component-definition-name">
              Display name{" "}
              <input
                aria-label="Component display name"
                key={parsed.definition.symbol.name}
                defaultValue={parsed.definition.symbol.name}
                maxLength={100}
                onBlur={(event) => {
                  if (!event.currentTarget.value.trim()) {
                    event.currentTarget.value = parsed.definition!.symbol.name;
                    return;
                  }
                  setSource(
                    JSON.stringify(
                      {
                        ...parsed.definition,
                        symbol: {
                          ...parsed.definition!.symbol,
                          name: event.currentTarget.value,
                        },
                      },
                      null,
                      2,
                    ),
                  );
                }}
              />
            </label>
          ) : null}
          <DefinitionWorkspace>
            <section
              className="component-definition-preview"
              aria-label="Component preview"
            >
              {previewDefinition ? (
                <>
                  {parsed.error ? (
                    <p role="status">Showing the last valid preview.</p>
                  ) : null}
                  <div className="component-definition-art">
                    <SymbolArtwork
                      fitContent
                      onPreviewWarning={setPreviewWarning}
                      symbol={previewDefinition.symbol}
                      className="component-definition-artwork"
                      paddingRatio={0.25}
                    />
                  </div>
                  {previewWarning ? (
                    <small role="status">{previewWarning}</small>
                  ) : null}
                  <label>
                    <input
                      type="checkbox"
                      checked={pinNames}
                      onChange={(event) => setPinNames(event.target.checked)}
                    />{" "}
                    Pin coordinates
                  </label>
                  {pinNames ? (
                    <ul>
                      {previewDefinition.symbol.pins.map((pin) => (
                        <li key={pin.name}>
                          <code>{pin.name}</code> ({pin.at.x}, {pin.at.y}) ·{" "}
                          {pin.direction}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p>Fix the code to update the preview.</p>
              )}
            </section>
            <section className="component-definition-code">
              <Suspense fallback={<p>Loading code editor…</p>}>
                <ProjectTextEditor
                  ariaLabel="Component definition code"
                  language="json"
                  value={source}
                  invalid={!!parsed.error}
                  onChange={setSource}
                  onModEnter={() => applyLocal()}
                />
              </Suspense>
            </section>
          </DefinitionWorkspace>
          {parsed.error ? <p role="alert">{parsed.error}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
          <footer className="component-definition-actions">
            <button
              type="button"
              onClick={() => applyLocal()}
              disabled={!parsed.definition || busy}
            >
              Apply
            </button>
            <button
              type="button"
              onClick={placeLocal}
              disabled={!parsed.definition || busy}
            >
              Place
            </button>
            {publishAction}
            <details>
              <summary>More</summary>
              <button type="button" onClick={saveLocalDraft} disabled={busy}>
                Save draft
              </button>
            </details>
          </footer>
        </>
      ) : null}
      {native && notice ? <p role="status">{notice}</p> : null}
      {!import.meta.env?.ICM_DESKTOP &&
      props.mode === "instance" &&
      !props.definition.libraryOrigin ? (
        <div
          className="component-publication-destination"
          role="group"
          aria-label="Publication association"
        >
          <details>
            <summary>Associate existing publication</summary>
            <label>
              Existing component ID{" "}
              <input
                value={linkId}
                onChange={(event) => setLinkId(event.currentTarget.value)}
              />
              <button
                type="button"
                disabled={busy || !linkId}
                onClick={() => void associateExisting(linkId)}
              >
                Associate existing
              </button>
            </label>
          </details>
        </div>
      ) : null}
      {!import.meta.env?.ICM_DESKTOP && duplicate ? (
        <div
          className="component-definition-actions"
          role="group"
          aria-label="Existing publication"
        >
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void associateExisting(duplicate.id, duplicate.revision)
            }
          >
            Use existing
          </button>
          <button
            type="button"
            onClick={() => {
              setDuplicate(null);
              setNotice(null);
            }}
          >
            Continue editing
          </button>
        </div>
      ) : null}
      {publicationConflict ||
      (record &&
        publication.kind === "update" &&
        authReady &&
        user &&
        !canUpdate) ? (
        <div
          className="component-definition-actions"
          role="group"
          aria-label="Publication recovery"
        >
          <span className="component-definition-note">
            {import.meta.env?.ICM_DESKTOP
              ? "The local component changed. Reload its saved version or create a separate copy."
              : "Publication needs review. Reload the published version or create a separate copy."}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPublication({ kind: "new", componentId: crypto.randomUUID() });
              setPublicationConflict(false);
              setNotice(
                import.meta.env?.ICM_DESKTOP
                  ? "Saving will create a separate local component."
                  : "Publishing will create a separate component.",
              );
            }}
          >
            Create separate copy
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              requestLeave(() => {
                setBusy(true);
                void readLibraryComponent(id)
                  .then((entry) => {
                    const error = latest.current.onReloadLibrary(entry);
                    if (error) throw Error(error);
                  })
                  .catch((error) => {
                    setNotice(definitionError(error));
                    setBusy(false);
                  });
              })
            }
          >
            {import.meta.env?.ICM_DESKTOP
              ? "Reload local version"
              : "Reload published version"}
          </button>
        </div>
      ) : null}
      {user?.isAdmin && record && publication.kind === "update" ? (
        <footer className="component-definition-actions">
          <span>
            {record.author} · Revision {record.revision} · {record.status}
          </span>
          {record.status !== "official" && record.status !== "deleted" ? (
            <button
              type="button"
              disabled={busy || dirty}
              onClick={() => void manage("official")}
            >
              Promote to official
            </button>
          ) : null}
          {record.status !== "shared" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void manage("shared")}
            >
              {record.status === "deleted"
                ? "Restore"
                : "Return to User Defined"}
            </button>
          ) : null}
          {record.status !== "deleted" ? (
            <InlineConfirm disabled={busy} onConfirm={() => manage("deleted")}>
              Delete component
            </InlineConfirm>
          ) : null}
        </footer>
      ) : null}
    </dialog>
  );
}
