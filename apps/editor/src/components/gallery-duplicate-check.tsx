import { useEffect, useRef, useState } from "react";
import { galleryPreviewUrl } from "../gallery-client";
import type { GalleryDuplicateReport } from "../gallery-duplicates";

export function GalleryDuplicateCheck({
  onReport,
}: {
  onReport: (report: GalleryDuplicateReport | null) => void;
}) {
  const worker = useRef<Worker | null>(null);
  const [report, setReport] = useState<GalleryDuplicateReport | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
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
          disabled={running}
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
      </div>
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
              {duplicates === 1 ? "copy" : "copies"}. Nothing is deleted.
            </p>
          ) : report?.complete ? (
            <p>
              No duplicates found among {report.comparable} comparable circuits.
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
              </summary>
              <div className="gallery-duplicate-circuits">
                {group.map((entry) => (
                  <a
                    key={entry.id}
                    href={`/g/${entry.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={galleryPreviewUrl(entry.id, entry.previewRevision)}
                      alt=""
                      loading="lazy"
                    />
                    <strong>{entry.name}</strong>
                    <span>{entry.author || "Anonymous"}</span>
                  </a>
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
