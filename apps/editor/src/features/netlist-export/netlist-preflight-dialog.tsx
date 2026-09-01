import { analyzeDesignNetlist, printDesignNetlist } from "@icm/netlist";
import type { Diagnostic } from "@icm/derived";
import type {
  NetlistDiagnostic,
  NetlistFormat,
  NetlistNamingProfile,
} from "@icm/netlist";
import type { CircuitProject } from "@icm/model";
import { useMemo, useState } from "react";

/** Presentation-only composition of structural analysis and current ERC. */
export function NetlistPreflightDialog({
  open,
  project,
  electricalDiagnostics,
  onClose,
  onNavigate,
  onNavigateElectrical,
  onExport,
}: {
  open: boolean;
  project: CircuitProject;
  electricalDiagnostics: readonly Diagnostic[];
  onClose(): void;
  onNavigate(diagnostic: NetlistDiagnostic): void;
  onNavigateElectrical(diagnostic: Diagnostic): void;
  onExport(format: NetlistFormat, namingProfile: NetlistNamingProfile): void;
}) {
  const [format, setFormat] = useState<NetlistFormat>("spice");
  const [namingProfile, setNamingProfile] =
    useState<NetlistNamingProfile>("native");
  const result = useMemo(
    () => analyzeDesignNetlist(project, { format, namingProfile }),
    [format, namingProfile, project],
  );
  // The same finding repeated once per object says nothing many times over;
  // count it instead. Seven identical lines was most of what the report said.
  const groupedFindings = useMemo(() => {
    const groups = new Map<
      string,
      {
        code: string;
        message: string;
        count: number;
        sample: NetlistDiagnostic;
      }
    >();
    for (const diagnostic of result.diagnostics) {
      const key = `${diagnostic.code}\u0000${diagnostic.message}`;
      const existing = groups.get(key);
      if (existing) existing.count += 1;
      else {
        groups.set(key, {
          code: diagnostic.code,
          message: diagnostic.message,
          count: 1,
          sample: diagnostic,
        });
      }
    }
    return [...groups.values()];
  }, [result.diagnostics]);
  const preview = useMemo(
    () => (result.ir ? printDesignNetlist(format, result.ir).text : null),
    [format, result.ir],
  );
  if (!open) return null;
  const errors = result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const hasDiagnostics =
    result.diagnostics.length > 0 || electricalDiagnostics.length > 0;
  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="netlist-preflight-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="netlist-preflight-title"
      >
        <header className="netlist-preflight-header">
          <div>
            <p>Canonical design-netlist analysis</p>
            <h2 id="netlist-preflight-title">Check Report</h2>
          </div>
        </header>
        <section className="netlist-preflight-summary" aria-label="Readiness">
          <h3>
            {result.ir
              ? electricalDiagnostics.length > 0
                ? "Structure ready; review electrical findings"
                : "Ready to export"
              : `${errors.length} blocking issue${errors.length === 1 ? "" : "s"}`}
          </h3>
          {result.ir ? (
            <p>
              {result.ir.cells.length} internal Cell
              {result.ir.cells.length === 1 ? "" : "s"};{" "}
              {result.ir.externalMasters?.length ?? 0} external interface
              {(result.ir.externalMasters?.length ?? 0) === 1 ? "" : "s"}.
            </p>
          ) : (
            <p>
              Resolve each issue before a netlist IR is available for export.
            </p>
          )}
        </section>
        <div
          className="netlist-preflight-body"
          data-has-preview={result.ir ? "true" : "false"}
          data-has-diagnostics={hasDiagnostics ? "true" : "false"}
        >
          {result.ir ? (
            <section
              className="netlist-preflight-export"
              aria-label="Structural netlist"
            >
              <div className="netlist-preflight-export-controls">
                <label>
                  Structural format
                  <select
                    aria-label="Netlist export format"
                    value={format}
                    onChange={(event) =>
                      setFormat(event.currentTarget.value as NetlistFormat)
                    }
                  >
                    <option value="spice">SPICE (.spi)</option>
                    <option value="spectre">Spectre (.scs)</option>
                  </select>
                </label>
                <label>
                  Naming profile
                  <select
                    aria-label="Netlist naming profile"
                    value={namingProfile}
                    onChange={(event) =>
                      setNamingProfile(
                        event.currentTarget.value as NetlistNamingProfile,
                      )
                    }
                  >
                    <option value="native">Native declarations</option>
                    <option value="cadence-bang">Cadence `!` globals</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => onExport(format, namingProfile)}
                >
                  Download {format === "spice" ? "SPICE" : "Spectre"} netlist
                </button>
              </div>
              <pre
                className="netlist-preview"
                data-testid="netlist-preview"
                aria-label="Structural netlist preview"
              >
                {preview}
              </pre>
            </section>
          ) : null}
          {hasDiagnostics ? (
            <aside
              className="netlist-preflight-diagnostics"
              aria-label="Netlist diagnostics"
            >
              {result.diagnostics.length > 0 ? (
                <section aria-label="Preflight findings">
                  <h3>Findings</h3>
                  <ul className="preflight-findings">
                    {groupedFindings.map((group) => (
                      <li key={`${group.code}-${group.message}`}>
                        <button
                          type="button"
                          data-severity={group.sample.severity}
                          onClick={() => onNavigate(group.sample)}
                        >
                          <strong>{group.code}</strong>
                          <span>
                            {group.message}
                            {group.count > 1 ? ` (×${group.count})` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {electricalDiagnostics.length > 0 ? (
                <section aria-label="Electrical findings">
                  <h3>Electrical readiness ({electricalDiagnostics.length})</h3>
                  <p>
                    These findings use the same current-revision connectivity
                    assessment as ERC and the Gallery gate. Saving remains a
                    separate action and is allowed for unfinished work.
                  </p>
                  <ul className="preflight-findings">
                    {electricalDiagnostics.map((diagnostic) => (
                      <li key={diagnostic.id}>
                        <button
                          type="button"
                          data-severity={diagnostic.severity}
                          onClick={() => onNavigateElectrical(diagnostic)}
                        >
                          <strong>{diagnostic.code}</strong>
                          <span>{diagnostic.message}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </aside>
          ) : null}
        </div>
        <footer className="netlist-preflight-actions">
          <button
            type="button"
            data-testid="check-report-close"
            onClick={onClose}
          >
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
