import { useEffect, useMemo, useState } from "react";
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
  const [draft, setDraft] = useState(override ?? "");
  useEffect(() => setDraft(override ?? ""), [override]);
  return (
    <div className="cell-instance-parameter">
      <label>
        {name}
        <input
          aria-label={`Instance parameter ${name}`}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={defaultValue ?? "Required"}
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
      </label>
      <small>
        {override === undefined
          ? `Inherited default: ${defaultValue ?? "none (required)"}`
          : `Override · default: ${defaultValue ?? "none"}`}
      </small>
      <button
        type="button"
        disabled={override === undefined && !draft.trim()}
        aria-label={`Reset ${name} to default`}
        onPointerDown={(event) => {
          // Pointer Reset discards the draft; keyboard blur still commits it.
          if (event.button === 0) event.preventDefault();
        }}
        onClick={() => {
          if (override === undefined || onChange(null)) setDraft("");
        }}
      >
        Reset
      </button>
    </div>
  );
}

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
      <h3>
        {instance.reference ?? instance.id} · {cell.name}
      </h3>
      <p>
        Overrides are stored in {parent.name}.{" "}
        {usage.total > 1
          ? `All ${usage.total}${usage.atLeast ? "+" : ""} occurrences of ${parent.name} share these overrides.`
          : "Other instances of this child keep their own overrides."}
      </p>
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
      {!parameters.length ? <p>No parameters declared.</p> : null}
      <button type="button" onClick={onDefinition}>
        Edit shared Cell definition…
      </button>
    </section>
  );
}
