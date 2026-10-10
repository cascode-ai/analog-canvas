import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import {
  createId,
  ComponentDefinitionSchema,
  CellSymbolPresentationSchema,
  projectCircuitSymbol,
  type CircuitProject,
  type ExternalSubcircuitDefinition,
  type ProjectModelSource,
  type ComponentDefinition,
} from "@icm/model";
import {
  createProjectSymbolResolver,
  externalSubcircuitSymbolId,
} from "@icm/symbols";
import {
  inspectProjectModelSource,
  inspectProjectModelProcess,
  renderProjectModelSource,
  transformProjectModelSource,
  type SimulationSourceDiagnostic,
} from "@icm/netlist";
import {
  NETLIST_PROFILE_IDS,
  NETLIST_PROFILE_LABELS,
  type NetlistProfileId,
} from "../netlist-export/netlist-process-presets";
import {
  NetlistCodeSelect,
  NetlistCopyButton,
  netlistFormatOptions,
} from "../netlist-export/netlist-code-controls";
import { browserExportDelivery } from "../../hosts/browser-export-delivery";
import {
  modelSourceInterface,
  resolveCircuitAuthoring,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import ProjectTextEditor from "../project-code/project-text-editor";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import { definitionError } from "../user-components/component-definition-error";
import { CircuitInterfaceEditor } from "../user-components/circuit-interface-editor";
import { newComponentDefinition } from "../user-components/component-definition-edit";
import type { ExternalDefinitionResult } from "./project-structure-commands";
import { CellSymbolLayoutProperties } from "../properties/component-structure-properties";
import type { SimulationSourceLocation } from "@icm/simulation-service/contract";

export type ApplyModelSourceEdit = Extract<
  ProjectStructureEdit,
  { kind: "apply_model_source" }
>;

function modelStarter(language: ProjectModelSource["language"] = "spice") {
  return [
    {
      path: language === "spice" ? "model.spice" : "model.scs",
      text:
        language === "spice"
          ? "* Pins and parameters are optional; add a body and finish with .ends my_cell.\n* .subckt my_cell PIN1 PIN2 params: PARAM1=1\n"
          : "// Pins and parameters are optional; add a body and finish with ends my_cell.\n// subckt my_cell (PIN1 PIN2)\n// parameters PARAM1=1\n",
    },
  ];
}

export function ExternalModelSourceEditor({
  project,
  definition: initialDefinition,
  initialLocation,
  customSymbols = false,
  canPlace = true,
  initialSymbolId,
  allowOwnerChange = false,
  onApply,
  onSaveDraft,
  onPlaceholder,
  onDelete,
  onMetadata,
  onPlace,
  onDirtyChange,
  onRequestLeave,
  onCopyText = browserExportDelivery.copyText,
  onAppliedViewChange,
  publicationAction,
  legacyDefinition,
}: {
  project: CircuitProject;
  publicationAction?: ReactNode;
  legacyDefinition?: ComponentDefinition | undefined;
  definition: ExternalSubcircuitDefinition | undefined;
  initialLocation?: SimulationSourceLocation | undefined;
  customSymbols?: boolean;
  canPlace?: boolean;
  initialSymbolId?: string | undefined;
  allowOwnerChange?: boolean;
  onApply(edit: ApplyModelSourceEdit): ExternalDefinitionResult;
  onSaveDraft(
    edits: ProjectStructureEdit[],
    definitionId: string,
  ): ExternalDefinitionResult;
  onPlaceholder?: () => void;
  onPlace(definitionId: string): void;
  onDirtyChange(dirty: boolean): void;
  onRequestLeave(action: () => void): void;
  onCopyText?: ((text: string) => Promise<void>) | undefined;
  onAppliedViewChange?: ((viewingApplied: boolean) => void) | undefined;
  onDelete(): ExternalDefinitionResult;
  onMetadata(
    definition: ExternalSubcircuitDefinition,
  ): ExternalDefinitionResult;
}) {
  const [forking, setForking] = useState(false);
  const [changingOwner, setChangingOwner] = useState(false);
  const definition = forking || changingOwner ? undefined : initialDefinition;
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
  useEffect(() => {
    onAppliedViewChange?.(viewingApplied);
  }, [viewingApplied, onAppliedViewChange]);
  const [definitionId, setDefinitionId] = useState(
    () => definition?.id ?? createId("external-subcircuit"),
  );
  const savedAuthoring = !revealApplied
    ? existing?.draft?.authoring?.find(
        (candidate) => candidate.definitionId === definitionId,
      )
    : undefined;
  const useAppliedBytes =
    revealApplied || !!savedAuthoring?.legacyRepair?.useAppliedSource;
  const [view, setView] = useState<"circuit" | "symbol">("circuit");
  const [baseRevision, setBaseRevision] = useState(
    (useAppliedBytes ? existing?.revision : existing?.draft?.baseRevision) ??
      existing?.revision ??
      0,
  );
  const [language, setLanguage] = useState<ProjectModelSource["language"]>(
    (useAppliedBytes ? existing?.language : existing?.draft?.language) ??
      existing?.language ??
      "spice",
  );
  const [files, setFiles] = useState(() =>
    structuredClone(
      (useAppliedBytes ? existing?.files : existing?.draft?.files) ??
        existing?.files ??
        modelStarter(),
    ),
  );
  const [entryPath, setEntryPath] = useState(
    (useAppliedBytes ? existing?.entry : existing?.draft?.entry) ??
      existing?.entry ??
      "model.spice",
  );
  const [filePath, setFilePath] = useState(
    useAppliedBytes ? (initialLocation?.path ?? entryPath) : entryPath,
  );
  const [newFile, setNewFile] = useState("");
  const [fileSettingsOpen, setFileSettingsOpen] = useState(false);
  const [dependencies, setDependencies] = useState(() =>
    structuredClone(
      (useAppliedBytes
        ? existing?.dependencies
        : existing?.draft?.dependencies) ??
        existing?.dependencies ??
        [],
    ),
  );
  const [entry, setEntry] = useState(
    savedAuthoring?.entry ?? (binding?.kind === "source" ? binding.entry : ""),
  );
  const [portMaps, setPortMaps] = useState<
    Record<string, Record<string, string | null>>
  >(savedAuthoring?.portMaps ?? {});
  const [result, setResult] = useState<ExternalDefinitionResult | null>(null);
  const [symbolMode, setSymbolMode] = useState<"automatic" | "custom">(
    savedAuthoring?.symbolMode ??
      ((
        initialSymbolId
          ? project.componentDefinitions?.some(
              (d) => d.symbol.id === initialSymbolId && d.circuitBinding,
            )
          : definition?.symbolId
      )
        ? "custom"
        : "automatic"),
  );
  const [automaticSymbolId] = useState(() => createId("circuit-symbol"));
  const [artworkText, setArtworkText] = useState(() => {
    if (savedAuthoring) return savedAuthoring.artworkText;
    const captured = project.componentDefinitions?.find(
      (d) =>
        d.symbol.id === (initialSymbolId ?? definition?.symbolId) &&
        d.circuitBinding,
    );
    return captured ? JSON.stringify(captured, null, 2) : "";
  });
  const [artworkOrigin, setArtworkOrigin] = useState(
    savedAuthoring?.artworkOrigin,
  );
  const [terminalDirections, setTerminalDirections] = useState(
    savedAuthoring?.terminalDirections ?? {},
  );
  const [presentation, setPresentation] = useState(
    savedAuthoring?.presentation ?? definition?.presentation,
  );
  const [conversionDiagnostic, setConversionDiagnostic] =
    useState<SimulationSourceDiagnostic | null>(null);
  const workbench = useRef<HTMLElement>(null);
  const currentDraft = {
    language,
    entryPath,
    files,
    dependencies,
    entry,
    portMaps,
    symbolMode,
    artworkText,
    artworkOrigin,
    terminalDirections,
    presentation,
  };
  const serializeDraft = (overrides: Partial<typeof currentDraft> = {}) =>
    JSON.stringify({ ...currentDraft, ...overrides });
  const snapshot = serializeDraft();
  // One history entry restores every owned file and its syntax together.
  // The text editor's per-file history cannot represent an owner conversion.
  const draftHistory = useRef<{
    past: (typeof currentDraft)[];
    future: (typeof currentDraft)[];
  }>({ past: [], future: [] });
  useEffect(() => {
    draftHistory.current = { past: [], future: [] };
  }, [sourceId, viewingApplied]);
  const restoreDraft = (draft: typeof currentDraft) => {
    setLanguage(draft.language);
    setFiles(draft.files);
    setEntryPath(draft.entryPath);
    setDependencies(draft.dependencies);
    setEntry(draft.entry);
    setPortMaps(draft.portMaps);
    setSymbolMode(draft.symbolMode);
    setArtworkText(draft.artworkText);
    setArtworkOrigin(draft.artworkOrigin);
    setTerminalDirections(draft.terminalDirections);
    setPresentation(draft.presentation);
    if (!draft.files.some((f) => f.path === filePath))
      setFilePath(draft.entryPath);
    setConversionDiagnostic(null);
    setResult(null);
  };
  const editDraft = (overrides: Partial<typeof currentDraft>) => {
    const next = { ...currentDraft, ...overrides };
    if (JSON.stringify(next) === snapshot) return;
    draftHistory.current.past.push(structuredClone(currentDraft));
    if (draftHistory.current.past.length > 100)
      draftHistory.current.past.shift();
    draftHistory.current.future = [];
    restoreDraft(next);
  };
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = !viewingApplied && savedSnapshot !== snapshot;
  const stale = Boolean(existing && baseRevision !== existing.revision);
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  const source: ProjectModelSource = useMemo(
    () => ({
      id: sourceId,
      language,
      entry: entryPath,
      files,
      dependencies,
      revision: baseRevision,
    }),
    [sourceId, language, entryPath, files, dependencies, baseRevision],
  );
  const inspection = useMemo(() => inspectProjectModelSource(source), [source]);
  const modelProcess = useMemo(
    () => inspectProjectModelProcess(source),
    [source],
  );
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
  const selectedDefinition =
    definition ??
    (!forking
      ? shared.find(
          (d) =>
            d.implementation?.kind === "source" &&
            d.implementation.entry === selected?.name,
        )
      : undefined);
  const selectedDefinitionId = selectedDefinition?.id ?? definitionId;
  const targets = [
    ...shared.filter((d) => d.id !== selectedDefinitionId),
    ...(selectedDefinition ? [selectedDefinition] : []),
  ];
  const derivedInterface = selected
    ? modelSourceInterface(
        selectedDefinitionId,
        sourceId,
        selected,
        selectedDefinition,
        portMaps[selectedDefinitionId],
      )
    : undefined;
  const previewTerminals = derivedInterface?.terminals.map((terminal) => ({
    ...terminal,
    direction: terminalDirections[terminal.id] ?? terminal.direction,
  }));
  const previewDefinition: ExternalSubcircuitDefinition | undefined =
    derivedInterface
      ? {
          ...derivedInterface,
          terminals: previewTerminals!,
          ...(presentation
            ? {
                presentation: {
                  ...presentation,
                  pinPlacements: presentation.pinPlacements?.filter((p) =>
                    previewTerminals?.some((t) => t.id === p.terminalId),
                  ),
                },
              }
            : {}),
        }
      : undefined;
  const preview = previewDefinition
    ? createProjectSymbolResolver(
        {
          ...project,
          componentDefinitions: [],
          externalSubcircuitDefinitions: [previewDefinition],
        },
        [],
      ).resolve(externalSubcircuitSymbolId(selectedDefinitionId))?.definition
    : undefined;
  const artwork = useMemo(() => {
    if (symbolMode !== "custom") return { definition: null, error: null };
    try {
      const parsed = ComponentDefinitionSchema.parse(JSON.parse(artworkText));
      if (!previewDefinition)
        return {
          definition: parsed,
          error: "Define a native entry in Circuit before Apply.",
        };
      const resolved = resolveCircuitAuthoring(
        previewDefinition,
        {
          symbolMode: "custom",
          artworkText,
          ...(artworkOrigin ? { artworkOrigin } : {}),
        },
        project.componentDefinitions,
      );
      const component = resolved.symbol;
      const issue = resolved.issue;
      return {
        definition: component,
        error: issue ? `${issue.path.join(".")}: ${issue.message}` : null,
      };
    } catch (error) {
      return {
        definition: null,
        error: definitionError(error),
      };
    }
  }, [symbolMode, artworkText, previewDefinition, artworkOrigin]);
  const lastValidArtwork = useRef<ComponentDefinition | null>(
    artwork.definition ?? savedAuthoring?.lastValidArtwork ?? null,
  );
  if (artwork.definition) lastValidArtwork.current = artwork.definition;
  const automaticComponent: ComponentDefinition | null =
    preview && previewDefinition
      ? ComponentDefinitionSchema.parse({
          symbol: {
            ...preview,
            id: automaticSymbolId,
            pins: preview.pins.map((pin) => {
              const {
                nameContent: _nameContent,
                displayName: _displayName,
                ...presentation
              } = pin.presentation;
              return { ...pin, presentation };
            }),
          },
          circuitBinding: {
            definitionId: previewDefinition.id,
            terminals: previewDefinition.terminals.map((t) => ({
              terminalId: t.id,
              pinName: t.name,
            })),
          },
        })
      : null;
  const layoutDefinition = customSymbols ? previewDefinition : definition;
  const updateLayout = (next: ExternalSubcircuitDefinition) => {
    if (viewingApplied) return;
    if (customSymbols) {
      const checked = CellSymbolPresentationSchema.optional().safeParse(
        next.presentation,
      );
      if (!checked.success) {
        setResult({
          ok: false,
          message: "Use valid finite symbol dimensions and pin offsets.",
        });
        return;
      }
      editDraft({
        presentation: next.presentation,
        terminalDirections: Object.fromEntries(
          next.terminals.map((t) => [t.id, t.direction]),
        ),
      });
    } else setResult(onMetadata(next));
  };
  const apply = (place = false) => {
    if (viewingApplied) return;
    if (failure || !selected || (customSymbols && artwork.error)) {
      setResult({
        ok: false,
        message:
          artwork.error ??
          failure?.message ??
          "Add a .subckt definition and select its entry.",
      });
      return;
    }
    const definitions = [
      {
        definitionId: selectedDefinitionId,
        entry: selected.name,
        ...(customSymbols
          ? {
              authoring: {
                symbolMode,
                ...(symbolMode === "custom"
                  ? { artworkText, ...(artworkOrigin ? { artworkOrigin } : {}) }
                  : {}),
                terminalDirections: Object.fromEntries(
                  (previewDefinition?.terminals ?? []).map((terminal) => [
                    terminal.name,
                    terminal.direction,
                  ]),
                ),
              },
              ...(presentation ? { presentation } : {}),
            }
          : {}),
        ...(portMaps[selectedDefinitionId]
          ? { portMap: portMaps[selectedDefinitionId] }
          : {}),
      },
      ...shared
        .filter((d) => d.id !== selectedDefinitionId)
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
      authoringDefinitionIds: [selectedDefinitionId],
    });
    setResult(outcome);
    if (outcome.ok) {
      setDefinitionId(selectedDefinitionId);
      setSavedSnapshot(serializeDraft({ portMaps: {} }));
      setBaseRevision(outcome.sourceRevision ?? baseRevision + 1);
      setPortMaps({});
      if (place) onPlace(selectedDefinitionId);
    }
  };
  const copyModel = async () => {
    if (
      !existing ||
      dirty ||
      (existing.draft && !viewingApplied) ||
      baseRevision !== existing.revision
    )
      return;
    try {
      await onCopyText(renderProjectModelSource(existing).text);
      setResult({ ok: true, message: "Copied model netlist." });
    } catch {
      setResult({ ok: false, message: "Could not copy model netlist." });
    }
  };
  const changeFormat = (value: string) => {
    const target = value as ProjectModelSource["language"];
    if (
      !existing &&
      JSON.stringify(files) === JSON.stringify(modelStarter(language))
    ) {
      const starter = modelStarter(target);
      editDraft({
        language: target,
        files: starter,
        entryPath: starter[0]!.path,
      });
      setFilePath(starter[0]!.path);
      setResult(null);
      return;
    }
    const converted = transformProjectModelSource(source, { language: target });
    if (!converted.ok) {
      setConversionDiagnostic(converted.diagnostic);
      setResult({ ok: false, message: "Could not convert format." });
      return;
    }
    editDraft({
      files: converted.source.files,
      language: converted.source.language,
    });
    setConversionDiagnostic(null);
    setResult(null);
  };
  const changeProcess = (value: string) => {
    const converted = transformProjectModelSource(source, {
      process: value as NetlistProfileId,
    });
    if (!converted.ok) {
      setConversionDiagnostic(converted.diagnostic);
      setResult({
        ok: false,
        message:
          converted.diagnostic.code === "MODEL_SOURCE_PROCESS_UNSUPPORTED"
            ? converted.diagnostic.message
            : "Could not replace process.",
      });
      return;
    }
    editDraft({ files: converted.source.files });
    setConversionDiagnostic(null);
    setResult(null);
  };
  const saveDraft = () => {
    if (viewingApplied) return;
    const edits: ProjectStructureEdit[] = [];
    if (!existing) {
      edits.push({
        kind: "upsert_model_source",
        source: {
          id: sourceId,
          language,
          entry: entryPath,
          files: [{ path: entryPath, text: "" }],
          dependencies: [],
          revision: 0,
        },
      });
    }
    if (!existing || !selectedDefinition) {
      edits.push({
        kind: "upsert_external_subcircuit_definition",
        definition: {
          ...definition,
          id: selectedDefinitionId,
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
      language,
      entry: entryPath,
      files,
      dependencies,
      authoring: [
        ...(existing?.draft?.authoring ?? []).filter(
          (candidate) => candidate.definitionId !== selectedDefinitionId,
        ),
        {
          definitionId: selectedDefinitionId,
          entry: selected?.name ?? entry,
          symbolMode,
          artworkText,
          portMaps,
          terminalDirections,
          ...(lastValidArtwork.current
            ? { lastValidArtwork: lastValidArtwork.current }
            : {}),
          ...(artworkOrigin ? { artworkOrigin } : {}),
          ...(presentation ? { presentation } : {}),
        },
      ],
    });
    const outcome = onSaveDraft(edits, selectedDefinitionId);
    setResult(outcome);
    if (outcome.ok) {
      setDefinitionId(selectedDefinitionId);
      setSavedSnapshot(snapshot);
    }
  };
  const chooseOwner = (id: string) => {
    setViewingApplied(false);
    const owner = project.modelSources?.find((s) => s.id === id);
    setChangingOwner(true);
    const saved = customSymbols && !allowOwnerChange ? owner?.draft : undefined;
    const candidate = saved?.authoring?.[0];
    lastValidArtwork.current = candidate?.lastValidArtwork ?? null;
    // Selecting a source in Cell Manager creates another entry definition.
    // Native component authoring can instead select an existing entry owner.
    const knownOwner = customSymbols
      ? candidate
        ? project.externalSubcircuitDefinitions.find(
            (d) => d.id === candidate.definitionId,
          )
        : project.externalSubcircuitDefinitions.find(
            (d) => d.implementation?.sourceId === id,
          )
      : undefined;
    setDefinitionId(candidate?.definitionId ?? createId("external-subcircuit"));
    setSourceId(owner?.id ?? createId("model-source"));
    const next = {
      language: saved?.language ?? owner?.language ?? ("spice" as const),
      files: structuredClone(saved?.files ?? owner?.files ?? modelStarter()),
      dependencies: structuredClone(
        saved?.dependencies ?? owner?.dependencies ?? [],
      ),
      entryPath: saved?.entry ?? owner?.entry ?? "model.spice",
      entry:
        candidate?.entry ??
        (knownOwner?.implementation?.kind === "source"
          ? knownOwner.implementation.entry
          : ""),
      portMaps: candidate?.portMaps ?? {},
      terminalDirections: candidate?.terminalDirections ?? {},
      presentation: candidate?.presentation ?? knownOwner?.presentation,
      symbolMode: candidate?.symbolMode ?? symbolMode,
      artworkText: candidate?.artworkText ?? artworkText,
      artworkOrigin: candidate?.artworkOrigin,
    };
    let currentArtwork = artwork.definition;
    if (!currentArtwork && symbolMode === "custom") {
      const parsed = ComponentDefinitionSchema.safeParse(
        (() => {
          try {
            return JSON.parse(artworkText);
          } catch {
            return null;
          }
        })(),
      );
      if (parsed.success) currentArtwork = parsed.data;
    }
    if (!candidate && symbolMode === "custom" && currentArtwork && knownOwner) {
      const currentOwner = previewDefinition ?? initialDefinition;
      const mappings =
        currentArtwork.circuitBinding?.terminals.flatMap((mapping) => {
          const name = currentOwner?.terminals.find(
            (t) => t.id === mapping.terminalId,
          )?.name;
          const terminal = knownOwner.terminals.find((t) => t.name === name);
          return terminal ? [{ ...mapping, terminalId: terminal.id }] : [];
        }) ?? [];
      next.artworkText = JSON.stringify(
        {
          ...currentArtwork,
          circuitBinding: { definitionId: knownOwner.id, terminals: mappings },
        },
        null,
        2,
      );
    }
    setBaseRevision(saved?.baseRevision ?? owner?.revision ?? 0);
    restoreDraft(next);
    setFilePath(next.entryPath);
    setResult(null);
    setSavedSnapshot(serializeDraft(next));
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
      ref={workbench}
      className="external-model-workbench"
      aria-label="External model source"
      onKeyDownCapture={(event) => {
        if (
          customSymbols &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!viewingApplied) saveDraft();
          return;
        }
        if (viewingApplied || !(event.ctrlKey || event.metaKey) || event.altKey)
          return;
        if (
          !(event.target instanceof HTMLElement) ||
          !event.target.closest(
            ".project-source-editor, .netlist-code-controls",
          )
        )
          return;
        const key = event.key.toLowerCase();
        const redo = (key === "z" && event.shiftKey) || key === "y";
        if (key !== "z" && key !== "y") return;
        event.preventDefault();
        event.stopPropagation();
        const from = redo
          ? draftHistory.current.future
          : draftHistory.current.past;
        const to = redo
          ? draftHistory.current.past
          : draftHistory.current.future;
        const previous = from.pop();
        if (!previous) return;
        to.push(structuredClone(currentDraft));
        restoreDraft(previous);
      }}
    >
      {customSymbols ? (
        <nav
          className="component-authoring-tabs"
          role="tablist"
          aria-label="Component views"
        >
          {(["circuit", "symbol"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view === tab}
              onClick={() => setView(tab)}
            >
              {tab[0]!.toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      ) : null}
      <div
        className="external-model-source-view"
        hidden={customSymbols && view !== "circuit"}
      >
        <div className="netlist-code-controls">
          <div className="netlist-code-selects">
            <NetlistCodeSelect
              label="Format"
              ariaLabel="Model format"
              value={language}
              options={netlistFormatOptions}
              disabled={viewingApplied}
              onChange={changeFormat}
            />
            <NetlistCodeSelect
              label="Process"
              ariaLabel="Model process"
              value={modelProcess}
              options={NETLIST_PROFILE_IDS.map((value) => ({
                value,
                label: NETLIST_PROFILE_LABELS[value],
              }))}
              disabled={viewingApplied}
              onChange={changeProcess}
            />
          </div>
          <div className="netlist-code-actions">
            <NetlistCopyButton
              label="Copy model netlist"
              disabled={
                !existing ||
                dirty ||
                Boolean(existing.draft && !viewingApplied) ||
                baseRevision !== existing?.revision ||
                binding?.kind !== "source"
              }
              onCopy={() => void copyModel()}
            />
          </div>
        </div>
        {(result || failure || stale || artwork.error) &&
        (!customSymbols || view === "circuit") ? (
          <p className="cell-external-result" role="status">
            {stale
              ? "The applied model changed; keep this draft on the latest version before Apply."
              : (result?.message ??
                artwork.error ??
                "Correct the model source before Apply.")}
            {stale ? (
              <button
                type="button"
                onClick={() => {
                  setBaseRevision(existing!.revision);
                  setResult(null);
                }}
              >
                Keep my draft on the latest version
              </button>
            ) : conversionDiagnostic || failure ? (
              <button
                type="button"
                title={`${(conversionDiagnostic ?? failure)!.path}:${(conversionDiagnostic ?? failure)!.sourceRef?.start.line ?? 1}: ${(conversionDiagnostic ?? failure)!.message}`}
                onClick={() => {
                  const diagnostic = conversionDiagnostic ?? failure!;
                  if (
                    diagnostic.path &&
                    files.some((f) => f.path === diagnostic.path)
                  )
                    setFilePath(diagnostic.path);
                  requestAnimationFrame(() =>
                    workbench.current
                      ?.querySelector<HTMLElement>(
                        '[aria-label="External model netlist"]',
                      )
                      ?.focus(),
                  );
                }}
              >
                Edit model
              </button>
            ) : null}
          </p>
        ) : null}
        {(!definition || allowOwnerChange) &&
        !forking &&
        project.modelSources?.length ? (
          <label>
            <span>Source owner</span>
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
                .filter((s) => s.revision > 0 || s.draft)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.entry}
                    {s.draft ? " (draft)" : ""}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        {binding?.kind !== "source" || existing?.draft || dirty ? (
          <p className="external-model-state">
            {[
              binding?.kind !== "source" ? "Unimplemented" : null,
              existing?.draft ? "Saved draft" : null,
              dirty ? "Unsaved changes" : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {customSymbols &&
        existing?.draft &&
        !viewingApplied &&
        binding?.kind === "source" ? (
          <button
            type="button"
            onClick={() =>
              onRequestLeave(() => {
                const captured = project.componentDefinitions?.find(
                  (component) =>
                    component.symbol.id ===
                    (initialSymbolId ?? definition?.symbolId),
                );
                const applied = {
                  language: existing.language,
                  files: structuredClone(existing.files),
                  entryPath: existing.entry,
                  dependencies: structuredClone(existing.dependencies),
                  entry: binding.entry,
                  portMaps: {},
                  symbolMode: captured
                    ? ("custom" as const)
                    : ("automatic" as const),
                  artworkText: captured
                    ? JSON.stringify(captured, null, 2)
                    : "",
                  artworkOrigin: undefined,
                  terminalDirections: {},
                  presentation: definition?.presentation,
                };
                restoreDraft(applied);
                setBaseRevision(existing.revision);
                setFilePath(existing.entry);
                setSavedSnapshot(serializeDraft(applied));
                setViewingApplied(true);
              })
            }
          >
            View applied version
          </button>
        ) : null}
        {shared.length > 1 ? (
          <details className="external-model-section">
            <summary>Shared by {shared.length} definitions</summary>
            <div className="external-model-section-body">
              {shared.map((d) => d.name).join(", ")}
            </div>
          </details>
        ) : null}
        {viewingApplied && existing?.draft ? (
          <p className="cell-external-result" role="status">
            Showing the applied error snapshot. Your saved draft is retained.{" "}
            <button
              type="button"
              onClick={() => {
                const draft = existing.draft!;
                const candidate = draft.authoring?.find(
                  (item) => item.definitionId === selectedDefinitionId,
                );
                const next = {
                  language: draft.language ?? existing.language,
                  entryPath: draft.entry,
                  files: structuredClone(draft.files),
                  dependencies: structuredClone(
                    draft.dependencies ?? existing.dependencies,
                  ),
                  entry: candidate?.entry ?? entry,
                  portMaps: candidate?.portMaps ?? {},
                  symbolMode: candidate?.symbolMode ?? symbolMode,
                  artworkText: candidate?.artworkText ?? artworkText,
                  artworkOrigin: candidate?.artworkOrigin,
                  terminalDirections: candidate?.terminalDirections ?? {},
                  presentation:
                    candidate?.presentation ?? definition?.presentation,
                };
                setViewingApplied(false);
                restoreDraft(next);
                setBaseRevision(draft.baseRevision);
                setFiles(structuredClone(draft.files));
                setDependencies(
                  structuredClone(draft.dependencies ?? existing.dependencies),
                );
                setEntryPath(draft.entry);
                setFilePath(draft.entry);
                setSavedSnapshot(serializeDraft(next));
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
        ) : null}
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
          onChange={(text) => {
            editDraft({
              files: files.map((f) =>
                f.path === filePath ? { ...f, text } : f,
              ),
            });
            setResult(null);
            setConversionDiagnostic(null);
          }}
          onModEnter={() => apply()}
          invalid={Boolean(failure && files.some((f) => f.text.trim()))}
        />
        {inspection.entries.length > 1 ? (
          <label>
            <span>Entry subcircuit</span>
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
              <span className="external-model-ports">
                {selected.ports.join(" · ") || "No terminals"}
              </span>
              {selected.parameters.length ? (
                <span className="cell-count-badge">
                  {selected.parameters.length} params
                </span>
              ) : null}
            </>
          ) : (
            <span>No subcircuit yet</span>
          )}
        </div>
        {customSymbols && previewDefinition ? (
          <CircuitInterfaceEditor
            owner={previewDefinition}
            component={
              symbolMode === "custom" ? artwork.definition : automaticComponent
            }
            automatic={symbolMode === "automatic"}
            readOnly={viewingApplied}
            onDirection={(id, direction) =>
              editDraft({
                terminalDirections: { ...terminalDirections, [id]: direction },
              })
            }
            onChange={(component) =>
              editDraft({ artworkText: JSON.stringify(component, null, 2) })
            }
            onCustomize={() => {
              editDraft({
                symbolMode: "custom",
                artworkText: JSON.stringify(automaticComponent, null, 2),
              });
              setView("symbol");
            }}
          />
        ) : null}
        {targets.flatMap((target) => {
          const next =
            target.id === selectedDefinitionId
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
                    <span>
                      Migrate {target.name}.{terminal.name}
                    </span>
                    <select
                      aria-label={
                        "Migrate " + target.name + "." + terminal.name
                      }
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
        {fileSettingsOpen ? (
          <details
            open
            className="external-model-section"
            onToggle={(event) => setFileSettingsOpen(event.currentTarget.open)}
          >
            <summary>Files and dependencies</summary>
            <div className="external-model-section-body">
              <label>
                <span>Entry file</span>
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
                <span>New relative file</span>
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
                      <span>{field}</span>
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
                      setDependencies(
                        dependencies.filter((_, i) => i !== index),
                      )
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
            </div>
          </details>
        ) : null}
      </div>
      {customSymbols ? (
        <section
          className="circuit-symbol-authoring"
          aria-label="Circuit symbol"
          hidden={view !== "symbol"}
        >
          <label>
            Symbol mode{" "}
            <select
              aria-label="Symbol mode"
              disabled={viewingApplied}
              value={symbolMode}
              onChange={(event) => {
                const next = event.currentTarget.value as typeof symbolMode;
                const text =
                  artworkText ||
                  JSON.stringify(
                    automaticComponent ?? {
                      symbol: {
                        ...newComponentDefinition().symbol,
                        id: automaticSymbolId,
                      },
                    },
                    null,
                    2,
                  );
                const change = () =>
                  editDraft({
                    symbolMode: next,
                    artworkText: next === "automatic" ? "" : text,
                    artworkOrigin:
                      next === "automatic" ? undefined : artworkOrigin,
                  });
                if (next === "automatic" && symbolMode === "custom")
                  onRequestLeave(change);
                else change();
              }}
            >
              <option value="automatic">Automatic</option>
              <option value="custom">Custom JSON</option>
            </select>
          </label>
          {symbolMode === "custom" ? (
            <>
              <div className="component-definition-workspace">
                <section className="component-definition-code">
                  <ProjectTextEditor
                    ariaLabel="Circuit symbol JSON"
                    language="json"
                    value={artworkText}
                    readOnly={viewingApplied}
                    invalid={!!artwork.error}
                    onChange={(text) => editDraft({ artworkText: text })}
                    onModEnter={() => apply()}
                  />
                </section>
                <section
                  className="component-definition-preview"
                  aria-label="Custom symbol preview"
                >
                  {(artwork.definition ?? lastValidArtwork.current) ? (
                    <>
                      {!artwork.definition ? (
                        <p role="status">Showing the last valid preview.</p>
                      ) : null}
                      <SymbolArtwork
                        symbol={
                          artwork.error || !artwork.definition
                            ? (artwork.definition ?? lastValidArtwork.current)!
                                .symbol
                            : previewDefinition
                              ? projectCircuitSymbol(
                                  artwork.definition,
                                  previewDefinition,
                                )
                              : artwork.definition.symbol
                        }
                        className="component-definition-artwork"
                      />
                    </>
                  ) : (
                    <p>Correct the JSON to preview.</p>
                  )}
                </section>
              </div>
              {artwork.error ? <p role="status">{artwork.error}</p> : null}
            </>
          ) : null}
        </section>
      ) : null}
      {layoutDefinition && symbolMode === "automatic" ? (
        <section
          className="external-model-layout-section"
          hidden={customSymbols && view !== "symbol"}
        >
          <header>
            <h3>
              {customSymbols ? "Symbol layout" : "Symbol layout and directions"}
            </h3>
            {!customSymbols ? (
              <p>Pin directions and symbol placement for this model.</p>
            ) : null}
          </header>
          <div className="external-model-layout">
            <div className="external-model-layout-controls">
              {!customSymbols ? (
                <div className="external-model-directions">
                  {layoutDefinition.terminals.map((terminal) => (
                    <label key={terminal.id}>
                      <span>
                        <strong>{terminal.name}</strong> direction
                      </span>
                      <select
                        aria-label={"Model " + terminal.name + " direction"}
                        disabled={viewingApplied}
                        value={terminal.direction}
                        onChange={(event) =>
                          updateLayout({
                            ...layoutDefinition,
                            terminals: layoutDefinition.terminals.map((t) =>
                              t.id === terminal.id
                                ? {
                                    ...t,
                                    direction: event.currentTarget
                                      .value as typeof t.direction,
                                  }
                                : t,
                            ),
                          })
                        }
                      >
                        {["passive", "input", "output", "inout"].map(
                          (direction) => (
                            <option key={direction} value={direction}>
                              {direction === "inout"
                                ? "In/Out"
                                : direction[0]!.toUpperCase() +
                                  direction.slice(1)}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  ))}
                </div>
              ) : null}
              <CellSymbolLayoutProperties
                target={{
                  kind: "external",
                  ownerId: layoutDefinition.id,
                  id: externalSubcircuitSymbolId(layoutDefinition.id),
                  name: layoutDefinition.name,
                  revision: customSymbols
                    ? draftHistory.current.past.length
                    : project.structureRevision,
                  terminals: layoutDefinition.terminals,
                  presentation: layoutDefinition.presentation,
                }}
                enabled={false}
                readOnly={viewingApplied}
                onBodySizeChange={(width, height) =>
                  updateLayout({
                    ...layoutDefinition,
                    presentation: {
                      ...layoutDefinition.presentation,
                      minimumBodySize: { width, height },
                    },
                  })
                }
                onPortPlacementChange={(terminalId, side, offset) =>
                  updateLayout({
                    ...layoutDefinition,
                    presentation: {
                      ...layoutDefinition.presentation,
                      pinPlacements: [
                        ...(
                          layoutDefinition.presentation?.pinPlacements ?? []
                        ).filter((p) => p.terminalId !== terminalId),
                        ...(side === "auto"
                          ? []
                          : [{ terminalId, side, offset }]),
                      ],
                    },
                  })
                }
              />
            </div>
            {preview ? (
              <figure
                className="external-model-layout-preview"
                aria-label="Symbol preview"
              >
                <figcaption>Preview</figcaption>
                <div className="external-model-preview-frame">
                  <SymbolArtwork
                    symbol={preview}
                    className="external-model-symbol"
                  />
                </div>
              </figure>
            ) : null}
          </div>
        </section>
      ) : null}
      {customSymbols && previewDefinition ? (
        <p className="component-definition-note">
          {legacyDefinition?.subcircuit
            ? "Native interface: " +
              previewDefinition.terminals.length +
              " terminals; legacy interface: " +
              legacyDefinition.subcircuit.ports.length +
              " terminals. "
            : ""}
          {
            project.documents
              .flatMap((document) => document.instances)
              .filter((instance) => {
                const binding = instance.netlist?.binding;
                return (
                  binding?.kind === "external-subcircuit" &&
                  project.externalSubcircuitDefinitions.some(
                    (owner) =>
                      owner.id === binding.definitionId &&
                      owner.implementation?.sourceId === sourceId,
                  )
                );
              }).length
          }{" "}
          call(s) share this model source.
        </p>
      ) : null}
      <footer className="external-model-actionbar">
        {customSymbols && view !== "circuit" && result ? (
          <p role="status" className="cell-external-result">
            {result.message}
          </p>
        ) : null}
        {!definition && canPlace ? (
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
        {definition && canPlace ? (
          <button
            type="button"
            onClick={() =>
              dirty || existing?.draft
                ? viewingApplied
                  ? onPlace(definition.id)
                  : apply(true)
                : onPlace(definition.id)
            }
          >
            Place
          </button>
        ) : null}
        {publicationAction}
        <details className="external-model-more">
          <summary>More</summary>
          <div>
            <button
              type="button"
              onClick={(event) => {
                setFileSettingsOpen(true);
                const menu = event.currentTarget.closest("details");
                if (menu) menu.open = false;
              }}
            >
              Files and dependencies
            </button>
            <button type="button" onClick={saveDraft} disabled={viewingApplied}>
              Save draft
            </button>
            {!definition && onPlaceholder ? (
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
    </section>
  );
}
