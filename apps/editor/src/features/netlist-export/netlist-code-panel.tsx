import { useMemo } from "react";
import type { CircuitProject } from "@icm/model";
import {
  createDesignNetlistExport,
  NETLIST_PROFILE_IDS,
  NETLIST_PROFILE_LABELS,
  type NetlistExportProfile,
  type NetlistFormat,
  type NetlistNamingProfile,
  type NetlistProfileId,
} from "@icm/netlist";

/** Live structural output. Diagnostics belong outside the copyable code. */
export function NetlistCodePanel({
  project,
  format,
  namingProfile,
  profile,
  onProfileChange,
  onFormatChange,
  onCopy,
  configurationError,
}: {
  project: CircuitProject;
  format: NetlistFormat;
  namingProfile: NetlistNamingProfile;
  profile: NetlistExportProfile;
  onProfileChange(profile: NetlistProfileId): void;
  onFormatChange(format: NetlistFormat): void;
  onCopy(): void;
  configurationError: string | null;
}) {
  const result = useMemo(
    () =>
      configurationError
        ? null
        : createDesignNetlistExport(project, {
            format,
            namingProfile,
            profile,
          }),
    [project, format, namingProfile, profile, configurationError],
  );
  const error = configurationError
    ? `Fix Netlist configuration: ${configurationError}`
    : result?.status === "blocked"
      ? (result.diagnostics.find((item) => item.severity === "error")
          ?.message ?? "Resolve the Check Report findings before copying")
      : null;
  return (
    <section className="netlist-profile-code" aria-label="Live netlist">
      <header className="netlist-code-header">
        <h2>Netlist</h2>
      </header>
      <div className="netlist-code-controls">
        <label>
          Process
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
        <label>
          Format
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
        <button type="button" data-testid="copy-netlist-panel" onClick={onCopy}>
          Copy
        </button>
      </div>
      <textarea
        aria-label="Netlist code"
        value={result?.status === "ready" ? result.file.text : ""}
        readOnly
        spellCheck={false}
        wrap="off"
      />
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
