import { useEffect, useMemo, useState } from "react";
import {
  createId,
  deriveStableId,
  type CircuitProject,
  type ExternalSubcircuitDefinition,
  type ProjectModelSource,
} from "@icm/model";
import {
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
} from "@icm/symbols";
import { inspectProjectModelSource } from "@icm/netlist";
import type { ProjectStructureEdit } from "@icm/edit-engine";
import ProjectTextEditor from "../project-code/project-text-editor";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import type { ExternalDefinitionResult } from "./project-structure-commands";
import { CellSymbolLayoutProperties } from "../properties/component-structure-properties";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";

export type ApplyModelSourceEdit = Extract<
  ProjectStructureEdit,
  { kind: "apply_model_source" }
>;

export function ExternalModelSourceEditor({
  project,
  definition: initialDefinition,
  initialLocation,
  onApply,
  onSaveDraft,
  onPlaceholder,
  onDelete,
  onMetadata,
  onPlace,
  onDirtyChange,
  onRequestLeave,
}: {
  project: CircuitProject;
  definition: ExternalSubcircuitDefinition | undefined;
  initialLocation?: SimulationSourceLocation | undefined;
  onApply(edit: ApplyModelSourceEdit): ExternalDefinitionResult;
  onSaveDraft(
    edits: ProjectStructureEdit[],
    definitionId: string,
  ): ExternalDefinitionResult;
  onPlaceholder(): void;
  onPlace(definitionId: string): void;
  onDirtyChange(dirty: boolean): void;
  onRequestLeave(action: () => void): void;
  onDelete(): ExternalDefinitionResult;
  onMetadata(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
}) {
  const [forking, setForking] = useState(false);
  const definition = forking ? undefined : initialDefinition;
  const binding = definition?.implementation;
  const [sourceId, setSourceId] = useState(
    () => binding?.sourceId ?? createId("model-source"),
  );
  const existing = project.modelSources?.find((s) => s.id === sourceId);
  const revealApplied =
    initialLocation?.sourceId === sourceId &&
    initialLocation.revision === existing?.revision;
  const [viewingApplied, setViewingApplied] = useState(
    Boolean(revealApplied && existing?.draft),
  );
  const [definitionId, setDefinitionId] = useState(
    () => definition?.id ?? createId("external-subcircuit"),
  );
  const [baseRevision, setBaseRevision] = useState(
    (revealApplied ? existing?.revision : existing?.draft?.baseRevision) ??
      existing?.revision ??
      0,
  );
  const [files, setFiles] = useState(() =>
    structuredClone(
      (revealApplied ? existing?.files : existing?.draft?.files) ??
        existing?.files ?? [{ path: "model.spice", text: "" }],
    ),
  );
  const [entryPath, setEntryPath] = useState(
    (revealApplied ? existing?.entry : existing?.draft?.entry) ??
      existing?.entry ??
      "model.spice",
  );
  const [filePath, setFilePath] = useState(
    revealApplied ? initialLocation!.path : entryPath,
  );
  const [newFile, setNewFile] = useState("");
  const [dependencies, setDependencies] = useState(() =>
    structuredClone(
      (revealApplied
        ? existing?.dependencies
        : existing?.draft?.dependencies) ??
        existing?.dependencies ??
        [],
    ),
  );
  const [entry, setEntry] = useState(
    binding?.kind === "source" ? binding.entry : "",
  );
  const [portMaps, setPortMaps] = useState<
    Record<string, Record<string, string | null>>
  >({});
  const [result, setResult] = useState<ExternalDefinitionResult | null>(null);
  const currentDraft = {
    entryPath,
    files,
    dependencies,
    entry,
    portMaps,
  };
  const serializeDraft = (overrides: Partial<typeof currentDraft> = {}) =>
    JSON.stringify({ ...currentDraft, ...overrides });
  const snapshot = serializeDraft();
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = !viewingApplied && savedSnapshot !== snapshot;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const source: ProjectModelSource = useMemo(
    () => ({
      id: sourceId,
      language: "spice",
      entry: entryPath,
      files,
      dependencies,
      revision: baseRevision,
    }),
    [sourceId, entryPath, files, dependencies, baseRevision],
  );
  const inspection = useMemo(() => inspectProjectModelSource(source), [source]);
  const selected =
    inspection.entries.length === 1
      ? inspection.entries[0]
      : inspection.entries.find((e) => e.name === entry);
  const failure = inspection.diagnostics.find((d) => d.severity === "error");
  const shared = project.externalSubcircuitDefinitions.filter(
    (d) =>
      d.implementation?.kind === "source" &&
      d.implementation.sourceId === sourceId,
  );
  const targets = [
    ...shared.filter((d) => d.id !== definitionId),
    ...(definition ? [definition] : []),
  ];
  const previewTerminals = selected?.ports.map(
    (name) =>
      definition?.terminals.find((t) => t.name === name) ?? {
        id: deriveStableId("model-preview-pin", definitionId, name),
        name,
        direction: "passive" as const,
      },
  );
  const previewDefinition: ExternalSubcircuitDefinition | undefined = selected
    ? {
        id: definitionId,
        name: selected.name,
        terminals: previewTerminals!,
        formalParameters: [],
        interfaceStatus: "declared",
        implementation: { kind: "source", sourceId, entry: selected.name },
        ...(definition?.presentation
          ? {
              presentation: {
                ...definition.presentation,
                pinPlacements: definition.presentation.pinPlacements?.filter(
                  (p) => previewTerminals?.some((t) => t.id === p.terminalId),
                ),
              },
            }
          : {}),
      }
    : undefined;
  const preview = previewDefinition
    ? createProjectSymbolResolver(
        { ...project, externalSubcircuitDefinitions: [previewDefinition] },
        [],
      ).resolve(externalSubcircuitSymbolId(definitionId))?.definition
    : undefined;
  const apply = (place = false) => {
    if (viewingApplied) return;
    if (failure || !selected) {
      setResult({
        ok: false,
        message:
          failure?.message ?? "Add a .subckt definition and select its entry.",
      });
      return;
    }
    const definitions = [
      {
        definitionId,
        entry: selected.name,
        ...(portMaps[definitionId] ? { portMap: portMaps[definitionId] } : {}),
      },
      ...shared
        .filter((d) => d.id !== definitionId)
        .map((d) => ({
          definitionId: d.id,
          entry:
            d.implementation!.kind === "source"
              ? d.implementation!.entry
              : d.name,
          ...(portMaps[d.id] ? { portMap: portMaps[d.id] } : {}),
        })),
    ];
    const outcome = onApply({
      kind: "apply_model_source",
      source,
      definitions,
    });
    setResult(outcome);
    if (outcome.ok) {
      setSavedSnapshot(serializeDraft({ portMaps: {} }));
      setBaseRevision(baseRevision + 1);
      setPortMaps({});
      if (place) onPlace(definitionId);
    }
  };
  const saveDraft = () => {
    if (viewingApplied) return;
    const edits: ProjectStructureEdit[] = [];
    if (!existing) {
      edits.push({
        kind: "upsert_model_source",
        source: {
          id: sourceId,
          language: "spice",
          entry: entryPath,
          files: [{ path: entryPath, text: "" }],
          dependencies: [],
          revision: 0,
        },
      });
    }
    if (!existing || !definition) {
      edits.push({
        kind: "upsert_external_subcircuit_definition",
        definition: {
          ...definition,
          id: definitionId,
          name:
            definition?.name ??
            selected?.name ??
            inspection.entries[0]?.name ??
            "model_" + definitionId.slice(-8),
          terminals: definition?.terminals ?? [],
          formalParameters: definition?.formalParameters ?? [],
          interfaceStatus: "declared",
          implementation: { kind: "placeholder", sourceId },
        },
      });
    }
    edits.push({
      kind: "save_model_source_draft",
      sourceId,
      expectedRevision: baseRevision,
      entry: entryPath,
      files,
      dependencies,
    });
    const outcome = onSaveDraft(edits, definitionId);
    setResult(outcome);
    if (outcome.ok) setSavedSnapshot(snapshot);
  };
  const chooseOwner = (id: string) => {
    setViewingApplied(false);
    const owner = project.modelSources?.find((s) => s.id === id);
    setSourceId(owner?.id ?? createId("model-source"));
    setBaseRevision(owner?.revision ?? 0);
    setFiles(
      structuredClone(owner?.files ?? [{ path: "model.spice", text: "" }]),
    );
    setDependencies(structuredClone(owner?.dependencies ?? []));
    setEntryPath(owner?.entry ?? "model.spice");
    setFilePath(owner?.entry ?? "model.spice");
    setEntry("");
    setPortMaps({});
    setResult(null);
    setSavedSnapshot(
      serializeDraft({
        entryPath: owner?.entry ?? "model.spice",
        files: owner?.files ?? [{ path: "model.spice", text: "" }],
        dependencies: owner?.dependencies ?? [],
        entry: "",
        portMaps: {},
      }),
    );
  };
  const fork = () => {
    setViewingApplied(false);
    setForking(true);
    setSourceId(createId("model-source"));
    setDefinitionId(createId("external-subcircuit"));
    setBaseRevision(0);
    setPortMaps({});
    setResult({
      ok: true,
      message: "Copy ready. Rename its declarations, then Apply.",
    });
  };
  return (
    <section
      className="external-model-workbench"
      aria-label="External model source"
    >
      {!definition && !forking && project.modelSources?.length ? (
        <label>
          Source owner
          <select
            aria-label="External model source owner"
            value={existing?.id ?? ""}
            onChange={(event) => {
              const id = event.currentTarget.value;
              onRequestLeave(() => chooseOwner(id));
            }}
          >
            <option value="">New model source</option>
            {project.modelSources
              .filter((s) => s.revision > 0)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.entry} · version {s.revision}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <p className="external-model-state">
        {binding?.kind === "source"
          ? "Applied version " + (existing?.revision ?? baseRevision)
          : "Unimplemented"}
        {existing?.draft ? " · Saved draft" : ""}
        {dirty ? " · Unsaved changes" : ""}
      </p>
      {shared.length > 1 ? (
        <details>
          <summary>Shared by {shared.length} definitions</summary>
          {shared.map((d) => d.name).join(", ")}
        </details>
      ) : null}
      {existing && baseRevision !== existing.revision ? (
        <p role="alert">
          Applied model changed to version {existing.revision}. Your text is
          retained. Keeping this draft as the new base lets Apply replace that
          newer model.
          <button
            type="button"
            onClick={() => {
              setBaseRevision(existing.revision);
              setResult(null);
            }}
          >
            Keep my draft on the latest version
          </button>
        </p>
      ) : null}
      {viewingApplied && existing?.draft ? (
        <p role="status">
          Showing the applied error snapshot. Your saved draft is retained.{" "}
          <button
            type="button"
            onClick={() => {
              const draft = existing.draft!;
              setViewingApplied(false);
              setBaseRevision(draft.baseRevision);
              setFiles(structuredClone(draft.files));
              setDependencies(
                structuredClone(draft.dependencies ?? existing.dependencies),
              );
              setEntryPath(draft.entry);
              setFilePath(draft.entry);
              setSavedSnapshot(
                serializeDraft({
                  entryPath: draft.entry,
                  files: draft.files,
                  dependencies: draft.dependencies ?? existing.dependencies,
                  entry,
                  portMaps: {},
                }),
              );
              setResult(null);
            }}
          >
            Open saved draft
          </button>
        </p>
      ) : null}
      {files.length > 1 ? (
        <div
          className="external-model-files"
          role="group"
          aria-label="Model files"
        >
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              aria-pressed={filePath === file.path}
              onClick={() => setFilePath(file.path)}
            >
              {file.path}
              {file.path === entryPath ? " (entry)" : ""}
            </button>
          ))}
        </div>
      ) : (
        <span className="external-model-path">{filePath}</span>
      )}
      <ProjectTextEditor
        ariaLabel="External model netlist"
        language="netlist"
        value={files.find((f) => f.path === filePath)?.text ?? ""}
        readOnly={viewingApplied}
        highlightedRanges={
          revealApplied &&
          filePath === initialLocation?.path &&
          (!existing?.draft || viewingApplied)
            ? [
                {
                  from: initialLocation.startOffset,
                  to: initialLocation.endOffset,
                },
              ]
            : []
        }
        revealHighlight={
          revealApplied
            ? `${sourceId}:${initialLocation!.revision}:${filePath}:${initialLocation!.startOffset}`
            : ""
        }
        onChange={(text) =>
          setFiles(files.map((f) => (f.path === filePath ? { ...f, text } : f)))
        }
        onModEnter={() => apply()}
        invalid={Boolean(failure && files.some((f) => f.text.trim()))}
      />
      {inspection.entries.length > 1 ? (
        <label>
          Entry subcircuit
          <select
            aria-label="External model entry"
            value={entry}
            onChange={(event) => setEntry(event.currentTarget.value)}
          >
            <option value="">Choose an entry…</option>
            {inspection.entries.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div
        aria-label="Parsed model interface"
        className="external-model-interface"
      >
        {selected ? (
          <>
            <div>
              <strong>{selected.name}</strong>
              <div>{selected.ports.join(" · ") || "No terminals"}</div>
              {selected.parameters.length ? (
                <details>
                  <summary>Parameters ({selected.parameters.length})</summary>
                  {selected.parameters
                    .map((p) => p.name + "=" + p.rawText)
                    .join(", ")}
                </details>
              ) : null}
            </div>
            {preview ? (
              <details className="external-model-artwork-preview">
                <summary>Symbol preview</summary>
                <SymbolArtwork
                  symbol={preview}
                  className="external-model-symbol"
                />
              </details>
            ) : null}
          </>
        ) : (
          <span>No .subckt yet</span>
        )}
      </div>
      {targets.flatMap((target) => {
        const next =
          target.id === definitionId
            ? selected
            : inspection.entries.find(
                (e) =>
                  target.implementation?.kind === "source" &&
                  e.name === target.implementation.entry,
              );
        return next
          ? target.terminals
              .filter((t) => !next.ports.includes(t.name))
              .map((terminal) => (
                <label key={target.id + ":" + terminal.id}>
                  Migrate {target.name}.{terminal.name}
                  <select
                    aria-label={"Migrate " + target.name + "." + terminal.name}
                    value={
                      Object.hasOwn(portMaps[target.id] ?? {}, terminal.name)
                        ? (portMaps[target.id]![terminal.name] ??
                          "__disconnect")
                        : ""
                    }
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setPortMaps({
                        ...portMaps,
                        [target.id]: {
                          ...portMaps[target.id],
                          [terminal.name]:
                            value === "__disconnect" ? null : value,
                        },
                      });
                    }}
                  >
                    <option value="">Choose a replacement…</option>
                    <option value="__disconnect">
                      Disconnect and keep wires
                    </option>
                    {next.ports
                      .filter(
                        (p) => !target.terminals.some((t) => t.name === p),
                      )
                      .map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                  </select>
                </label>
              ))
          : [];
      })}
      <details>
        <summary>Files and dependencies</summary>
        <label>
          Entry file
          <select
            aria-label="Model entry file"
            value={entryPath}
            onChange={(event) => setEntryPath(event.currentTarget.value)}
          >
            {files.map((f) => (
              <option key={f.path} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
        </label>
        <label>
          New relative file
          <input
            aria-label="New model file path"
            value={newFile}
            onChange={(event) => setNewFile(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          disabled={!newFile || files.some((f) => f.path === newFile)}
          onClick={() => {
            setFiles([...files, { path: newFile, text: "" }]);
            setFilePath(newFile);
            setNewFile("");
          }}
        >
          Add file
        </button>
        {files.length > 1 && filePath !== entryPath ? (
          <button
            type="button"
            onClick={() => {
              setFiles(files.filter((f) => f.path !== filePath));
              setFilePath(entryPath);
            }}
          >
            Remove selected file
          </button>
        ) : null}
        {dependencies.map((dependency, index) => (
          <div key={index} className="external-model-dependency">
            {(["id", "mountPath", "sha256"] as const).map((field) => (
              <label key={field}>
                {field}
                <input
                  aria-label={"Dependency " + (index + 1) + " " + field}
                  value={dependency[field]}
                  onChange={(event) =>
                    setDependencies(
                      dependencies.map((d, i) =>
                        i === index
                          ? { ...d, [field]: event.currentTarget.value }
                          : d,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() =>
                setDependencies(dependencies.filter((_, i) => i !== index))
              }
            >
              Remove dependency
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setDependencies([
              ...dependencies,
              { id: "", mountPath: "", sha256: "" },
            ])
          }
        >
          Add dependency
        </button>
      </details>
      {definition ? (
        <details>
          <summary>Symbol layout and directions</summary>
          {definition.terminals.map((terminal) => (
            <label key={terminal.id}>
              {terminal.name} direction
              <select
                aria-label={"Model " + terminal.name + " direction"}
                value={terminal.direction}
                onChange={(event) =>
                  setResult(
                    onMetadata({
                      ...definition,
                      terminals: definition.terminals.map((t) =>
                        t.id === terminal.id
                          ? {
                              ...t,
                              direction: event.currentTarget
                                .value as typeof t.direction,
                            }
                          : t,
                      ),
                    }),
                  )
                }
              >
                {["passive", "input", "output", "inout"].map((direction) => (
                  <option key={direction} value={direction}>
                    {direction}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <CellSymbolLayoutProperties
            target={{
              kind: "external",
              ownerId: definition.id,
              id: externalSubcircuitSymbolId(definition.id),
              name: definition.name,
              revision: project.structureRevision,
              terminals: definition.terminals,
              presentation: definition.presentation,
            }}
            enabled={false}
            onBodySizeChange={(width, height) =>
              setResult(
                onMetadata({
                  ...definition,
                  presentation: {
                    ...definition.presentation,
                    minimumBodySize: { width, height },
                  },
                }),
              )
            }
            onPortPlacementChange={(terminalId, side, offset) =>
              setResult(
                onMetadata({
                  ...definition,
                  presentation: {
                    ...definition.presentation,
                    pinPlacements: [
                      ...(definition.presentation?.pinPlacements ?? []).filter(
                        (p) => p.terminalId !== terminalId,
                      ),
                      ...(side === "auto"
                        ? []
                        : [{ terminalId, side, offset }]),
                    ],
                  },
                }),
              )
            }
          />
        </details>
      ) : null}
      <footer className="external-model-actionbar">
        {!definition ? (
          <button
            type="button"
            className="primary"
            onClick={() => apply(true)}
            disabled={viewingApplied}
          >
            Apply &amp; Place
          </button>
        ) : null}
        <button type="button" onClick={() => apply()} disabled={viewingApplied}>
          Apply model
        </button>
        {definition ? (
          <button
            type="button"
            onClick={() => onRequestLeave(() => onPlace(definition.id))}
          >
            Place
          </button>
        ) : null}
        <details className="external-model-more">
          <summary>More</summary>
          <div>
            <button type="button" onClick={saveDraft} disabled={viewingApplied}>
              Save draft
            </button>
            {!definition ? (
              <button
                type="button"
                onClick={() => onRequestLeave(onPlaceholder)}
              >
                Create placeholder…
              </button>
            ) : null}
            {definition ? (
              <>
                <button type="button" onClick={fork}>
                  Fork model…
                </button>
                <button type="button" onClick={() => setResult(onDelete())}>
                  Delete definition
                </button>
              </>
            ) : null}
          </div>
        </details>
      </footer>
      {result ? (
        <p role={result.ok ? "status" : "alert"}>{result.message}</p>
      ) : null}
      {failure && !result && files.some((f) => f.text.trim()) ? (
        <p role="status">
          {failure.path ? failure.path + ": " : ""}
          {failure.message}
        </p>
      ) : null}
    </section>
  );
}
