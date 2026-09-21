import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CircuitProject, DerivedRect } from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { resolveDocumentStyleProfile } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  compareGalleryVersions,
  type VersionComponentChange,
} from "./gallery-version-diff";

const colors = { added: "#19833c", removed: "#c33838", modified: "#a56800" };
function VersionCanvas({
  project,
  documentId,
  changes,
  side,
  selected,
  onSelect,
}: {
  project: CircuitProject;
  documentId: string;
  changes: VersionComponentChange[];
  side: "before" | "after";
  selected: string | null;
  onSelect(id: string): void;
}) {
  const document = project.documents.find((item) => item.id === documentId);
  const group = useRef<SVGGElement>(null);
  const [boxes, setBoxes] = useState<
    {
      id: string;
      bounds: DerivedRect;
      status: VersionComponentChange["status"];
    }[]
  >([]);
  const [zoom, setZoom] = useState(1);
  const rendering = useMemo(() => {
    if (!document) return {};
    try {
      return {
        scene: buildSvgScene(
          document,
          createProjectSymbolResolver(project, builtInSymbols),
        ),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [document, project]);
  useLayoutEffect(() => {
    const byId = new Map(changes.map((change) => [change.instanceId, change]));
    const next: typeof boxes = [];
    for (const element of group.current?.querySelectorAll<SVGGraphicsElement>(
      "[data-object-id][data-symbol-id]",
    ) ?? []) {
      const id = element.getAttribute("data-object-id")!;
      const change = byId.get(id);
      if (!change) continue;
      const bounds = element.getBBox();
      next.push({
        id,
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
        status: change.status,
      });
    }
    setBoxes(next);
    setZoom(1);
  }, [rendering, changes]);
  const profile =
    document && resolveDocumentStyleProfile(document.presentation);
  const frame = rendering.scene?.viewBox;
  return (
    <section className="version-compare-side">
      <header>
        <b>{side === "before" ? "Historical version" : "Current version"}</b>
        <span>
          <button
            type="button"
            aria-label={`Zoom out ${side}`}
            onClick={() => setZoom((value) => Math.max(1, value / 1.5))}
          >
            −
          </button>
          <button
            type="button"
            aria-label={`Zoom in ${side}`}
            onClick={() => setZoom((value) => Math.min(8, value * 1.5))}
          >
            +
          </button>
        </span>
      </header>
      {!document ? (
        <p>Cell absent in this version.</p>
      ) : !frame ? (
        <p role="alert">Cannot render snapshot: {rendering.error}</p>
      ) : (
        <div
          className="version-compare-drawing"
          style={{ background: profile!.background }}
        >
          <svg
            role="img"
            aria-label={`${side} circuit differences`}
            viewBox={`${frame.x - 16} ${frame.y - 16} ${frame.width + 32} ${frame.height + 32}`}
            style={{
              width: `${zoom * 100}%`,
              height: `${zoom * 100}%`,
              fill: profile!.foreground,
              fontFamily: profile!.typography.fontFamily,
              fontSize: profile!.typography.annotationFontSize,
            }}
          >
            <g
              ref={group}
              dangerouslySetInnerHTML={{ __html: rendering.scene!.formalBody }}
            />
            {boxes.map(({ id, bounds, status }) => (
              <rect
                key={id}
                data-testid={`version-highlight-${side}`}
                data-instance-id={id}
                data-change={status}
                x={bounds.x - 6}
                y={bounds.y - 6}
                width={Math.max(12, bounds.width + 12)}
                height={Math.max(12, bounds.height + 12)}
                rx={4}
                fill={colors[status]}
                fillOpacity={selected === id ? 0.3 : 0.12}
                stroke={colors[status]}
                strokeWidth={selected === id ? 3 : 1.5}
                vectorEffect="non-scaling-stroke"
                onClick={() => onSelect(id)}
              >
                <title>
                  {id}: {status}
                </title>
              </rect>
            ))}
          </svg>
        </div>
      )}
    </section>
  );
}

export function VersionHistoryComparison({
  before,
  after,
}: {
  before: CircuitProject;
  after: CircuitProject;
}) {
  const result = useMemo(() => {
    try {
      return { changes: compareGalleryVersions(before, after) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [before, after]);
  const documents = useMemo(
    () => [
      ...new Map(
        [...before.documents, ...after.documents].map((document) => [
          document.id,
          document,
        ]),
      ).values(),
    ],
    [before, after],
  );
  const [documentId, setDocumentId] = useState(after.topDocumentId);
  const [selected, setSelected] = useState<string | null>(null);
  const changes = useMemo(
    () =>
      result.changes?.filter((change) => change.documentId === documentId) ??
      [],
    [result, documentId],
  );
  const change = changes.find((item) => item.instanceId === selected);
  if (!result.changes)
    return <p role="alert">Cannot compare snapshots: {result.error}</p>;
  return (
    <div className="version-comparison" data-testid="version-comparison">
      <div className="version-compare-summary">
        <label>
          Cell{" "}
          <select
            aria-label="Comparison Cell"
            value={documentId}
            onChange={(event) => {
              setDocumentId(event.target.value);
              setSelected(null);
            }}
          >
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.name}
              </option>
            ))}
          </select>
        </label>
        <span>
          {result.changes.filter((item) => item.status === "added").length}{" "}
          added ·{" "}
          {result.changes.filter((item) => item.status === "removed").length}{" "}
          removed ·{" "}
          {result.changes.filter((item) => item.status === "modified").length}{" "}
          modified
        </span>
      </div>
      <div className="version-compare-canvases">
        <VersionCanvas
          project={before}
          documentId={documentId}
          changes={changes}
          side="before"
          selected={selected}
          onSelect={setSelected}
        />
        <VersionCanvas
          project={after}
          documentId={documentId}
          changes={changes}
          side="after"
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <div className="version-compare-details">
        <nav aria-label="Changed components">
          {changes.length === 0 ? (
            <p>No component differences in this Cell.</p>
          ) : (
            changes.map((item) => (
              <button
                key={item.instanceId}
                type="button"
                style={{ borderLeftColor: colors[item.status] }}
                aria-pressed={selected === item.instanceId}
                onClick={() => setSelected(item.instanceId)}
              >
                {item.name} · {item.status}
              </button>
            ))
          )}
        </nav>
        <section>
          {!change ? (
            <p>
              Select a highlighted component or a row to inspect its changes.
            </p>
          ) : change.status !== "modified" ? (
            <p>
              {change.name} was{" "}
              {change.status === "added" ? "added to" : "removed from"} this
              Cell.
            </p>
          ) : (
            <table aria-label={`${change.name} changes`}>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Historical</th>
                  <th>Current</th>
                </tr>
              </thead>
              <tbody>
                {[...change.fields]
                  .sort(
                    (a, b) =>
                      Number(b.path.startsWith("netlist.parameters")) -
                      Number(a.path.startsWith("netlist.parameters")),
                  )
                  .map((field) => (
                    <tr key={field.path}>
                      <th>{field.path}</th>
                      <td>{field.before}</td>
                      <td>{field.after}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <p className="version-history-note">
        Green: added · Red: removed · Amber: modified. Component parameters,
        placement, labels and connections are compared. Standalone drawing and
        source-file changes are not included in this component report.
      </p>
    </div>
  );
}
