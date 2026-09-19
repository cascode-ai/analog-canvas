import { useEffect, useState } from "react";
import { cellParameterCallers, cellParameterUsage } from "@icm/edit-engine";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type {
  CellParameterChange,
  ExternalDefinitionResult,
} from "./project-structure-commands";

type Parameter = NonNullable<
  SchematicDocument["netlist"]
>["formalParameters"][number];
type Edit = (
  name: string,
  change: CellParameterChange,
) => ExternalDefinitionResult;

function ParameterRow({
  parameter,
  cell,
  project,
  onEdit,
}: {
  parameter: Parameter;
  cell: SchematicDocument;
  project: CircuitProject;
  onEdit: Edit;
}) {
  const [name, setName] = useState(parameter.name);
  const [value, setValue] = useState(parameter.defaultValue ?? "");
  const [error, setError] = useState("");
  useEffect(() => {
    setName(parameter.name);
    setValue(parameter.defaultValue ?? "");
    setError("");
  }, [parameter.name, parameter.defaultValue]);
  const usage = cellParameterUsage(cell, parameter.name);
  const count = usage.fields.length + usage.defaults.length;
  const overrides = cellParameterCallers(
    project,
    cell.id,
    parameter.name,
  ).length;
  const apply = (change: CellParameterChange) => {
    const result = onEdit(parameter.name, change);
    setError(result.ok ? "" : result.message);
  };
  return (
    <>
      <div className="cell-parameter-row" role="row">
        <input
          aria-label={`Parameter ${parameter.name} name`}
          title={`${count} internal uses; ${overrides} instance overrides`}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={() => {
            if (name !== parameter.name) apply({ kind: "rename", value: name });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <input
          aria-label={`Parameter ${parameter.name} default`}
          placeholder="No default"
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onBlur={() => {
            if (value !== (parameter.defaultValue ?? ""))
              apply({ kind: "default", value });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <button
          type="button"
          aria-label={`Remove parameter ${parameter.name}`}
          title={
            count || overrides
              ? "Remove references and overrides first"
              : "Remove unused parameter"
          }
          disabled={count > 0 || overrides > 0}
          onClick={() => apply({ kind: "remove" })}
        >
          ×
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

export function CellParametersEditor({
  cell,
  project,
  onEdit,
}: {
  cell: SchematicDocument;
  project: CircuitProject;
  onEdit: Edit;
}) {
  const parameters = cell.netlist?.formalParameters ?? [];
  if (!parameters.length) return null;
  return (
    <section className="cell-interface-section" aria-label="Cell parameters">
      <header>
        <h3>Parameters</h3>
        <span className="cell-count-badge">{parameters.length}</span>
      </header>
      <div
        className="cell-parameter-list"
        role="table"
        aria-label="Cell parameter definitions"
      >
        <div className="cell-parameter-row" role="row">
          <span role="columnheader">Name</span>
          <span role="columnheader">Default</span>
          <span />
        </div>
        {parameters.map((parameter) => (
          <ParameterRow
            key={parameter.name}
            parameter={parameter}
            cell={cell}
            project={project}
            onEdit={onEdit}
          />
        ))}
      </div>
    </section>
  );
}
