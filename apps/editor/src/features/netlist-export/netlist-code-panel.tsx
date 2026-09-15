import { lazy, Suspense, useMemo } from "react";
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

const ProjectTextEditor = lazy(
  () => import("../project-code/project-text-editor"),
);

/** Live structural output. Diagnostics belong outside the copyable code. */
export function NetlistCodePanel({
  project,
  format,
  namingProfile,
  profile,
  onProfileChange,
  onFormatChange,
  onMosTargetChange,
  onCopy,
  configurationError,
}: {
  project: CircuitProject;
  format: NetlistFormat;
  namingProfile: NetlistNamingProfile;
  profile: NetlistExportProfile;
  onProfileChange(profile: NetlistProfileId): void;
  onFormatChange(format: NetlistFormat): void;
  onMosTargetChange(family: "nmos" | "pmos", target: string): void;
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
  const source = result?.status === "ready" ? result.file.text : "";
  return (
    <section className="netlist-profile-code" aria-label="Live netlist">
      <div className="netlist-code-controls">
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
        <button type="button" data-testid="copy-netlist-panel" onClick={onCopy}>
          Copy
        </button>
      </div>
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
      <div className="netlist-device-mapping" aria-label="MOS device mapping">
        {(["nmos", "pmos"] as const).map((family) => (
          <label key={family}>
            <span>{family.toUpperCase()}</span>
            <input
              aria-label={`${family.toUpperCase()} netlist target`}
              value={profile.devices[family].target}
              onChange={(event) =>
                onMosTargetChange(family, event.currentTarget.value.trim())
              }
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>
        ))}
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
