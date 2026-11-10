/**
 * The wall's Download button (#2148), in the count's row, the same for
 * every reader, signed out too: one press saves the wall's current results,
 * every public circuit when nothing narrows them, as one .zip of Project
 * files with a manifest. Its count is the wall's own and follows every
 * filter (#2173). A press fixes the query it saves; its progress takes the
 * button's place with a Cancel beside it while the wall stays usable. A
 * complete run saves the file; one with failures saves nothing by itself,
 * says which circuits failed with a Retry and offers the partial package,
 * named so, on its own press. Then the button counts the current wall
 * again. The archive code loads on first use.
 */
import { useEffect, useState } from "react";

import { galleryFeedQueryKey, type GalleryFeedQuery } from "../gallery-client";
import { SITE_USAGE_NOTE } from "../usage-policy-note";
import type {
  GalleryZipFailure,
  GalleryZipProgress,
} from "../gallery-bulk-download";

/** One press: the query it saves, fixed when pressed. */
interface GalleryDownloadJob {
  query: GalleryFeedQuery;
  key: string;
}

export type GalleryDownloadRun =
  | { kind: "idle" }
  | {
      kind: "running";
      job: GalleryDownloadJob;
      /** The count the button showed when pressed, if it had one. */
      total: number | null;
      progress: GalleryZipProgress | null;
      controller: AbortController;
    }
  | {
      kind: "done";
      job: GalleryDownloadJob;
      /** The archive; null when nothing could go in it. */
      url: string | null;
      fileName: string;
      /** Circuits listed, and those in the archive. */
      listed: number;
      count: number;
      failed: GalleryZipFailure[];
    }
  | { kind: "error"; job: GalleryDownloadJob; message: string };

/** The wall's results as one key; its order and seed do not matter. */
function resultsKeyOf(query: GalleryFeedQuery): string {
  return galleryFeedQueryKey({ ...query, order: "newest" });
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />
    </svg>
  );
}

/** The ids a failure lists, a few of them and how many more. */
function failedIds(failed: readonly GalleryZipFailure[]): string {
  const shown = failed.slice(0, 8).map(({ id }) => id);
  return failed.length > shown.length
    ? `${shown.join(", ")} and ${(failed.length - shown.length).toLocaleString()} more`
    : shown.join(", ");
}

/** What a run has done, as the button says it: "32 / 78". */
function progressText(
  run: Extract<GalleryDownloadRun, { kind: "running" }>,
): string {
  const { progress, total } = run;
  if (progress?.phase === "reading")
    return `${progress.done.toLocaleString()} / ${progress.listed.toLocaleString()}`;
  return `0 / ${(total ?? progress?.listed ?? 0).toLocaleString()}`;
}

/**
 * The button and what stands beside it, for one run: the count, the
 * progress with Cancel, or the end with its archive and failures.
 */
