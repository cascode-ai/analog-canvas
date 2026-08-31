import type { SchematicDocument } from "@icm/model";

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

export function PlacementTrayPanel({
  document,
  unplaced,
  returnablePlaced,
  onPlaceAll,
  onReturnAll,
  onSelect,
  onPlace,
}: {
  document: SchematicDocument;
  unplaced: readonly Instance[];
  returnablePlaced: readonly Instance[];
  onPlaceAll: () => void;
  onReturnAll: (instanceIds: readonly string[]) => void;
  onSelect: (instance: Instance, label: string) => void;
  onPlace: (instanceId: string) => void;
}) {
  return (
    <section
      className="context-actions placement-tray"
      aria-label="Placement Tray"
    >
      <div className="placement-tray-heading">
        <h2>Placement Tray</h2>
        <span
          className="placement-tray-count"
          aria-label={`${unplaced.length} retained ${
            unplaced.length === 1 ? "Instance" : "Instances"
          }`}
        >
          {unplaced.length}
        </span>
      </div>
      <div className="component-mirror-row">
        <button
          type="button"
          onClick={onPlaceAll}
          disabled={unplaced.length === 0}
        >
          Place all
        </button>
        <button
          type="button"
          onClick={() =>
            onReturnAll(returnablePlaced.map((instance) => instance.id))
          }
          disabled={returnablePlaced.length === 0}
        >
          Return all
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
    </section>
  );
}
