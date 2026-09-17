import { lazy, Suspense, useMemo, type CSSProperties } from "react";
import type { CircuitProject } from "@icm/model";
import {
  createDesignNetlistExport,
  unfinishedDrawingDiagnostics,
  NETLIST_DEVICE_TARGET_OPTIONS,
  NETLIST_PROFILE_IDS,
  NETLIST_PROFILE_LABELS,
  NETLIST_QUICK_TARGET_FAMILIES,
  type NetlistExportProfile,
  type NetlistFormat,
  type NetlistNamingProfile,
  type NetlistPortCase,
  type NetlistProfileId,
  type NetlistQuickTargetFamily,
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
  profile,
  onProfileChange,
  onFormatChange,
  onPortCaseChange,
  onDeviceTargetChange,
  onCopy,
  onReset,
  configurationError,
}: {
  project: CircuitProject;
  format: NetlistFormat;
  namingProfile: NetlistNamingProfile;
  portCase: NetlistPortCase;
  profile: NetlistExportProfile;
  onProfileChange(profile: NetlistProfileId): void;
  onFormatChange(format: NetlistFormat): void;
  onPortCaseChange(portCase: NetlistPortCase): void;
  onDeviceTargetChange(family: NetlistQuickTargetFamily, target: string): void;
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
            profile,
          }),
    [project, format, namingProfile, portCase, profile, configurationError],
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
        <label>
          <span>Process</span>
          <select
            aria-label="Netlist process"
            value={profile.id}
            onChange={(event) =>
              onProfileChange(event.currentTarget.value as NetlistProfileId)
            }
          >
            {NETLIST_PROFILE_IDS.map((id) => (
              <option key={id} value={id}>
                {NETLIST_PROFILE_LABELS[id]}
              </option>
            ))}
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
        aria-label="Netlist device mapping"
      >
        {NETLIST_QUICK_TARGET_FAMILIES.map((family) => (
          <label key={family}>
            <span>{deviceFamilyLabel(family)}</span>
            <select
              aria-label={`${deviceFamilyLabel(family)} netlist target`}
              value={profile.devices[family].target}
              title={profile.devices[family].target || "Ideal"}
              onChange={(event) =>
                onDeviceTargetChange(family, event.currentTarget.value)
              }
            >
              {[
                ...new Set([
                  profile.devices[family].target,
                  ...NETLIST_DEVICE_TARGET_OPTIONS[profile.id][family],
                ]),
              ].map((target) => (
                <option key={target || "unspecified"} value={target}>
                  {target || "Ideal"}
                </option>
              ))}
            </select>
          </label>
        ))}
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

function deviceFamilyLabel(family: NetlistQuickTargetFamily): string {
  if (family === "resistor") return "R";
  if (family === "capacitor") return "C";
  if (family === "inductor") return "L";
  return family.toUpperCase();
}
