import type { Ref } from "react";

import { ColorOverrideControl } from "../properties/color-override-control";

import { DisplayToggle } from "../component-insert/display-toggle";

export function MosBulkConnectionSection({
  connection,
  explicitRouteVisible,
  onDraw,
}: {
  connection: string | null;
  explicitRouteVisible: boolean;
  onDraw: () => void;
}) {
  if (connection === null) return null;
  return (
    <section className="context-actions" aria-label="MOS bulk connection">
      <h2>Bulk</h2>
      <button
        type="button"
        className="bulk-draw-action"
        data-testid="draw-bulk-connection"
        onClick={onDraw}
      >
        Draw bulk connection
      </button>
      <p>{connection}</p>
      {explicitRouteVisible ? (
        <p>Explicit bulk is shown with a Razavi dashed route.</p>
      ) : null}
    </section>
  );
}

export type RoutingGuidanceView = "focused" | "all" | "hidden";

export function RoutingGuidanceSection({
  total,
  displayed,
  view,
  onViewChange,
}: {
  total: number;
  displayed: number;
  view: RoutingGuidanceView;
  onViewChange: (view: RoutingGuidanceView) => void;
}) {
  if (total === 0) return null;
  return (
    <section className="context-actions" aria-label="Routing guidance">
      <h2>Imported routing guidance</h2>
      <div className="component-mirror-row">
        {(
          [
            ["focused", "Focused"],
            ["all", "All"],
            ["hidden", "Hide"],
          ] as const
        ).map(([candidate, label]) => (
          <button
            type="button"
            aria-pressed={view === candidate}
            key={candidate}
            onClick={() => onViewChange(candidate)}
          >
            {label}
          </button>
        ))}
      </div>
      <small>
        {displayed} shown / {total} derived. Guidance exists only for imported
        Nets.
      </small>
    </section>
  );
}

export function GroupDisplayToggles({
  active,
  referencesVisible,
  valuesVisible,
  valuesAvailable,
  onReferencesVisibleChange,
  onValuesVisibleChange,
}: {
  active: boolean;
  referencesVisible: boolean;
  valuesVisible: boolean;
  valuesAvailable: boolean;
  onReferencesVisibleChange: (visible: boolean) => void;
  onValuesVisibleChange: (visible: boolean) => void;
}) {
  if (!active) return null;
  return (
    <section className="property-section" aria-label="Group display toggles">
      <div className="property-section-heading">Canvas labels</div>
      <div className="display-toggle-row">
        <DisplayToggle
          label="Reference"
          checked={referencesVisible}
          onChange={onReferencesVisibleChange}
        />
        <DisplayToggle
          label="Value"
          checked={valuesVisible}
          disabled={!valuesAvailable}
          help={valuesAvailable ? undefined : "Fill device parameters first"}
          onChange={onValuesVisibleChange}
        />
      </div>
    </section>
  );
}

export function RouteActionsSection({
  active,
  netLabelInputRef,
  netLabel,
  color,
  defaultColor,
  highlightActive,
  onNetLabelChange,
  onColorChange,
  onDeleteNetLabel,
  onAddCurrentArrow,
  onToggleHighlight,
  onDeleteWire,
}: {
  active: boolean;
  netLabelInputRef: Ref<HTMLInputElement>;
  netLabel: string;
  color: string | undefined;
  defaultColor: string;
  highlightActive: boolean;
  onNetLabelChange: (value: string) => void;
  onColorChange: (value: string | undefined) => void;
  onDeleteNetLabel: () => void;
  onAddCurrentArrow: () => void;
  onToggleHighlight: () => void;
  onDeleteWire: () => void;
}) {
  if (!active) return null;
  return (
    <section className="context-actions" aria-label="Route actions">
      <h2>Electrical route</h2>
      <label>
        Electrical Net label
        <input
          ref={netLabelInputRef}
          aria-label="Electrical Net label"
          value={netLabel}
          onChange={(event) => onNetLabelChange(event.currentTarget.value)}
        />
      </label>
      <button type="button" onClick={onDeleteNetLabel}>
        Delete Net label
      </button>
      <ColorOverrideControl
        label="Wire color"
        value={color}
        fallback={defaultColor}
        onChange={onColorChange}
      />
      <button type="button" onClick={onAddCurrentArrow}>
        Add current arrow
      </button>
      <button type="button" onClick={onToggleHighlight}>
        {highlightActive ? "Clear Net highlight (H)" : "Highlight Net (H)"}
      </button>
      <button type="button" onClick={onDeleteWire}>
        Delete wire
      </button>
    </section>
  );
}

export function EndpointActionsSection({
  kind,
  noConnect,
  endpointNetId,
  onDisconnect,
  onDeleteConnection,
  onToggleNoConnect,
  onDeleteJunction,
}: {
  kind: "terminal" | "junction" | null;
  noConnect: boolean;
  endpointNetId: string | null;
  onDisconnect: () => void;
  onDeleteConnection: () => void;
  onToggleNoConnect: () => void;
  onDeleteJunction: () => void;
}) {
  if (kind === "junction")
    return (
      <section className="context-actions" aria-label="Junction actions">
        <h2>Junction</h2>
        <button type="button" onClick={onDeleteJunction}>
          Delete junction and attached wires
        </button>
      </section>
    );
  if (kind !== "terminal") return null;
  return (
    <section className="context-actions" aria-label="Endpoint actions">
      <h2>Endpoint</h2>
      <button type="button" onClick={onDisconnect}>
        Disconnect endpoint
      </button>
      <button type="button" onClick={onDeleteConnection}>
        Delete connection
      </button>
      <button
        type="button"
        onClick={onToggleNoConnect}
        disabled={!noConnect && endpointNetId !== null}
      >
        {noConnect ? "Clear No Connect" : "Mark No Connect"}
      </button>
      {!noConnect && endpointNetId ? (
        <small>Disconnect this endpoint before marking No Connect.</small>
      ) : null}
    </section>
  );
}

export function AnnotationActionsSection({
  kind,
  highlightActive,
  onReverseCurrentArrow,
  onDeleteCurrentArrow,
  onToggleHighlight,
}: {
  kind: "current-arrow" | "net-label" | null;
  highlightActive: boolean;
  onReverseCurrentArrow: () => void;
  onDeleteCurrentArrow: () => void;
  onToggleHighlight: () => void;
}) {
  if (kind === "current-arrow")
    return (
      <section className="context-actions" aria-label="Current arrow actions">
        <h2>Current arrow</h2>
        <button type="button" onClick={onReverseCurrentArrow}>
          Reverse direction (X)
        </button>
        <small>Drag to slide along the wire or move its label.</small>
        <button type="button" onClick={onDeleteCurrentArrow}>
          Delete current arrow
        </button>
      </section>
    );
  if (kind !== "net-label") return null;
  return (
    <section className="context-actions" aria-label="Annotation actions">
      <h2>Annotation</h2>
      <button type="button" onClick={onToggleHighlight}>
        {highlightActive ? "Clear Net highlight (H)" : "Highlight Net (H)"}
      </button>
    </section>
  );
}
