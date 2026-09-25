import {
  lazy,
  Suspense,
  useMemo,
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  executeProjectTransaction,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import {
  planNetlistCodeEdit,
  netlistInstanceAtLine,
  netlistInstanceRanges,
} from "./netlist-code-edit";
import type { NetlistDiagnostic, PrintedNetlistInstance } from "@icm/netlist";
import type { CircuitProject, ObjectLocator } from "@icm/model";
import {
  inferNetlistProcess,
  netlistProcessPendingInstances,
  netlistFamilyTarget,
  planNetlistProcess,
} from "./netlist-process";
import {
  NETLIST_PROFILE_IDS,
  NETLIST_PROFILE_LABELS,
  NETLIST_QUICK_TARGET_FAMILIES,
  NETLIST_DEVICE_TARGET_OPTIONS,
  setNetlistDefaultTarget,
  type NetlistExportProfile,
  type NetlistProfileId,
  type NetlistQuickTargetFamily,
} from "./netlist-process-presets";
import { createDefaultNetlistExportPreferences } from "./netlist-export-preferences";
import {
  createDesignNetlistExport,
  createDraftNetlistPreview,
  unfinishedDrawingDiagnostics,
  type NetlistFormat,
  type NetlistNamingProfile,
} from "@icm/netlist";

const ProjectTextEditor = lazy(
  () => import("../project-code/project-text-editor"),
);

/**
 * What a finding is about, to tell equal messages apart: the part (and pin)
 * it names, and the Cell when that is not the one being exported.
 */
export function netlistIssueTarget(
  project: CircuitProject,
  locator: ObjectLocator,
  rootDocumentId: string,
): string | null {
  const document = project.documents.find(
    (item) => item.id === locator.documentId,
  );
  const endpoint = locator.endpoint;
  const instanceId =
    locator.kind === "instance"
      ? locator.objectId
      : endpoint?.kind === "terminal"
        ? endpoint.instanceId
        : null;
  const instance = instanceId
    ? document?.instances.find((item) => item.id === instanceId)
    : undefined;
  const part = instance
    ? `${instance.reference ?? instance.id}${
        endpoint?.kind === "terminal" ? `.${endpoint.pinName}` : ""
      }`
    : null;
  const cell =
    document && document.id !== rootDocumentId ? `in ${document.name}` : null;
  return [part, cell].filter(Boolean).join(" ") || null;
}

/** Live structural output. Diagnostics belong outside the copyable code. */
export function NetlistCodePanel({
  project,
  onDirtyChange,
  rootDocumentId,
  onRootChange,
  format,
  namingProfile,
  onFormatChange,
  onReset,
  onCopy,
  configurationError,
  onApply,
  onFocusInstance,
  selection,
  onNavigateDiagnostic,
  profiles,
  selectedProcess,
  onProcessChange,
  onDeviceTargetChange,
}: {
  onDirtyChange?(dirty: boolean): void;
  project: CircuitProject;
  rootDocumentId?: string | undefined;
  onRootChange?(documentId: string): void;
  format: NetlistFormat;
  namingProfile: NetlistNamingProfile;
  onFormatChange(format: NetlistFormat): void;
  onReset(): void;
  /** Puts the current netlist on the clipboard, as the Netlist menu's Copy does. */
  onCopy(): void;
  configurationError: string | null;
  onApply(edits: ProjectStructureEdit[]): boolean;
  onFocusInstance(instance: PrintedNetlistInstance | null): void;
  /** Parts selected on the canvas: their printed lines are lit and shown. */
  selection?: { documentId: string; instanceIds: readonly string[] };
  /** Show a finding's object on the canvas. */
  onNavigateDiagnostic?(diagnostic: NetlistDiagnostic): void;
  profiles: Record<NetlistProfileId, NetlistExportProfile>;
  selectedProcess: NetlistProfileId;
  onProcessChange(id: NetlistProfileId): void;
  onDeviceTargetChange(
    family: NetlistQuickTargetFamily,
    target: string,
    process: NetlistProfileId,
  ): void;
}) {
  const process =
    selectedProcess === "custom"
      ? "custom"
      : inferNetlistProcess(project, selectedProcess);
  const profile = profiles[process];
  const [processError, setProcessError] = useState<string | null>(null);
  const [compileRevision, setCompileRevision] = useState(0);
  function applyProcess(
    next: NetlistExportProfile,
    options: Parameters<typeof planNetlistProcess>[2] = {},
  ) {
    try {
      const edits = planNetlistProcess(project, next, options);
      if (edits.length && !onApply(edits))
        throw new Error(
          "Could not apply device mappings. The circuit has not changed.",
        );
      setProcessError(null);
      return true;
    } catch (error) {
      setProcessError(
        error instanceof Error ? error.message : "Could not apply process",
      );
      return false;
    }
  }
  // What the process still owes this circuit: devices drawn before it was
  // chosen, or before the editor bound them at all, remain blocked until the
  // defaults are authored. Counting is the same plan the button applies, so
  // the number and the action cannot disagree.
  const pendingDefaults = useMemo(() => {
    if (configurationError) return 0;
    try {
      return netlistProcessPendingInstances(project, profile);
    } catch {
      return 0;
    }
  }, [project, profile, configurationError]);
  const result = useMemo(
    () =>
      configurationError
        ? null
        : createDesignNetlistExport(project, {
            format,
            namingProfile,
            includeLocations: true,
            ...(rootDocumentId ? { rootDocumentId } : {}),
          }),
    [
      project,
      format,
      namingProfile,
      configurationError,
      rootDocumentId,
      compileRevision,
    ],
  );
  // A drawing that does not extract yet still shows what it says: a draft,
  // read-only, with ? where the drawing is silent and its flagged cards in
  // yellow. Copy and export keep waiting for the strict netlist.
  const draftPreview = useMemo(
    () =>
      result?.status === "blocked"
        ? createDraftNetlistPreview(project, {
            format,
            namingProfile,
            ...(rootDocumentId ? { rootDocumentId } : {}),
          })
        : null,
    [project, format, namingProfile, rootDocumentId, result],
  );
  const unfinished = result
    ? unfinishedDrawingDiagnostics(result.diagnostics)
    : [];
  // Every finding that keeps this netlist from being taken away, not only the
  // first: blocking errors, or, when the text still prints, what makes the
  // drawing unfinished. Each one leads to its object on the canvas.
  const issues: NetlistDiagnostic[] = configurationError
    ? []
    : result?.status === "blocked"
      ? result.diagnostics.filter((item) => item.severity === "error")
      : unfinished;
  const error = configurationError
    ? `Fix Netlist configuration: ${configurationError}`
    : result?.status === "blocked" && issues.length === 0
      ? "Resolve the Check Report findings before copying"
      : null;
  const exportRoot = rootDocumentId ?? project.topDocumentId;
  const source = result?.status === "ready" ? result.file.text : "";
  const [draft, setDraft] = useState(source);
  const [editBaseline, setEditBaseline] = useState(source);
  const [applyError, setApplyError] = useState<string | null>(null);
  const ownApply = useRef(false);
  const dirty = draft !== editBaseline;
  useLayoutEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const conflict = dirty && source !== editBaseline;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const focusRef = useRef(onFocusInstance);
  focusRef.current = onFocusInstance;
  const [cursorInstance, setCursorInstance] =
    useState<PrintedNetlistInstance | null>(null);
  const focusInstance = (instance: PrintedNetlistInstance | null) => {
    setCursorInstance(instance);
    onFocusInstance(instance);
  };
  useEffect(() => () => focusRef.current(null), []);
  useLayoutEffect(() => {
    if (!dirty || ownApply.current) {
      setDraft(source);
      setEditBaseline(source);
      setApplyError(null);
    }
    ownApply.current = false;
  }, [source]);
  function apply(options: { fillMissingDefaults?: boolean } = {}) {
    if (!dirty && !options.fillMissingDefaults) return true;
    if (conflict) return false;
    let edits: ProjectStructureEdit[] = [];
    let working = project;
    if (dirty) {
      if (result?.status !== "ready") return false;
      const plan = planNetlistCodeEdit(project, result, draftRef.current);
      if (!plan.ok) {
        setApplyError(plan.message);
        return false;
      }
      edits = plan.edits;
    }
    if (options.fillMissingDefaults) {
      try {
        if (edits.length) {
          const staged = executeProjectTransaction(project, {
            transactionId: "plan-netlist-refresh",
            projectId: project.id,
            expectedStructureRevision: project.structureRevision,
            actor: { kind: "human", id: "netlist-refresh" },
            edits,
          });
          if (!staged.ok) throw new Error(staged.error.message);
          working = staged.project;
        }
        edits = [
          ...edits,
          ...planNetlistProcess(working, profile, { onlyMissing: true }),
        ];
        setProcessError(null);
      } catch (error) {
        setProcessError(
          error instanceof Error
            ? error.message
            : "Could not fill missing netlist defaults",
        );
        return false;
      }
    }
    if (!edits.length) {
      setDraft(source);
      setEditBaseline(source);
      setApplyError(null);
      return true;
    }
    ownApply.current = true;
    if (!onApply(edits)) {
      ownApply.current = false;
      setApplyError(
        "Edit rejected. Check the device prefix and duplicate names; the circuit keeps the last valid values.",
      );
      return false;
    }
    setApplyError(null);
    return true;
  }
  function refresh() {
    if (!apply({ fillMissingDefaults: true })) return;
    setCompileRevision((revision) => revision + 1);
    setApplyError(null);
    focusInstance(null);
  }
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!dirty || conflict) return;
    const timer = setTimeout(() => applyRef.current(), 500);
    return () => clearTimeout(timer);
  }, [draft, dirty, conflict]);
  function focus(position: number) {
    if (draftPreview)
      return focusInstance(
        netlistInstanceAtLine(
          draftPreview.text,
          position,
          draftPreview.locations.instances,
        ),
      );
    if (result?.status !== "ready") return focusInstance(null);
    const plan = planNetlistCodeEdit(project, result, draftRef.current);
    focusInstance(
      plan.ok
        ? netlistInstanceAtLine(draftRef.current, position, plan.instances)
        : null,
    );
  }
  // The code and the canvas light the same parts: those selected on the
  // canvas, and the one the cursor names here. A part picked on the canvas
  // takes over from the cursor's, and only a new pick scrolls the code.
  const selectionKey = selection
    ? `${selection.documentId}\u0000${selection.instanceIds.join("\u0000")}`
    : "";
  useEffect(() => {
    if (selection?.instanceIds.length) setCursorInstance(null);
    // Keyed by content: the same ids in a new array are the same pick.
  }, [selectionKey]);
  const highlightedRanges = useMemo(() => {
    let instances: readonly PrintedNetlistInstance[];
    if (draftPreview) instances = draftPreview.locations.instances;
    else {
      if (result?.status !== "ready") return [];
      const plan = planNetlistCodeEdit(project, result, draft);
      if (!plan.ok) return [];
      instances = plan.instances;
    }
    return [
      ...(selection
        ? netlistInstanceRanges(
            instances,
            selection.documentId,
            selection.instanceIds,
          )
        : []),
      ...(cursorInstance
        ? netlistInstanceRanges(instances, cursorInstance.documentId, [
            cursorInstance.instanceId,
          ])
        : []),
      ...(draftPreview?.flagged ?? []).map((card) => ({
        from: card.startOffset,
        to: card.endOffset,
        tone: "warning" as const,
      })),
    ];
  }, [project, result, draft, draftPreview, selectionKey, cursorInstance]);
  const editError = conflict
    ? "The canvas or Agent changed the netlist. Reload before applying your draft."
    : applyError;
  const shown = draftPreview ? draftPreview.text : draft;
  const lineCount = shown.split(/\r\n?|\n/u).length;
  return (
    <section
      className="netlist-profile-code netlist-live-code"
      aria-label="Live netlist"
    >
      <div className="netlist-code-controls">
        <div className="netlist-code-selects">
          {onRootChange && project.documents.length > 1 ? (
            <label>
              <span>Entry</span>
              <select
                aria-label="Netlist entry Cell"
                value={rootDocumentId ?? ""}
                disabled={dirty}
                onChange={(event) => onRootChange(event.currentTarget.value)}
              >
                <option value="">Default Top</option>
                {project.documents.map((cell) => (
                  <option key={cell.id} value={cell.id}>
                    {cell.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>Format</span>
            <select
              aria-label="Netlist format"
              value={format}
              onChange={(event) =>
                onFormatChange(event.currentTarget.value as NetlistFormat)
              }
            >
              <option value="spice">SPICE</option>
              <option value="spectre">SCS</option>
            </select>
          </label>
          <label>
            <span>Process</span>
            <select
              aria-label="Netlist process"
              value={process}
              disabled={dirty}
              onChange={(event) => {
                const id = event.currentTarget.value as NetlistProfileId;
                if (applyProcess(profiles[id])) onProcessChange(id);
              }}
            >
              {NETLIST_PROFILE_IDS.map((id) => (
                <option key={id} value={id}>
                  {NETLIST_PROFILE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="netlist-code-actions">
          <button
            type="button"
            className="netlist-code-refresh"
            data-testid="refresh-netlist-panel"
            aria-label="Refresh netlist"
            title="Refresh netlist and fill missing models and values"
            onClick={refresh}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M16 7a6.5 6.5 0 1 0 .3 5 M16 2v5h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {/* Copying is at hand beside the code it copies. An unapplied draft
              is not the circuit yet, so copying waits for Apply or Discard. */}
          <button
            type="button"
            className="netlist-code-copy"
            data-testid="copy-netlist-panel"
            aria-label="Copy netlist"
            title={
              draftPreview
                ? "Copy netlist · finish each ? first"
                : "Copy netlist"
            }
            disabled={dirty || !!draftPreview}
            onClick={onCopy}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M7 7h10v10H7z M13 7V3H3v10h4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div
        className="netlist-code-viewport"
        data-line-count={lineCount}
        style={
          {
            "--netlist-editor-height": `${lineCount * 19.2 + 22}px`,
          } as CSSProperties
        }
      >
        <Suspense
          fallback={
            <textarea
              aria-label="Loading Netlist code editor"
              value={shown}
              readOnly
            />
          }
        >
          <ProjectTextEditor
            ariaLabel="Netlist code"
            language="netlist"
            value={shown}
            readOnly={!!draftPreview}
            invalid={
              !draftPreview && (!!error || issues.length > 0 || !!editError)
            }
            onChange={(text) => {
              draftRef.current = text;
              setDraft(text);
              setApplyError(null);
            }}
            onEnter={apply}
            onModEnter={apply}
            onBlur={() => applyRef.current()}
            onCursorChange={focus}
            highlightedRanges={highlightedRanges}
            revealHighlight={selectionKey}
          />
        </Suspense>
      </div>
      <div
        className="netlist-device-mapping"
        aria-label="Netlist output options"
      >
        {NETLIST_QUICK_TARGET_FAMILIES.map((family) => {
          const label =
            family === "resistor"
              ? "R"
              : family === "capacitor"
                ? "C"
                : family === "inductor"
                  ? "L"
                  : family.toUpperCase();
          const mapped = netlistFamilyTarget(project, family);
          const current =
            mapped === undefined ? profile.devices[family].target : mapped;
          const target = current ?? "__mixed__";
          return (
            <label key={family}>
              <span>{label}</span>
              <select
                aria-label={`${label} netlist target`}
                value={target}
                title={current ?? "Mixed or custom targets"}
                disabled={dirty}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (
                    applyProcess(
                      setNetlistDefaultTarget(profile, family, value),
                      { family },
                    )
                  ) {
                    onDeviceTargetChange(family, value, process);
                  }
                }}
              >
                {current === null ? (
                  <option value="__mixed__" disabled>
                    Mixed / custom
                  </option>
                ) : null}
                {[
                  ...new Set([
                    ...(current === null ? [] : [current]),
                    ...NETLIST_DEVICE_TARGET_OPTIONS[process][family],
                    profile.devices[family].target,
                  ]),
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/^sky130_fd_pr__/u, "") ||
                      (family === "nmos" || family === "pmos"
                        ? "Unspecified"
                        : "Ideal")}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <div className="netlist-mapping-actions">
          {pendingDefaults > 0 ? (
            <button
              type="button"
              className="netlist-fill-defaults"
              data-testid="netlist-fill-defaults"
              disabled={dirty}
              title={`Fill missing models and values on the ${pendingDefaults} ${
                pendingDefaults === 1 ? "device" : "devices"
              } using the ${NETLIST_PROFILE_LABELS[process]} defaults`}
              onClick={() => applyProcess(profile, { onlyMissing: true })}
            >
              Fill {pendingDefaults}{" "}
              {pendingDefaults === 1 ? "device" : "devices"}
            </button>
          ) : null}
          <button
            type="button"
            className="netlist-default-action"
            disabled={dirty}
            onClick={() => {
              const fallback = createDefaultNetlistExportPreferences();
              if (applyProcess(profiles[fallback.selected])) onReset();
            }}
          >
            Default
          </button>
        </div>
      </div>
      {dirty ? (
        <div className="project-code-actions">
          <button
            type="button"
            onClick={() => {
              setDraft(source);
              setEditBaseline(source);
              setApplyError(null);
              focusInstance(null);
            }}
          >
            Reload
          </button>
        </div>
      ) : null}
      {editError ? <p role="alert">{editError}</p> : null}
      {processError ? <p role="alert">{processError}</p> : null}
      <p className="netlist-edit-hint">
        {draftPreview
          ? "Draft · each ? is something the drawing does not say yet"
          : "Edit names, models and values · Enter to apply"}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {issues.length ? (
        <div
          className="netlist-issues"
          role="alert"
          data-testid="netlist-issues"
        >
          <p className="netlist-issues-heading">
            {issues.length === 1 ? "1 issue" : `${issues.length} issues`} ·
            click one to show it on the canvas
          </p>
          <ul>
            {issues.map((issue, index) => {
              const target = netlistIssueTarget(
                project,
                issue.primary,
                exportRoot,
              );
              return (
                <li
                  key={`${issue.code}\u0000${issue.primary.objectId}\u0000${index}`}
                >
                  <button
                    type="button"
                    className="netlist-issue"
                    data-testid="netlist-issue"
                    onClick={() => onNavigateDiagnostic?.(issue)}
                  >
                    <span className="netlist-issue-message">
                      {issue.message}
                    </span>
                    {target ? (
                      <span className="netlist-issue-target">{target}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
