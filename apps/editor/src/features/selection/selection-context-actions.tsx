import type { MosBulkResolution } from "@icm/derived";
import type { Annotation, SchematicDocument } from "@icm/model";
import type { RoutingGuidanceView } from "../../interaction/interaction-state";

import {
  GroupPropertyCodeEditor,
  type GroupPropertyCodeEditorProps,
} from "../properties/group-property-code-editor";
import { RoutePropertyCodeEditor } from "../properties/route-property-code-editor";
import type { RoutePropertyCodeValue } from "../properties/route-property-code";
import { ToolIcon } from "../editor-shell/tool-icon";

export function MosBulkConnectionSection({
  connection,
  explicitRouteVisible,
  canDraw,
  onDraw,
}: {
  connection: {
    terminal: string;
    netName: string | null;
    status: MosBulkResolution["status"];
  } | null;
  explicitRouteVisible: boolean;
  canDraw: boolean;
  onDraw: () => void;
}) {
  if (connection === null) return null;
  const { terminal, netName, status } = connection;
  const label =
    netName ?? (status === "no-connect" ? "No Connect" : "Unconnected");
  const origin = {
    explicit: "Explicit connection",
    "cell-default": "Cell default",
    "instance-override": "Instance override",
    "supply-default": "Supply default",
    "no-connect": "Intentionally left unconnected",
    unresolved: "Choose a net for the bulk terminal",
  }[status];
  const description = `${terminal} → ${label} · ${origin}${
    explicitRouteVisible ? " · Dashed bulk route shown" : ""
  }`;
  return (
    <section
      className="mos-bulk-bar"
      aria-label="MOS bulk connection"
      data-state={status}
    >
      <h2>Bulk</h2>
      <span
        className="mos-bulk-status"
        title={description}
        aria-label={description}
      >
        {label}
      </span>
      <button
        type="button"
        className="bulk-draw-action"
        data-testid="draw-bulk-connection"
        aria-label="Draw bulk connection"
        disabled={!canDraw}
        title={
          canDraw
            ? `Draw a connection from ${terminal} on the canvas`
            : "Place the component on the canvas before drawing its bulk connection"
        }
        onClick={onDraw}
      >
        <ToolIcon name="wire" />
        {status === "unresolved" ? "Connect" : "Draw"}
      </button>
    </section>
  );
}

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

export function GroupPropertiesSection({
  active,
  ...properties
}: { active: boolean } & GroupPropertyCodeEditorProps) {
  if (!active) return null;
  return (
    <GroupPropertyCodeEditor key={properties.selectionKey} {...properties} />
  );
}

export function RouteActionsSection({
  active,
  document,
  route,
  netLabel,
  bulkOwnerLabel,
  defaultColor,
  highlightActive,
  onApply,
  onToggleHighlight,
  onDeleteWire,
}: {
  active: boolean;
  document: SchematicDocument;
  route: SchematicDocument["routes"][number] | null;
  netLabel: Annotation | null;
  bulkOwnerLabel?: string | null;
  defaultColor: string;
  highlightActive: boolean;
  onApply: (value: RoutePropertyCodeValue) => { ok: boolean; message?: string };
  onToggleHighlight: () => void;
  onDeleteWire: () => void;
}) {
  if (!active || !route) return null;
  if (bulkOwnerLabel) {
    return (
      <section className="context-actions" aria-label="MOS bulk route actions">
        <h2>Bulk connection</h2>
        <p>
          Follows <strong>{bulkOwnerLabel}</strong> line color.
        </p>
        <button type="button" onClick={onDeleteWire}>
          Delete bulk connection
        </button>
      </section>
    );
  }
  return (
    <section className="context-actions" aria-label="Route actions">
      <RoutePropertyCodeEditor
        key={route.id}
        document={document}
        route={route}
        netLabel={netLabel}
        defaultColor={defaultColor}
        onApply={onApply}
        actions={
          <div className="route-property-code-actions">
            <button type="button" onClick={onToggleHighlight}>
              {highlightActive
                ? "Clear Net highlight (H)"
                : "Highlight Net (H)"}
            </button>
            <button type="button" onClick={onDeleteWire}>
              Delete wire
            </button>
          </div>
        }
      />
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
  onDeleteCurrentArrow,
  onToggleHighlight,
}: {
  kind: "current-arrow" | "net-label" | null;
  highlightActive: boolean;
  onDeleteCurrentArrow: () => void;
  onToggleHighlight: () => void;
}) {
  if (kind === "current-arrow")
    return (
      <section className="context-actions" aria-label="Current arrow actions">
        <h2>Current arrow</h2>
        <small>This legacy annotation can be removed from the drawing.</small>
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
