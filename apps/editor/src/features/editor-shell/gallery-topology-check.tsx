import { useEffect, useRef, useState } from "react";
import type { CircuitProject } from "@icm/model";
import { galleryPreviewUrl } from "../../gallery-client";
import type { GalleryTopologyMatchReport } from "../../gallery-topology-match";

export function GalleryTopologyCheck({ project }: { project: CircuitProject }) {
  const worker = useRef<Worker | null>(null);
  const [report, setReport] = useState<GalleryTopologyMatchReport | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CircuitProject | null>(null);

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
  };
  useEffect(() => {
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  const start = () => {
    stop();
    setReport(null);
    setFailure(null);
    // postMessage clones this immutable Project synchronously. Later edits
    // belong to the next check, not to this worker's captured circuit.
    setSnapshot(project);
    try {
      const next = new Worker(
        new URL("../../gallery-duplicates.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = next;
      setRunning(true);
      next.onmessage = (event: MessageEvent<GalleryTopologyMatchReport>) => {
        if (worker.current !== next) return;
        setReport(event.data);
        if (event.data.complete || event.data.error) stop();
      };
      next.onerror = () => {
        if (worker.current !== next) return;
        stop();
        setFailure("Could not compare this Cell. Try again.");
      };
      next.postMessage({ type: "topology", project });
    } catch {
      stop();
      setFailure("Could not start topology matching. Try again.");
    }
  };

  const exactCount = report?.matches.filter((match) => match.exact).length ?? 0;
  return (
    <section
      className="examples-topology-check"
      aria-label="Gallery topology matching"
      data-testid="gallery-topology-check"
    >
      <div className="examples-topology-actions">
        <button
          type="button"
          className="examples-panel-match-button"
          data-testid="gallery-find-similar"
          onClick={start}
          disabled={running}
        >
          {report ? "Check current topology again" : "Check current topology"}
        </button>
        {running ? (
          <button
            type="button"
            className="examples-panel-match-cancel"
            onClick={stop}
          >
            Cancel
          </button>
        ) : null}
      </div>
      {snapshot ? (
        <p
          className="examples-topology-message"
          data-testid="gallery-topology-snapshot"
        >
          {snapshot !== project
            ? "Canvas changed. This check still uses the circuit captured when you clicked Check."
            : "Checking a snapshot of this Cell. You can keep editing."}
        </p>
      ) : null}
      <span role="status" className="examples-topology-status">
        {running
          ? `Comparing ${report?.scanned ?? 0}${report?.total != null ? ` / ${report.total}` : ""} Gallery circuits…`
          : report?.complete && !report.sourceError
            ? exactCount > 0
              ? `${exactCount} exact topology ${exactCount === 1 ? "match" : "matches"}; ${report.comparable} comparable circuits checked.`
              : `No confirmed exact match; ${report.comparable} comparable circuits checked.`
            : null}
      </span>
      {report?.uncheckable ? (
        <p className="examples-topology-message">
          {report.uncheckable} circuits could not be fully compared.
        </p>
      ) : null}
      {failure || report?.sourceError || report?.error ? (
        <p role="alert" className="examples-topology-message">
          {failure ?? report?.sourceError ?? report?.error}
        </p>
      ) : null}
      {report?.complete &&
      !report.sourceError &&
      report.matches.length === 0 ? (
        <p className="examples-topology-message">
          No comparable Gallery circuits were found.
        </p>
      ) : null}
      {report?.matches.length ? (
        <div
          className="examples-topology-results"
          data-testid="gallery-topology-results"
        >
          {report.matches.map((match) => (
            <a
              key={match.entry.id}
              href={`/g/${match.entry.id}`}
              target="_blank"
              rel="noreferrer"
              className="examples-topology-result"
              data-exact={match.exact}
            >
              <img
                src={galleryPreviewUrl(
                  match.entry.id,
                  match.entry.previewRevision,
                )}
                alt=""
                loading="lazy"
              />
              <span>
                <strong>{match.entry.name}</strong>
                <small>{match.entry.author || "Gallery"}</small>
                <small>
                  {match.exact
                    ? "Exact topology match"
                    : `${Math.min(99, Math.round(match.similarity * 100))}% structural similarity`}
                </small>
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
