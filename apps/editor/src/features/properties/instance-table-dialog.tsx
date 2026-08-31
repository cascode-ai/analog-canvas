import {
  buildProjectInstanceIndex,
  type ProjectConnectivityIndex,
  type ProjectInstanceRow,
} from "@icm/derived";
import {
  planBatchProperty,
  planReferenceRenumber,
  type ProjectStructureEdit,
} from "@icm/edit-engine";
import type { CircuitProject } from "@icm/model";
import { useMemo, useState } from "react";

export interface InstanceTableDialogProps {
  open: boolean;
  project: CircuitProject;
  connectivityIndex: ProjectConnectivityIndex;
  activeDocumentId: string;
  onClose(): void;
  onOpenInstance(documentId: string, instanceId: string): void;
  onApply(transactionId: string, edits: ProjectStructureEdit[]): boolean;
}

function rowKey(row: ProjectInstanceRow): string {
  return `${row.documentId}\u0000${row.instanceId}`;
}

function referenceIssueLabel(row: ProjectInstanceRow): string {
  return row.referenceIssues
    .map((issue) => {
      if (issue.code === "DUPLICATE_REFERENCE") {
        return `Duplicate with ${issue.otherInstanceId ?? "another instance"}`;
      }
      if (issue.code === "WRONG_REFERENCE_PREFIX") {
        return "Wrong reference prefix";
      }
      return "Reference required";
    })
    .join("; ");
}

/**
 * Explicit project table for inspector-grade review and controlled batch
 * writes. It is intentionally separate from the canvas Properties dock, so
 * selection and ordinary single-instance editing retain their current flow.
 */
