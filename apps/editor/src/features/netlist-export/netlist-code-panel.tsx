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
}: {
  project: CircuitProject;
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
}) {
  const result = useMemo(
    () =>
      configurationError
        ? null
        : createDesignNetlistExport(project, {
            format,
            namingProfile,
            portCase,
            includeLocations: true,
          }),
    [project, format, namingProfile, portCase, configurationError],
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
  const visibleLines = netlistEditorVisibleLines(draft);
  return (
    <section
      className="netlist-profile-code netlist-live-code"
      aria-label="Live netlist"
    >
      <div className="netlist-code-controls">
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
        data-visible-lines={visibleLines}
        style={
          {
            "--netlist-editor-height": `${visibleLines * 19.2 + 22}px`,
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
          <button
            type="button"
            className="netlist-default-action"
            onClick={onReset}
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

export function netlistEditorVisibleLines(source: string): number {
  const lineCount = source.split(/\r\n?|\n/u).length;
  return Math.max(10, Math.min(20, lineCount));
}
