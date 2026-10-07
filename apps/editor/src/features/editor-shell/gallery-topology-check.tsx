import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react";
import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { galleryPreviewUrl } from "../../gallery-client";
import { getGalleryTopologyTask } from "./gallery-topology-task";
import type { GalleryTopologyMatch } from "../../gallery-topology-match";
const GalleryTopologyComparison = lazy(
  () => import("./gallery-topology-comparison"),
);

// Compare portable content, not page-local object identity. Revision counters
// advance on undo/reload but do not change the drawing being checked.
function comparisonContent(project: CircuitProject): string {
  return serializeProject({
    ...project,
    structureRevision: 0,
    documents: project.documents.map((document) => ({
      ...document,
      revision: 0,
    })),
  });
}

export function GalleryTopologyCheck({
  project,
  openedFromCheckNotice = false,
}: {
  project: CircuitProject;
  /** Opened from the check's own notice: show its results, whatever it checked. */
  openedFromCheckNotice?: boolean;
}) {
  const galleryTopologyTask = getGalleryTopologyTask();
  const [comparison, setComparison] = useState<{
    source: CircuitProject;
    match: GalleryTopologyMatch;
  } | null>(null);
  const { report, running, failure, snapshot, durable } = useSyncExternalStore(
    galleryTopologyTask.subscribe,
    galleryTopologyTask.getSnapshot,
    galleryTopologyTask.getSnapshot,
  );
  const currentContent = useMemo(() => comparisonContent(project), [project]);
  const snapshotContent = useMemo(
    () => snapshot && comparisonContent(snapshot),
    [snapshot],
  );
  const otherCell =
    !!snapshot &&
    (snapshot.id !== project.id ||
      snapshot.topDocumentId !== project.topDocumentId);
  const historical =
    !!snapshot && (otherCell || snapshotContent !== currentContent);
  // Results for another Project or Cell answer nothing about this one, so
  // they are not shown unless asked for from the check's notice; an edited
  // Cell's stay, marked as historical.
  const shown = otherCell && !openedFromCheckNotice ? null : report;
  const start = () => galleryTopologyTask.start(project);
  const stop = () => galleryTopologyTask.cancel();

  const exactCount =
    shown?.exactMatches ??
    shown?.matches.filter((match) => match.exact).length ??
    0;
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
          {shown ? "Check Again" : "Check Duplicate"}
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
      {snapshot && durable === false ? (
        <p className="publish-duplicate-message">
          Local development check: keep this page open. Durable checks require
          the hosted backend.
        </p>
      ) : null}
      {shown?.omittedMatches ? (
        <p className="publish-duplicate-message">
          Showing the best {shown.matches.length} results;{" "}
          {shown.omittedMatches} lower-ranked results omitted.
        </p>
      ) : null}
      {shown?.limitedComparisons ? (
        <p className="publish-duplicate-message">
          {shown.limitedComparisons} comparisons reached the search budget.
          Unconfirmed results are not proof of a different topology.
        </p>
      ) : null}
      {snapshot && historical ? (
        <p
          className="publish-duplicate-message"
          data-testid="gallery-topology-snapshot"
        >
          {otherCell && shown
            ? `Historical check for another Project or Cell: “${snapshot.name}”. Click Check Again to check this Cell.`
            : otherCell
              ? `The last check was for another Project or Cell, “${snapshot.name}”; its results are not shown here. Click Check Duplicate to check this Cell.`
              : `Canvas changed. Historical results use “${snapshot.name}” captured when you clicked Check Duplicate. Click Check Again to check the current Cell.`}
        </p>
      ) : null}
      <span role="status" className="publish-duplicate-status">
        {running
          ? `Comparing ${report?.scanned ?? 0}${report?.total != null ? ` / ${report.total}` : ""} Gallery circuits${otherCell && snapshot ? ` for “${snapshot.name}”` : ""}…`
          : shown?.complete && !shown.sourceError
            ? exactCount > 0
              ? `${exactCount} exact topology ${exactCount === 1 ? "match" : "matches"}; ${shown.comparable} comparable circuits checked.`
              : `No confirmed exact match; ${shown.comparable} comparable circuits checked.`
            : null}
      </span>
      {shown?.uncheckable ? (
        <p className="publish-duplicate-message">
          {shown.uncheckable} circuits could not be fully compared.
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="publish-duplicate-message">
          {failure}
        </p>
      ) : null}
      {shown?.sourceError || shown?.error ? (
        <p
          role={historical ? undefined : "alert"}
          className="publish-duplicate-message"
        >
          {historical
            ? "Historical check only — not a current validation error: "
            : ""}
          {shown.sourceError ?? shown.error}
        </p>
      ) : null}
      {shown?.complete && !shown.sourceError && shown.matches.length === 0 ? (
        <p className="publish-duplicate-message">
          No comparable Gallery circuits were found.
        </p>
      ) : null}
      {shown?.matches.length ? (
        <div
          className="publish-duplicate-results"
          data-testid="gallery-topology-results"
        >
          {shown.matches.map((match) => (
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
      {shown?.matches.length ? (
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
