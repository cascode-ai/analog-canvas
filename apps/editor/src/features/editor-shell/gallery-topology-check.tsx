import { useSyncExternalStore } from "react";
import type { CircuitProject } from "@icm/model";
import { galleryPreviewUrl } from "../../gallery-client";
import { galleryTopologyTask } from "./gallery-topology-task";

export function GalleryTopologyCheck({ project }: { project: CircuitProject }) {
  const { report, running, failure, snapshot } = useSyncExternalStore(
    galleryTopologyTask.subscribe,
    galleryTopologyTask.getSnapshot,
    galleryTopologyTask.getSnapshot,
  );
  const start = () => galleryTopologyTask.start(project);
  const stop = () => galleryTopologyTask.cancel();

  const exactCount = report?.matches.filter((match) => match.exact).length ?? 0;
  return (
    <section
      className="publish-duplicate-check"
      aria-label="Gallery duplicate check"
      data-testid="gallery-topology-check"
    >
      <div className="publish-duplicate-actions">
        <button
          type="button"
          className="publish-duplicate-button"
          data-testid="gallery-find-similar"
          onClick={start}
          disabled={running}
        >
          {report ? "Check Again" : "Check Duplicate"}
        </button>
        {running ? (
          <button
            type="button"
            className="publish-duplicate-cancel"
            onClick={stop}
          >
            Cancel
          </button>
        ) : null}
      </div>
      {snapshot ? (
        <p
          className="publish-duplicate-message"
          data-testid="gallery-topology-snapshot"
        >
          {snapshot !== project
            ? `Canvas changed. These results still use “${snapshot.name}” captured when you clicked Check Duplicate.`
            : "Comparing a snapshot of this Cell. You can still publish while the check runs."}
        </p>
      ) : null}
      <span role="status" className="publish-duplicate-status">
        {running
          ? `Comparing ${report?.scanned ?? 0}${report?.total != null ? ` / ${report.total}` : ""} Gallery circuits…`
          : report?.complete && !report.sourceError
            ? exactCount > 0
              ? `${exactCount} exact topology ${exactCount === 1 ? "match" : "matches"}; ${report.comparable} comparable circuits checked.`
              : `No confirmed exact match; ${report.comparable} comparable circuits checked.`
            : null}
      </span>
      {report?.uncheckable ? (
        <p className="publish-duplicate-message">
          {report.uncheckable} circuits could not be fully compared.
        </p>
      ) : null}
      {failure || report?.sourceError || report?.error ? (
        <p role="alert" className="publish-duplicate-message">
          {failure ?? report?.sourceError ?? report?.error}
        </p>
      ) : null}
      {report?.complete &&
      !report.sourceError &&
      report.matches.length === 0 ? (
        <p className="publish-duplicate-message">
          No comparable Gallery circuits were found.
        </p>
      ) : null}
      {report?.matches.length ? (
        <div
          className="publish-duplicate-results"
          data-testid="gallery-topology-results"
        >
          {report.matches.map((match) => (
            <a
              key={match.entry.id}
              href={`/g/${match.entry.id}`}
              target="_blank"
              rel="noreferrer"
              className="publish-duplicate-result"
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
                    ? "Exact topology match · 100%"
                    : `${Math.min(99, Math.round(match.similarity * 100))}% structural similarity`}
                </small>
                {match.exact ? (
                  <small>
                    {match.netlistMatch === "equal"
                      ? "Netlist matches, including models and parameters"
                      : match.netlistMatch === "different"
                        ? "Topology matches; netlist details differ"
                        : "Netlist equivalence not confirmed"}
                  </small>
                ) : null}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
