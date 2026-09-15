import { useMemo } from "react";
import type { CircuitProject } from "@icm/model";
import {
  createDesignNetlistExport,
  type NetlistExportProfile,
  type NetlistFormat,
  type NetlistNamingProfile,
} from "@icm/netlist";

/** Live structural output. Diagnostics belong outside the copyable code. */
export function NetlistCodePanel({
  project,
  format,
  namingProfile,
  profile,
  configurationError,
}: {
  project: CircuitProject;
  format: NetlistFormat;
  namingProfile: NetlistNamingProfile;
  profile: NetlistExportProfile;
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
      <h2>Netlist · {format === "spice" ? "SPICE" : "SCS"}</h2>
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
