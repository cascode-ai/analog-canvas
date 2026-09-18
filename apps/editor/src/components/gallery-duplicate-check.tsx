import { useEffect, useRef, useState } from "react";
import { galleryPreviewUrl } from "../gallery-client";
import type { GalleryDuplicateReport } from "../gallery-duplicates";
import type { GalleryFeedEntry } from "../gallery-client";
import {
  defaultDuplicateSurvivor,
  recycleDuplicateGroup,
} from "../gallery-duplicate-cleanup";

export function GalleryDuplicateCheck({
  onReport,
  onRecycled,
}: {
  onReport: (report: GalleryDuplicateReport | null) => void;
  onRecycled: (ids: string[]) => void;
}) {
  const worker = useRef<Worker | null>(null);
  const mounted = useRef(true);
  const [report, setReport] = useState<GalleryDuplicateReport | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  const [cleaning, setCleaning] = useState(false);
  const [cleanupErrors, setCleanupErrors] = useState<Record<string, string>>(
    {},
  );
  const [removedCount, setRemovedCount] = useState(0);
  const keepId = (group: GalleryFeedEntry[]) =>
    survivors[group[0]!.id] ?? defaultDuplicateSurvivor(group);
  const clean = async (groups: GalleryFeedEntry[][]) => {
    if (!report?.complete || cleaning || running) return;
    setCleaning(true);
    setCleanupErrors({});
    let remaining = report;
    const removed: string[] = [];
    try {
      for (const group of groups) {
        if (!mounted.current) break;
        try {
          const recycled = await recycleDuplicateGroup(group, keepId(group));
          removed.push(...recycled);
          remaining = {
            ...remaining,
            groups: remaining.groups.filter((item) => item !== group),
          };
          setReport(remaining);
          onReport(remaining);
          setRemovedCount((count) => count + recycled.length);
        } catch (error) {
          setCleanupErrors((errors) => ({
            ...errors,
            [group[0]!.id]:
              error instanceof Error
                ? error.message
                : "Could not remove this group.",
          }));
        }
      }
    } finally {
      if (removed.length > 0) onRecycled(removed);
      setCleaning(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      worker.current?.terminate();
    };
  }, []);
  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
  };
  const start = () => {
    stop();
    setReport(null);
    onReport(null);
    setFailure(null);
    setSurvivors({});
    setCleanupErrors({});
    setRemovedCount(0);
    setOpen(true);
    try {
      const next = new Worker(
        new URL("../gallery-duplicates.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = next;
      setRunning(true);
      next.onmessage = (event: MessageEvent<GalleryDuplicateReport>) => {
        if (worker.current !== next) return;
        setReport(event.data);
        onReport(event.data);
        if (event.data.complete || event.data.error) stop();
      };
      next.onerror = () => {
        stop();
        setFailure("Could not run the duplicate check. Try again.");
      };
      next.postMessage("scan");
    } catch {
      setFailure("Could not start the duplicate check. Try again.");
    }
  };
  const duplicates =
    report?.groups.reduce((sum, group) => sum + group.length - 1, 0) ?? 0;
  const grouped =
    report?.groups.reduce((sum, group) => sum + group.length, 0) ?? 0;
  return (
    <section className="gallery-duplicates" data-testid="gallery-duplicates">
      <div className="gallery-duplicates-actions">
        <button
          type="button"
          className="gallery-tag-option"
          onClick={start}
          disabled={running || cleaning}
          data-testid="gallery-check-duplicates"
        >
          {report ? "Check duplicates again" : "Check duplicates"}
        </button>
        {running ? (
          <button type="button" className="gallery-tag-option" onClick={stop}>
            Cancel
          </button>
        ) : null}
        <span role="status">
          {running
            ? `Checking ${report?.scanned ?? 0}${report?.total != null ? ` / ${report.total}` : ""} circuits…`
            : report
              ? `${report.complete ? "Scan finished" : "Partial scan"}: ${report.scanned} checked · ${duplicates} extra ${duplicates === 1 ? "copy" : "copies"} in ${report.groups.length} ${report.groups.length === 1 ? "group" : "groups"} · ${report.uncheckable.length} unable to compare`
              : null}
        </span>
        {report ? (
          <button
            type="button"
            className="gallery-tag-option"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide results" : "Show results"}
          </button>
        ) : null}
        {report?.complete && duplicates > 0 ? (
          <button
            type="button"
            className="gallery-tag-option"
            disabled={cleaning}
            onClick={() => void clean(report.groups)}
          >
            {cleaning ? "Removing…" : `Remove all extra copies (${duplicates})`}
          </button>
        ) : null}
      </div>
      {removedCount > 0 ? (
        <p role="status">
          Moved {removedCount} {removedCount === 1 ? "circuit" : "circuits"} to
          the recycle bin.{" "}
          <a href="/moderation" target="_blank" rel="noreferrer">
            Open recycle bin
          </a>
        </p>
      ) : null}
      {failure || report?.error ? (
        <p role="alert">{failure ?? report?.error} Results are incomplete.</p>
      ) : null}
      {open ? (
        <div className="gallery-duplicates-results">
          <p>
            Compares netlists across the entire public Gallery, regardless of
            filters. Names and drawing layout are ignored; connections, pin
            roles, ordered ports, models and values must match. Unset values
            match only other unset values.
          </p>
          {report?.groups.length ? (
            <p>
              {grouped} circuits in duplicate groups; {duplicates} extra{" "}
              {duplicates === 1 ? "copy" : "copies"}. Keep the oldest by
              default, or select a different copy. Removed copies go to the
              recycle bin and can be restored.
            </p>
          ) : report?.complete ? (
            <p>
              No remaining duplicates among {report.comparable} comparable
              circuits checked.
            </p>
          ) : null}
          {report?.groups.map((group, index) => (
            <details
              key={group[0]!.id}
              className="gallery-duplicate-group"
              open={index === 0}
            >
              <summary>
                Group {index + 1} · {group.length} circuits · same netlist
                {cleanupErrors[group[0]!.id] ? " · Not removed" : ""}
              </summary>
              <button
                type="button"
                className="gallery-tag-option"
                disabled={!report.complete || running || cleaning}
                onClick={() => void clean([group])}
              >
                Keep selected, remove {group.length - 1}{" "}
                {group.length === 2 ? "copy" : "copies"}
              </button>
              {cleanupErrors[group[0]!.id] ? (
                <p role="alert">{cleanupErrors[group[0]!.id]}</p>
              ) : null}
              <div className="gallery-duplicate-circuits">
                {group.map((entry) => (
                  <div
                    key={entry.id}
                    className="gallery-duplicate-circuit"
                    data-keep={keepId(group) === entry.id}
                  >
                    <label>
                      <input
                        type="radio"
                        name={`keep-${group[0]!.id}`}
                        checked={keepId(group) === entry.id}
                        disabled={running || cleaning}
                        onChange={() =>
                          setSurvivors((current) => ({
                            ...current,
                            [group[0]!.id]: entry.id,
                          }))
                        }
                        aria-label={`Keep ${entry.name}`}
                      />
                      {keepId(group) === entry.id
                        ? "Keep this copy"
                        : "Keep instead"}
                    </label>
                    <a href={`/g/${entry.id}`} target="_blank" rel="noreferrer">
                      <img
                        src={galleryPreviewUrl(entry.id, entry.previewRevision)}
                        alt=""
                        loading="lazy"
                      />
                      <strong>{entry.name}</strong>
                      <span>{entry.author || "Anonymous"}</span>
                    </a>
                  </div>
                ))}
              </div>
            </details>
          ))}
          {report?.uncheckable.length ? (
            <details className="gallery-duplicate-group">
              <summary>Unable to compare · {report.uncheckable.length}</summary>
              <ul>
                {report.uncheckable.map(({ entry, reason }) => (
                  <li key={entry.id}>
                    <a href={`/g/${entry.id}`} target="_blank" rel="noreferrer">
                      {entry.name}
                    </a>{" "}
                    — {reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {report?.complete ? (
            <small>
              Snapshot of the circuits read during this scan. Run again after
              library changes.
            </small>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
