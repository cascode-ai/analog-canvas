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
import type { ProjectStructureEdit } from "@icm/edit-engine";
import {
  planNetlistCodeEdit,
  netlistInstanceAtLine,
} from "./netlist-code-edit";
import type { PrintedNetlistInstance } from "@icm/netlist";
import type { CircuitProject } from "@icm/model";
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
  unfinishedDrawingDiagnostics,
  type NetlistFormat,
  type NetlistNamingProfile,
  type NetlistPortCase,
} from "@icm/netlist";

const ProjectTextEditor = lazy(
  () => import("../project-code/project-text-editor"),
);

/** Live structural output. Diagnostics belong outside the copyable code. */
export function NetlistCodePanel({
  project,
  rootDocumentId,
  onRootChange,
  format,
  namingProfile,
  portCase,
  onFormatChange,
  onPortCaseChange,
  onCopy,
  onReset,
  configurationError,
  onApply,
  onFocusInstance,
  profiles,
  selectedProcess,
  onProcessChange,
  onDeviceTargetChange,
}: {
  project: CircuitProject;
  rootDocumentId?: string | undefined;
  onRootChange?(documentId: string): void;
  format: NetlistFormat;
  namingProfile: NetlistNamingProfile;
  portCase: NetlistPortCase;
  onFormatChange(format: NetlistFormat): void;
  onPortCaseChange(portCase: NetlistPortCase): void;
  onCopy(): void;
  onReset(): void;
  configurationError: string | null;
  onApply(edits: ProjectStructureEdit[]): boolean;
  onFocusInstance(instance: PrintedNetlistInstance | null): void;
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
  // chosen, or before the editor bound them at all, keep their TODO model and
  // dimensions until somebody says so. Counting is the same plan the button
  // applies, so the number and the action cannot disagree.
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
            portCase,
            includeLocations: true,
            ...(rootDocumentId ? { rootDocumentId } : {}),
          }),
    [
      project,
      format,
      namingProfile,
      portCase,
      configurationError,
      rootDocumentId,
    ],
  );
  const unfinished = result
    ? unfinishedDrawingDiagnostics(result.diagnostics)
    : [];
  const error = configurationError
    ? `Fix Netlist configuration: ${configurationError}`
    : result?.status === "blocked"
      ? (result.diagnostics.find((item) => item.severity === "error")
          ?.message ?? "Resolve the Check Report findings before copying")
      : // The text below is still what the drawing says; it is just not a
        // netlist anybody should take away yet.
        (unfinished[0]?.message ?? null);
  const source = result?.status === "ready" ? result.file.text : "";
  const [draft, setDraft] = useState(source);
  const [editBaseline, setEditBaseline] = useState(source);
  const [applyError, setApplyError] = useState<string | null>(null);
  const ownApply = useRef(false);
  const dirty = draft !== editBaseline;
  const conflict = dirty && source !== editBaseline;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const focusRef = useRef(onFocusInstance);
  focusRef.current = onFocusInstance;
  useEffect(() => () => focusRef.current(null), []);
  useLayoutEffect(() => {
    if (!dirty || ownApply.current) {
      setDraft(source);
      setEditBaseline(source);
      setApplyError(null);
    }
    ownApply.current = false;
  }, [source]);
  function apply() {
    if (!dirty || conflict || result?.status !== "ready") return;
    const plan = planNetlistCodeEdit(project, result, draftRef.current);
    if (!plan.ok) {
      setApplyError(plan.message);
      return;
    }
    if (!plan.edits.length) {
      setDraft(source);
      setEditBaseline(source);
      setApplyError(null);
      return;
    }
    ownApply.current = true;
    if (!onApply(plan.edits)) {
      ownApply.current = false;
      setApplyError(
        "Edit rejected. Check the device prefix and duplicate names; the circuit keeps the last valid values.",
      );
      return;
    }
    setApplyError(null);
  }
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!dirty || conflict) return;
    const timer = setTimeout(() => applyRef.current(), 500);
    return () => clearTimeout(timer);
  }, [draft, dirty, conflict]);
  function focus(position: number) {
    if (result?.status !== "ready") return onFocusInstance(null);
    const plan = planNetlistCodeEdit(project, result, draftRef.current);
    onFocusInstance(
      plan.ok
        ? netlistInstanceAtLine(draftRef.current, position, plan.instances)
        : null,
    );
  }
  const editError = conflict
    ? "The canvas or Agent changed the netlist. Reload before applying your draft."
    : applyError;
  const lineCount = draft.split(/\r\n?|\n/u).length;
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
        <button
          type="button"
          className="netlist-code-copy"
          data-testid="copy-netlist-panel"
          aria-label="Copy netlist"
          title="Copy netlist"
          disabled={dirty}
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
              value={draft}
              readOnly
            />
          }
        >
          <ProjectTextEditor
            ariaLabel="Netlist code"
            language="netlist"
            value={draft}
            invalid={!!error || !!editError}
            onChange={(text) => {
              draftRef.current = text;
              setDraft(text);
              setApplyError(null);
            }}
            onEnter={apply}
            onModEnter={apply}
            onBlur={() => applyRef.current()}
            onCursorChange={focus}
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
          <button
            type="button"
            className="netlist-port-case"
            aria-label={`Port names: ${portCase === "upper" ? "uppercase" : "lowercase"}`}
            title={`Use ${portCase === "upper" ? "lowercase" : "uppercase"} port names`}
            onClick={() =>
              onPortCaseChange(portCase === "upper" ? "lower" : "upper")
            }
          >
            <code>{portCase === "upper" ? "ABC" : "abc"}</code>
          </button>
          {pendingDefaults > 0 ? (
            <button
              type="button"
              className="netlist-fill-defaults"
              data-testid="netlist-fill-defaults"
              disabled={dirty}
              title={`Give the ${pendingDefaults} ${
                pendingDefaults === 1 ? "device" : "devices"
              } with no model the ${NETLIST_PROFILE_LABELS[process]} model and dimensions`}
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
              onFocusInstance(null);
            }}
          >
            Reload
          </button>
        </div>
      ) : null}
      {editError ? <p role="alert">{editError}</p> : null}
      {processError ? <p role="alert">{processError}</p> : null}
      <p className="netlist-edit-hint">
        Edit names, models and values · Enter to apply
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : result?.status === "ready" && result.placeholders.length ? (
        <p role="status">
          {result.placeholders.length} TODO fields remain. See Netlist → Check
          Report.
        </p>
      ) : null}
    </section>
  );
}
