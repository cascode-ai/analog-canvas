import { useMemo } from "react";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { buildProjectHierarchy } from "@icm/derived";
import { PropertyActionRow } from "../properties/property-action-row";

/**
 * A Cell instance's definition, one click away. Its overrides are the
 * `parameters` of its Properties JSON; sharing is named only when it applies.
 */
export function CellInstanceDefinition({
  project,
  parent,
  cell,
  onDefinition,
}: {
  project: CircuitProject;
  parent: SchematicDocument;
  cell: SchematicDocument;
  onDefinition(): void;
}) {
  const usage = useMemo(
    () => buildProjectHierarchy(project).usage(parent.id, 0),
    [project, parent.id],
  );
  return (
    <PropertyActionRow
      label="Cell"
      note={
        usage.total > 1
          ? `Shared by all ${usage.total}${usage.atLeast ? "+" : ""} uses of ${parent.name}.`
          : undefined
      }
    >
      <button type="button" onClick={onDefinition}>
        Edit {cell.name}…
      </button>
    </PropertyActionRow>
  );
}
