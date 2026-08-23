import { printDesignNetlist } from "@icm/netlist";
import type {
  DesignNetlistAnalysisResult,
  NetlistDiagnostic,
  NetlistFormat,
} from "@icm/netlist";
import { useMemo, useState } from "react";

/** Presentation-only consumer of the canonical design-netlist analysis. */
export function NetlistPreflightDialog({
  open,
  result,
  onClose,
  onNavigate,
  onExport,
}: {
  open: boolean;
  result: DesignNetlistAnalysisResult;
  onClose(): void;
  onNavigate(diagnostic: NetlistDiagnostic): void;
  onExport(format: NetlistFormat): void;
}) {
  const [format, setFormat] = useState<NetlistFormat>("spice");
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
  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="insert-component-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="netlist-preflight-title"
      >
        <header className="insert-dialog-header">
          <div>
            <p>Canonical design-netlist analysis</p>
            <h2 id="netlist-preflight-title">Check Report</h2>
          </div>
        </header>
        <div className="insert-dialog-body">
          {result.ir ? (
            <section className="insert-control-column">
              <h3>Ready to export</h3>
              <p>
                {result.ir.cells.length} internal Cell
                {result.ir.cells.length === 1 ? "" : "s"};{" "}
                {result.ir.externalMasters?.length ?? 0} external interface
                {(result.ir.externalMasters?.length ?? 0) === 1 ? "" : "s"}.
              </p>
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
              <pre
                className="netlist-preview"
                data-testid="netlist-preview"
                aria-label="Structural netlist preview"
              >
                {preview}
              </pre>
              <button type="button" onClick={() => onExport(format)}>
                Download {format === "spice" ? "SPICE" : "Spectre"} netlist
              </button>
            </section>
          ) : (
            <section className="insert-control-column">
              <h3>
                {errors.length} blocking issue{errors.length === 1 ? "" : "s"}
              </h3>
              <p>
                Resolve each issue before a netlist IR is available for export.
              </p>
            </section>
          )}
          {result.diagnostics.length > 0 ? (
            <section
              className="insert-control-column"
              aria-label="Preflight findings"
            >
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
        </div>
        <footer className="insert-dialog-actions">
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
