import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import type { CircuitProject } from "@icm/model";
import { galleryPreviewUrl } from "../../gallery-client";
import { galleryTopologyTask } from "./gallery-topology-task";
import type { GalleryTopologyMatch } from "../../gallery-topology-match";
const GalleryTopologyComparison = lazy(
  () => import("./gallery-topology-comparison"),
);

export function GalleryTopologyCheck({ project }: { project: CircuitProject }) {
  const [comparison, setComparison] = useState<{
    source: CircuitProject;
    match: GalleryTopologyMatch;
  } | null>(null);
  const { report, running, failure, snapshot, sourceProject } =
    useSyncExternalStore(
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
          {sourceProject !== project
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
            <article
              key={match.entry.id}
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
                <a
                  href={`/g/${match.entry.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>{match.entry.name}</strong>
                </a>
                <small>{match.entry.author || "Gallery"}</small>
                <small>
                  {Math.min(
                    match.netlistMatch === "equal" ? 100 : 99,
                    Math.round(match.similarity * 100),
                  )}
                  % match
                  {match.exact
                    ? " · Exact topology match"
                    : " · Partial structure"}
                </small>
                <small>
                  Structure {Math.round(match.structureSimilarity * 100)}% ·
                  Parameters/models{" "}
                  {Math.round(match.parameterSimilarity * 100)}%
                </small>
                <small>
                  {match.matchedDevices}/{match.sourceDevices} source devices
                  correspond to {match.matchedDevices}/{match.targetDevices}{" "}
                  Gallery devices
                </small>
                {match.limited ? (
                  <small>
                    Search limit reached; shown pairs are verified, coverage may
                    be incomplete.
                  </small>
                ) : null}
                {match.exact ? (
                  <small>
                    {match.netlistMatch === "equal"
                      ? "Netlist matches, including models and parameters"
                      : match.netlistMatch === "different"
                        ? "Topology matches; netlist details differ"
                        : "Netlist equivalence not confirmed"}
                  </small>
                ) : null}
                <button
                  type="button"
                  className="topology-compare-button"
                  data-testid={`topology-compare-${match.entry.id}`}
                  disabled={!match.pairs.length || !snapshot}
                  onClick={() =>
                    snapshot && setComparison({ source: snapshot, match })
                  }
                >
                  Compare on canvas
                </button>
              </span>
            </article>
          ))}
        </div>
      ) : null}
      {report?.matches.length ? (
        <p className="publish-duplicate-message">
          Ranking: structure score × (85% + 15% × parameter/model score). A
          similarity score is not proof of an identical netlist.
        </p>
      ) : null}
      {comparison ? (
        <Suspense fallback={<p role="status">Opening comparison…</p>}>
          <GalleryTopologyComparison
            source={comparison.source}
            match={comparison.match}
            onClose={() => setComparison(null)}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
