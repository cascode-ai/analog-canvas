import { useEffect, useId, useMemo, useState } from "react";
import type { CircuitProject, Instance, SchematicDocument } from "@icm/model";
import { buildProjectHierarchy } from "@icm/derived";
import { PropertyDisclosure } from "../properties/property-disclosure";

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
  const overrides = Object.entries(instance.netlist?.parameters ?? {});
  const rows = parameters.map(({ name, defaultValue }) => {
    const stored = overrides.find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    return {
      name,
      key: stored?.[0] ?? name,
      defaultValue,
      override: stored?.[1],
    };
  });
  const overridden = rows.filter((row) => row.override !== undefined).length;
  return (
    <>
      {rows.length > 0 ? (
        <PropertyDisclosure
          title="Cell parameters"
          summary={`${overridden} override${overridden === 1 ? "" : "s"} of ${rows.length}`}
          ariaLabel="Instance parameters"
          role="region"
        >
          {usage.total > 1 ? (
            <p className="cell-instance-shared">
              Shared by all {usage.total}
              {usage.atLeast ? "+" : ""} uses of {parent.name}.
            </p>
          ) : null}
          {rows.map(({ name, key, defaultValue, override }) => (
            <ParameterOverrideField
              key={JSON.stringify([parent.id, instance.id, name])}
              name={name}
              defaultValue={defaultValue}
              override={override}
              onChange={(value) => onChange(key, value)}
            />
          ))}
        </PropertyDisclosure>
      ) : null}
      <div className="instance-property-row">
        <span>Cell definition</span>
        <button type="button" onClick={onDefinition}>
          Edit {cell.name}…
        </button>
      </div>
    </>
  );
}
