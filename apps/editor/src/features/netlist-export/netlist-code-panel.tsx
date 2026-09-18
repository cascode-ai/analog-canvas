import { lazy, Suspense, useMemo, type CSSProperties } from "react";
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
}) {
  const result = useMemo(
    () =>
      configurationError
        ? null
        : createDesignNetlistExport(project, {
            format,
            namingProfile,
            portCase,
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
  const visibleLines = netlistEditorVisibleLines(source);
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
              value={source}
              readOnly
            />
          }
        >
          <ProjectTextEditor
            ariaLabel="Netlist code"
            language="netlist"
            value={source}
            readOnly
            invalid={!!error}
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
