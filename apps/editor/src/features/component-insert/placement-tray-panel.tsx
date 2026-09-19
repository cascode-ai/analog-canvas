import type { SchematicDocument } from "@icm/model";

import { PropertyDisclosure } from "../properties/property-disclosure";

type Instance = SchematicDocument["instances"][number];

export function placementTrayIdentity(
  document: SchematicDocument,
  instance: Instance,
): string {
  const formalName = document.netlist?.terminals.find((terminal) =>
    terminal.interfaceInstanceIds.includes(instance.id),
  )?.name;
  const identity = formalName ?? instance.reference ?? "Unreferenced";
  return `${identity} · ${instance.symbolId}`;
}

/**
 * A repair shelf, not a workflow: opening a Project draws every Instance, and
 * nothing in the editor sends a drawn device back here. The panel stays so an
 * Instance that still arrives off-sheet — an older session, an Agent edit — is
 * visible and placeable instead of silently absent from the drawing.
 */
export function PlacementTrayPanel({
  document,
  unplaced,
  onPlaceAll,
  onSelect,
  onPlace,
}: {
  document: SchematicDocument;
  unplaced: readonly Instance[];
  onPlaceAll: () => void;
  onSelect: (instance: Instance, label: string) => void;
  onPlace: (instanceId: string) => void;
}) {
  if (unplaced.length === 0) {
    return null;
  }

  return (
    <PropertyDisclosure
      title="Placement Tray"
      summary={
        <span
          className="placement-tray-count"
          aria-label={`${unplaced.length} retained ${
            unplaced.length === 1 ? "Instance" : "Instances"
          }`}
        >
          {unplaced.length}
        </span>
      }
      className="context-actions placement-tray"
      ariaLabel="Placement Tray"
      role="region"
    >
      <div className="component-mirror-row">
        <button type="button" onClick={onPlaceAll}>
          Place all
        </button>
      </div>
      {unplaced.length > 0 ? (
        <div className="placement-tray-list">
          {unplaced.map((instance) => {
            const label = placementTrayIdentity(document, instance);
            return (
              <div
                className="placement-tray-entry"
                draggable
                data-testid={`unplaced-${instance.id}`}
                key={instance.id}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/x-icm-instance",
                    instance.id,
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
              >
                <button type="button" onClick={() => onSelect(instance, label)}>
                  {label}
                </button>
                <button
                  type="button"
                  aria-label={`Place ${label} from tray`}
                  onClick={() => onPlace(instance.id)}
                >
                  Place…
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </PropertyDisclosure>
  );
}