export function InstanceTableDialog({
  open,
  project,
  connectivityIndex,
  activeDocumentId,
  onClose,
  onOpenInstance,
  onApply,
}: InstanceTableDialogProps) {
  const [scope, setScope] = useState<"active" | "project">("active");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [fieldKind, setFieldKind] = useState<
    "parameter" | "model-target" | "reference-renumber"
  >("parameter");
  const [parameterName, setParameterName] = useState("l");
  const [value, setValue] = useState("");
  const [renumberPolicy, setRenumberPolicy] = useState<
    "fill-gaps" | "continuous"
  >("fill-gaps");
  const [startAt, setStartAt] = useState("1");

  const index = useMemo(
    () =>
      buildProjectInstanceIndex(project, {
        connectivityIndex,
      }),
    [connectivityIndex, project],
  );
  const rows = index
    .search(query)
    .filter(
      (row) => scope === "project" || row.documentId === activeDocumentId,
    );
  const targets = index.rows
    .filter((row) => selected.has(rowKey(row)))
    .map((row) => ({ documentId: row.documentId, instanceId: row.instanceId }));
  const propertyPreview = planBatchProperty(
    project,
    targets,
    fieldKind === "parameter"
      ? { kind: "parameter", name: parameterName.trim() }
      : { kind: "model-target" },
    value,
  );
  const parsedStartAt = Number(startAt);
  const referencePreview = planReferenceRenumber(project, targets, {
    policy: renumberPolicy,
    startAt:
      Number.isSafeInteger(parsedStartAt) && parsedStartAt > 0
        ? parsedStartAt
        : 1,
  });
  const edits =
    fieldKind === "reference-renumber"
      ? referencePreview.edits
      : propertyPreview.edits;
  const applicableCount =
    fieldKind === "reference-renumber"
      ? referencePreview.reassigned.length
      : propertyPreview.applicable.length;
  const allVisibleSelected =
    rows.length > 0 && rows.every((row) => selected.has(rowKey(row)));

  if (!open) return null;
  const toggleRow = (row: ProjectInstanceRow): void => {
    const key = rowKey(row);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleVisible = (): void => {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of rows) {
        const key = rowKey(row);
        if (allVisibleSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  return (
    <div
      className="search-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="instance-table-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="instance-table-title"
      >
        <header>
          <div>
            <p className="help-kicker">Project authoring</p>
            <h2 id="instance-table-title">Instance Table</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close instance table"
          >
            Close
          </button>
        </header>
        <div className="instance-table-controls">
          <label>
            Scope
            <select
              aria-label="Instance table scope"
              value={scope}
              onChange={(event) =>
                setScope(event.currentTarget.value as "active" | "project")
              }
            >
              <option value="active">Active Cell</option>
              <option value="project">Project</option>
            </select>
          </label>
          <label>
            Search
            <input
              aria-label="Search instances"
              value={query}
              placeholder="Reference, symbol, model…"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            onClick={toggleVisible}
            disabled={rows.length === 0}
          >
            {allVisibleSelected ? "Clear visible" : "Select visible"}
          </button>
        </div>
        <div className="instance-table-scroll">
          <table>
            <thead>
              <tr>
                <th aria-label="Selection" />
                <th>ID</th>
                <th>Reference</th>
                <th>Master</th>
                <th>Symbol</th>
                <th>Cell</th>
                <th>Callers</th>
                <th>Target</th>
                <th>Parameters</th>
                <th>Checks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.reference ?? row.instanceId}`}
                      checked={selected.has(rowKey(row))}
                      onChange={() => toggleRow(row)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="instance-table-link"
                      onClick={() =>
                        onOpenInstance(row.documentId, row.instanceId)
                      }
                    >
                      {row.instanceId}
                    </button>
                  </td>
                  <td>{row.reference ?? "—"}</td>
                  <td>{row.masterName ?? "—"}</td>
                  <td>{row.symbolId}</td>
                  <td>{row.documentName}</td>
                  <td>
                    {row.callerPaths.length === 0
                      ? "Top"
                      : `${row.callerPaths.length} definition use${row.callerPaths.length === 1 ? "" : "s"}`}
                  </td>
                  <td>{row.binding?.kind ?? "—"}</td>
                  <td>
                    {Object.entries(row.parameters)
                      .map(([name, parameter]) => `${name}=${parameter}`)
                      .join(", ") || "—"}
                  </td>
                  <td>{referenceIssueLabel(row) || "OK"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <p>No instances match this scope.</p> : null}
        </div>
        <footer
          className="instance-table-batch"
          aria-label="Batch property editor"
        >
          <label>
            Field
            <select
              aria-label="Batch field"
              value={fieldKind}
              onChange={(event) =>
                setFieldKind(
                  event.currentTarget.value as
                    "parameter" | "model-target" | "reference-renumber",
                )
              }
            >
              <option value="parameter">Netlist parameter</option>
              <option value="model-target">Model target</option>
              <option value="reference-renumber">Reference renumber</option>
            </select>
          </label>
          {fieldKind === "parameter" ? (
            <label>
              Name
              <input
                aria-label="Parameter name"
                value={parameterName}
                onChange={(event) =>
                  setParameterName(event.currentTarget.value)
                }
              />
            </label>
          ) : null}
          {fieldKind === "reference-renumber" ? (
            <>
              <label>
                Policy
                <select
                  aria-label="Reference renumber policy"
                  value={renumberPolicy}
                  onChange={(event) =>
                    setRenumberPolicy(
                      event.currentTarget.value as "fill-gaps" | "continuous",
                    )
                  }
                >
                  <option value="fill-gaps">Fill gaps / repair</option>
                  <option value="continuous">Continuous</option>
                </select>
              </label>
              <label>
                Start at
                <input
                  aria-label="Reference start index"
                  inputMode="numeric"
                  value={startAt}
                  onChange={(event) => setStartAt(event.currentTarget.value)}
                />
              </label>
            </>
          ) : (
            <label>
              Value
              <input
                aria-label="Batch value"
                value={value}
                placeholder={
                  fieldKind === "parameter"
                    ? "Empty clears"
                    : "Empty clears target"
                }
                onChange={(event) => setValue(event.currentTarget.value)}
              />
            </label>
          )}
          <span aria-live="polite">
            {fieldKind === "reference-renumber"
              ? `${referencePreview.reassigned.length} reassign · ${referencePreview.preserved.length} preserved · ${referencePreview.skipped.length} skipped`
              : `${propertyPreview.applicable.length} ready · ${propertyPreview.unchanged.length} unchanged · ${propertyPreview.incompatible.length} incompatible · ${propertyPreview.blocked.length} blocked`}
          </span>
          <button
            type="button"
            className="primary"
            disabled={edits.length === 0}
            onClick={() => {
              const transactionId =
                fieldKind === "reference-renumber"
                  ? "batch-instance-renumber"
                  : "batch-instance-property";
              if (onApply(transactionId, [...edits])) {
                setSelected(new Set());
              }
            }}
          >
            Apply to {applicableCount}
          </button>
        </footer>
      </section>
    </div>
  );
}