export function GalleryDownloadView({
  count,
  pending,
  run,
  onStart,
  onCancel,
  onRetry,
}: {
  /** The wall's results, or the last count while a new one is on its way. */
  count: number | null;
  /** The wall's current results are not counted yet. */
  pending: boolean;
  run: GalleryDownloadRun;
  onStart: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const running = run.kind === "running" ? run : null;
  const label = running
    ? progressText(running)
    : count === null
      ? null
      : count.toLocaleString();
  const description = running
    ? `Downloading ${label} circuits`
    : count === null
      ? "Download circuits as a .zip"
      : `Download ${label} ${count === 1 ? "circuit" : "circuits"} as a .zip`;
  const failed =
    run.kind === "done" && run.failed.length > 0 ? run.failed : null;
  return (
    <div
      className="gallery-download"
      data-testid="gallery-download"
      role="group"
      aria-label="Download circuits"
    >
      <button
        type="button"
        className="gallery-order-button"
        data-testid="gallery-download-button"
        aria-label={description}
        title={description}
        aria-busy={pending || running !== null}
        disabled={running !== null || pending || !count}
        onClick={onStart}
      >
        <DownloadIcon />
        {running ? null : (
          <span className="gallery-download-label">Download</span>
        )}
        {label === null ? null : (
          <span
            className="gallery-download-count"
            data-testid={running ? "gallery-download-progress" : undefined}
          >
            {label}
          </span>
        )}
      </button>
      {running ? (
        <button
          type="button"
          className="gallery-download-aside"
          data-testid="gallery-download-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      ) : run.kind === "done" ? (
        <span className="gallery-download-aside" role="status">
          {failed ? (
            <>
              <span
                className="gallery-download-error"
                data-testid="gallery-download-failed"
                title={`Not saved: ${failedIds(failed)}`}
              >
                {failed.length.toLocaleString()} failed
              </span>
              {" · "}
              <button
                type="button"
                data-testid="gallery-download-retry"
                onClick={onRetry}
              >
                Retry
              </button>
              {/* A partial package only on its own, plainly named press. */}
              {run.url ? (
                <>
                  {" · "}
                  <a
                    href={run.url}
                    download={run.fileName}
                    data-testid="gallery-download-partial"
                    title={`${run.fileName}: the missing circuits are listed in manifest.json`}
                  >
                    Download partial ZIP ({run.count.toLocaleString()} of{" "}
                    {run.listed.toLocaleString()})
                  </a>
                </>
              ) : null}
            </>
          ) : run.url ? (
            <a
              href={run.url}
              download={run.fileName}
              data-testid="gallery-download-file"
              title={`${run.fileName}: ${run.count.toLocaleString()} ${run.count === 1 ? "circuit" : "circuits"}`}
            >
              Download ZIP
            </a>
          ) : (
            <span data-testid="gallery-download-nothing">Nothing matched</span>
          )}
        </span>
      ) : run.kind === "error" ? (
        <span className="gallery-download-aside" role="status">
          <span
            className="gallery-download-error"
            data-testid="gallery-download-error"
            title={run.message}
          >
            Failed
          </span>
          {" · "}
          <button
            type="button"
            data-testid="gallery-download-retry"
            onClick={onRetry}
          >
            Retry
          </button>
        </span>
      ) : null}
    </div>
  );
}

export function GalleryDownloadButton({
  query,
  count,
  pending,
  hidden = false,
}: {
  /** The wall's own query; its order does not matter. */
  query: GalleryFeedQuery;
  count: number | null;
  pending: boolean;
  /** Off the community wall; a running download still shows. */
  hidden?: boolean;
}) {
  const [run, setRun] = useState<GalleryDownloadRun>({ kind: "idle" });
  const resultsKey = resultsKeyOf(query);

  // A saved archive's address lives until the next run, another wall or
  // the wall closing.
  const savedUrl = run.kind === "done" ? run.url : null;
  useEffect(
    () => () => {
      if (savedUrl) URL.revokeObjectURL(savedUrl);
    },
    [savedUrl],
  );
  const running = run.kind === "running" ? run.controller : null;
  useEffect(() => () => running?.abort(), [running]);
  // An ended run speaks of its own query; other filters end what it says.
  const ended = run.kind === "done" || run.kind === "error";
  const stale = ended && run.job.key !== resultsKey;
  useEffect(() => {
    if (stale) setRun({ kind: "idle" });
  }, [stale]);

  async function start(job: GalleryDownloadJob): Promise<void> {
    const controller = new AbortController();
    setRun({
      kind: "running",
      job,
      total: job.key === resultsKey ? count : null,
      progress: null,
      controller,
    });
    try {
      const { downloadGalleryZip } = await import("../gallery-bulk-download");
      const result = await downloadGalleryZip(job.query, {
        signal: controller.signal,
        usage: SITE_USAGE_NOTE,
        onProgress: (progress) =>
          setRun((previous) =>
            previous.kind === "running" && previous.controller === controller
              ? { ...previous, progress }
              : previous,
          ),
      });
      const url = result.zip ? URL.createObjectURL(result.zip) : null;
      // Only a complete package saves itself; a partial one waits for its
      // own press (#2148).
      if (url && result.failed.length === 0) {
        const link = document.createElement("a");
        link.href = url;
        link.download = result.fileName;
        link.click();
      }
      setRun({
        kind: "done",
        job,
        url,
        fileName: result.fileName,
        listed: result.listed,
        count: result.count,
        failed: result.failed,
      });
    } catch (error) {
      setRun(
        controller.signal.aborted
          ? { kind: "idle" }
          : {
              kind: "error",
              job,
              message:
                error instanceof Error ? error.message : "The download failed.",
            },
      );
    }
  }

  if (hidden && run.kind !== "running") return null;
  return (
    <GalleryDownloadView
      count={count}
      pending={pending}
      run={stale ? { kind: "idle" } : run}
      onStart={() => void start({ query, key: resultsKey })}
      onCancel={() => {
        if (run.kind === "running") run.controller.abort();
      }}
      onRetry={() => {
        if (run.kind === "done" || run.kind === "error") void start(run.job);
      }}
    />
  );
}
