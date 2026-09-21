import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CircuitProject, DerivedRect } from "@icm/model";
import type {
  DeviceCorrespondence,
  ElectricalDeviceOrigin,
} from "@icm/netlist";
import { buildSvgScene } from "@icm/render-svg";
import { resolveDocumentStyleProfile } from "@icm/derived";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import type { GalleryTopologyMatch } from "../../gallery-topology-match";
import "./gallery-topology-comparison.css";

const colors = [
  "#1976d2",
  "#ad4c00",
  "#7b36b0",
  "#00796b",
  "#c62828",
  "#546e00",
];
function instanceFor(project: CircuitProject, origin: ElectricalDeviceOrigin) {
  return project.documents
    .find((document) => document.id === origin.documentId)
    ?.instances.find((instance) => instance.id === origin.instanceId);
}
function ComparisonCanvas({
  project,
  pairs,
  side,
  selected,
  onSelect,
}: {
  project: CircuitProject;
  pairs: DeviceCorrespondence[];
  side: "source" | "target";
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const origin = selected === null ? undefined : pairs[selected]?.[side];
  const documentId = origin?.documentId ?? project.topDocumentId;
  const document = project.documents.find((item) => item.id === documentId)!;
  const profile = resolveDocumentStyleProfile(document.presentation);
  const group = useRef<SVGGElement>(null);
  const [boxes, setBoxes] = useState<
    { bounds: DerivedRect; index: number; id: string }[]
  >([]);
  const [zoom, setZoom] = useState(1);
  const rendering = useMemo(() => {
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
  }, [project, document]);
  useLayoutEffect(() => {
    const relevant =
      selected === null
        ? pairs.map((pair, index) => ({ index, origin: pair[side] }))
        : [{ index: selected, origin: pairs[selected]![side] }];
    const ids = new Map<string, number>();
    for (const item of relevant)
      ids.set(
        selected === null ? item.origin.path[0]! : item.origin.instanceId,
        item.index,
      );
    const next: { bounds: DerivedRect; index: number; id: string }[] = [];
    for (const element of group.current?.querySelectorAll<SVGGraphicsElement>(
      "[data-object-id][data-symbol-id]",
    ) ?? []) {
      const id = element.getAttribute("data-object-id")!;
      const index = ids.get(id);
      if (index === undefined) continue;
      const bounds = element.getBBox();
      next.push({
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
        index,
        id,
      });
    }
    setBoxes(next);
    setZoom(1);
  }, [rendering, pairs, side, selected]);
  if (!rendering.scene)
    return <p role="alert">Cannot render this snapshot: {rendering.error}</p>;
  const frame =
    selected !== null && boxes[0] ? boxes[0].bounds : rendering.scene.viewBox;
  const margin = selected === null ? 20 : 80;
  const viewBox = `${frame.x - margin} ${frame.y - margin} ${Math.max(1, frame.width) + margin * 2} ${Math.max(1, frame.height) + margin * 2}`;
  return (
    <section className="topology-comparison-side">
      <header>
        <strong>
          {side === "source" ? "Your snapshot" : "Gallery snapshot"}
        </strong>
        <span>{origin?.referencePath.join(" / ") ?? document.name}</span>
        <div>
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
        </div>
      </header>
      <div
        className="topology-comparison-drawing"
        style={{ background: profile.background }}
        data-testid={`topology-comparison-${side}`}
      >
        <svg
          viewBox={viewBox}
          style={{
            width: `${zoom * 100}%`,
            height: `${zoom * 100}%`,
            fontSize: profile.typography.annotationFontSize,
            fontFamily: profile.typography.fontFamily,
            fill: profile.foreground,
          }}
          role="img"
          aria-label={`${side === "source" ? "Source" : "Gallery"} circuit with corresponding devices highlighted`}
        >
          <g
            ref={group}
            dangerouslySetInnerHTML={{ __html: rendering.scene.formalBody }}
          />
          {boxes.map(({ bounds, index, id }) => (
            <rect
              key={id}
              data-testid={`topology-highlight-${side}`}
              data-instance-id={id}
              data-match-index={index}
              x={bounds.x - 6}
              y={bounds.y - 6}
              width={Math.max(12, bounds.width + 12)}
              height={Math.max(12, bounds.height + 12)}
              rx={5}
              fill={colors[index % colors.length]}
              fillOpacity={0.15}
              stroke={colors[index % colors.length]}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              className="topology-comparison-highlight"
              onClick={() => onSelect(index)}
            >
              <title>{pairs[index]![side].referencePath.join(" / ")}</title>
            </rect>
          ))}
        </svg>
      </div>
      {origin && !boxes.length ? (
        <p>
          This device has no canvas placement. Its parameters are still compared
          below.
        </p>
      ) : null}
    </section>
  );
}

export default function GalleryTopologyComparison({
  source,
  match,
  onClose,
}: {
  source: CircuitProject;
  match: GalleryTopologyMatch;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    // SVG getBBox() is zero while its containing dialog is closed. Mount the
    // canvases only after entering the top layer, then measure their artwork.
    setReady(true);
    return () => element.close();
  }, []);
  const pair = selected === null ? undefined : match.pairs[selected];
  const left = pair ? instanceFor(source, pair.source) : undefined;
  const right = pair ? instanceFor(match.candidate, pair.target) : undefined;
  const parameterNames = [
    ...new Set([
      ...Object.keys(left?.netlist?.parameters ?? {}),
      ...Object.keys(right?.netlist?.parameters ?? {}),
    ]),
  ].sort();
  const model = (instance: typeof left, project: CircuitProject) => {
    const binding = instance?.netlist?.binding;
    return binding?.kind === "model" ||
      binding?.kind === "unresolved-subcircuit"
      ? binding.name
      : binding?.kind === "external-subcircuit"
        ? (project.externalSubcircuitDefinitions.find(
            (item) => item.id === binding.definitionId,
          )?.name ?? binding.definitionId)
        : binding?.kind === "subcircuit"
          ? (project.documents.find(
              (item) => item.id === binding.childDocumentId,
            )?.name ?? binding.childDocumentId)
          : (binding?.kind ?? "—");
  };
  return createPortal(
    <dialog
      ref={dialog}
      className="gallery-topology-comparison"
      aria-label="Circuit match comparison"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="topology-comparison-header">
        <div>
          <strong>{match.entry.name}</strong>
          <p>
            Frozen comparison · {match.matchedDevices} matched devices · your
            live canvas is unchanged
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close circuit comparison"
        >
          ×
        </button>
      </header>
      {ready ? (
        <div className="topology-comparison-canvases">
          <ComparisonCanvas
            project={source}
            pairs={match.pairs}
            side="source"
            selected={selected}
            onSelect={setSelected}
          />
          <ComparisonCanvas
            project={match.candidate}
            pairs={match.pairs}
            side="target"
            selected={selected}
            onSelect={setSelected}
          />
        </div>
      ) : null}
      <div className="topology-comparison-details">
        <nav aria-label="Corresponding components">
          <button
            type="button"
            aria-pressed={selected === null}
            onClick={() => setSelected(null)}
          >
            All matches
          </button>
          {match.pairs.map((item, index) => (
            <button
              key={JSON.stringify(item.source.path)}
              type="button"
              aria-pressed={selected === index}
              onClick={() => setSelected(index)}
              style={{ borderLeftColor: colors[index % colors.length] }}
            >
              {item.source.referencePath.join(" / ")} ↔{" "}
              {item.target.referencePath.join(" / ")}
            </button>
          ))}
        </nav>
        <section aria-label="Matched component parameters">
          {pair ? (
            <>
              <p>
                {Math.round(pair.parameterSimilarity * 100)}% parameter/model
                similarity. Equivalent units compare equally.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>Your snapshot</th>
                    <th>Gallery snapshot</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th>Model / binding</th>
                    <td>{model(left, source)}</td>
                    <td>{model(right, match.candidate)}</td>
                  </tr>
                  {parameterNames.map((name) => (
                    <tr key={name}>
                      <th>{name}</th>
                      <td>{left?.netlist?.parameters[name] ?? "—"}</td>
                      <td>{right?.netlist?.parameters[name] ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p>
              Click a highlighted device or a pair to inspect both sides and
              their parameters. For symmetric circuits, this is one valid
              correspondence; it need not be unique.
            </p>
          )}
          {match.limited ? (
            <p>
              Search budget reached. Highlighted connections are verified;
              additional matching parts may exist.
            </p>
          ) : null}
        </section>
      </div>
    </dialog>,
    globalThis.document.body,
  );
}
