import { useEffect, useId, useMemo, useState } from "react";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import { buildProjectHierarchy } from "@icm/derived";

function ParameterOverrideField({
  name,
  defaultValue,
  override,
  onChange,
}: {
  name: string;
  defaultValue: string | undefined;
  override: string | undefined;
  onChange(value: string | null): boolean;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(override ?? "");
  useEffect(() => setDraft(override ?? ""), [override]);
  const overridden = override !== undefined;
  return (
    <div
      className="cell-instance-parameter"
      data-overridden={overridden || undefined}
    >
      <label htmlFor={inputId}>{name}</label>
      <input
        id={inputId}
        aria-label={`Instance parameter ${name}`}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        placeholder={defaultValue ?? "Required"}
        title={
          overridden
            ? `Overrides the default ${defaultValue ?? "(none)"}`
            : `Inherits the default ${defaultValue ?? "(required)"}`
        }
        onBlur={() => {
          const value = draft.trim();
          if (value !== (override ?? "") && !onChange(value || null))
            setDraft(override ?? "");
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {overridden || draft.trim() ? (
        <button
          type="button"
          className="cell-instance-parameter-reset"
          aria-label={`Reset ${name} to default`}
          title={`Reset to the default ${defaultValue ?? ""}`.trim()}
          onPointerDown={(event) => {
            // Pointer Reset discards the draft; keyboard blur still commits it.
            if (event.button === 0) event.preventDefault();
          }}
          onClick={() => {
            if (override === undefined || onChange(null)) setDraft("");
          }}
        >
          ↺
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

/** Instance overrides: one line each, with sharing named only when it applies. */
export function CellInstanceParameters({
  project,
  parent,
  cell,
  instance,
  onChange,
  onDefinition,
}: {
  project: CircuitProject;
  parent: SchematicDocument;
  cell: SchematicDocument;
  instance: Instance;
  onChange(name: string, value: string | null): boolean;
  onDefinition(): void;
}) {
  const usage = useMemo(
    () => buildProjectHierarchy(project).usage(parent.id, 0),
    [project, parent.id],
  );
  const parameters = cell.netlist?.formalParameters ?? [];
  return (
    <section
      className="cell-instance-parameters"
      aria-label="Instance parameters"
    >
      <header>
        <h3>Cell parameters</h3>
        <button type="button" onClick={onDefinition}>
          Edit {cell.name}…
        </button>
      </header>
      {usage.total > 1 ? (
        <p className="cell-instance-shared">
          Shared by all {usage.total}
          {usage.atLeast ? "+" : ""} uses of {parent.name}.
        </p>
      ) : null}
      {parameters.map((parameter) => {
        const values = instance.netlist?.parameters ?? {};
        const key = Object.keys(values).find(
          (name) => name.toLowerCase() === parameter.name.toLowerCase(),
        );
        const override = key ? values[key] : undefined;
        return (
          <ParameterOverrideField
            key={JSON.stringify([parent.id, instance.id, parameter.name])}
            name={parameter.name}
            defaultValue={parameter.defaultValue}
            override={override}
            onChange={(value) => onChange(key ?? parameter.name, value)}
          />
        );
      })}
      {!parameters.length ? (
        <p className="cell-instance-shared">No parameters declared.</p>
      ) : null}
    </section>
  );
}
