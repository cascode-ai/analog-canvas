/**
 * The wall's Download menu (#2148), right of the count, the same for every
 * reader, signed out too: the wall's current results, or every public
 * circuit, as one .zip of Project files with a manifest. Each choice says
 * how many circuits it holds before it starts; a running download shows its
 * progress, here and on the button, and can be cancelled; the end says what
 * was saved and which circuits failed. The archive code loads on first use.
 */
import { useEffect, useRef, useState } from "react";

import { useDismissDetails } from "./dismiss-details";

import {
  galleryFeedQueryKey,
  loadGalleryFeed,
  type GalleryFeedQuery,
} from "../gallery-client";
import { isRequestFailure } from "../request-failure";
import { SITE_USAGE_NOTE } from "../usage-policy-note";
import type {
  GalleryZipFailure,
  GalleryZipProgress,
} from "../gallery-bulk-download";

type Scope = "results" | "all";

type Run =
  | { kind: "idle" }
  | {
      kind: "running";
      total: number | null;
      progress: GalleryZipProgress | null;
      controller: AbortController;
    }
  | {
      kind: "saved";
      count: number;
      failed: GalleryZipFailure[];
      url: string;
      fileName: string;
    }
  | { kind: "nothing"; failed: GalleryZipFailure[] }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/** A count still loading, known, or not to be had. */
type Count = number | "loading" | "unknown";

const EVERYTHING: GalleryFeedQuery = {};

function circuits(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "circuit" : "circuits"}`;
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

export function GalleryDownloadMenu({
  query,
  hidden = false,
}: {
  /** The wall's own query; its order does not matter. */
  query: GalleryFeedQuery;
  /** Off the community wall; a running download still shows. */
  hidden?: boolean;
}) {
  const rootRef = useRef<HTMLDetailsElement | null>(null);
  useDismissDetails(rootRef);
  const [run, setRun] = useState<Run>({ kind: "idle" });
  const [counts, setCounts] = useState<{
    key: string;
    results: Count;
    all: Count;
  } | null>(null);
  // Its seed counts only in a random order.
  const resultsKey = galleryFeedQueryKey({ ...query, order: "newest" });
  // An unfiltered wall's results are everything: one choice, not two.
  const narrowed = resultsKey !== "";

  // A saved archive's address lives until the next run or the wall closes.
  const savedUrl = run.kind === "saved" ? run.url : null;
  useEffect(
    () => () => {
      if (savedUrl) URL.revokeObjectURL(savedUrl);
    },
    [savedUrl],
  );
  const running = run.kind === "running" ? run.controller : null;
  useEffect(() => () => running?.abort(), [running]);

  function countWhenOpened(): void {
    if (!rootRef.current?.open || counts?.key === resultsKey) return;
    const key = resultsKey;
    setCounts({ key, results: "loading", all: "loading" });
    const total = async (scope: GalleryFeedQuery): Promise<Count> => {
      const page = await loadGalleryFeed(fetch, { ...scope, limit: 1 });
      return isRequestFailure(page) || page.total === null
        ? "unknown"
        : page.total;
    };
    void Promise.all([
      narrowed ? total(query) : Promise.resolve<Count>("unknown"),
      total(EVERYTHING),
    ]).then(([results, all]) =>
      setCounts((previous) =>
        previous?.key === key
          ? { key, results: narrowed ? results : all, all }
          : previous,
      ),
    );
  }

  async function start(scope: Scope): Promise<void> {
    const controller = new AbortController();
    const count = scope === "results" ? counts?.results : counts?.all;
    setRun({
      kind: "running",
      total: typeof count === "number" ? count : null,
      progress: null,
      controller,
    });
    try {
      const { downloadGalleryZip } = await import("../gallery-bulk-download");
      const result = await downloadGalleryZip(
        scope === "results" ? query : EVERYTHING,
        {
          signal: controller.signal,
          usage: SITE_USAGE_NOTE,
          onProgress: (progress) =>
            setRun((previous) =>
              previous.kind === "running" && previous.controller === controller
                ? { ...previous, progress }
                : previous,
            ),
        },
      );
      if (!result.zip) {
        setRun({ kind: "nothing", failed: result.failed });
        return;
      }
      const url = URL.createObjectURL(result.zip);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      setRun({
        kind: "saved",
        count: result.count,
        failed: result.failed,
        url,
        fileName: result.fileName,
      });
    } catch (error) {
      setRun(
        controller.signal.aborted
          ? { kind: "cancelled" }
          : {
              kind: "error",
              message:
                error instanceof Error ? error.message : "The download failed.",
            },
      );
    }
  }

  const choice = (scope: Scope, heading: string) => {
    const count = counts?.[scope] ?? "loading";
    return (
      <>
        <span className="gallery-order-group">{heading}</span>
        {count === 0 ? (
          <p
            className="gallery-download-note"
            data-testid={`gallery-download-${scope}-empty`}
          >
            {scope === "results"
              ? "No circuits match these filters."
              : "No public circuits yet."}
          </p>
        ) : (
          <button
            type="button"
            data-testid={`gallery-download-${scope}`}
            disabled={run.kind === "running"}
            onClick={() => void start(scope)}
          >
            <DownloadIcon />
            {count === "loading"
              ? "Counting circuits…"
              : count === "unknown"
                ? "Download circuits (.zip)"
                : `Download ${circuits(count)} (.zip)`}
          </button>
        )}
      </>
    );
  };

  const progress = run.kind === "running" ? run.progress : null;
  const total =
    run.kind === "running"
      ? progress?.phase === "reading"
        ? progress.listed
        : run.total
      : null;
  const progressText =
    run.kind !== "running"
      ? null
      : progress?.phase === "reading"
        ? `${progress.done.toLocaleString()} / ${progress.listed.toLocaleString()}`
        : `Listing ${(progress?.listed ?? 0).toLocaleString()}${
            total === null ? "" : ` / ${total.toLocaleString()}`
          }`;

  return (
    <details
      ref={rootRef}
      className="gallery-download-menu"
      data-testid="gallery-download-menu"
      hidden={hidden && run.kind !== "running"}
      onToggle={countWhenOpened}
    >
      <summary
        className="gallery-order-button"
        data-testid="gallery-download-button"
        aria-label={
          progressText ? `Downloading ${progressText}` : "Download circuits"
        }
        title={
          progressText
            ? `Downloading ${progressText}`
            : "Download circuits as a .zip"
        }
      >
        <DownloadIcon />
        <span className="gallery-download-label">
          {progressText ?? "Download"}
        </span>
      </summary>
      <div
        className="gallery-order-popover gallery-download-popover"
        role="group"
        aria-label="Download circuits"
      >
        {narrowed ? choice("results", "These results") : null}
        {choice("all", narrowed ? "Everything" : "All public circuits")}
        {run.kind === "running" ? (
          <div className="gallery-download-status" role="status">
            <span data-testid="gallery-download-progress">
              {progress?.phase === "reading"
                ? `Downloading ${progressText}`
                : `${progressText}…`}
              {progress?.failed
                ? ` · ${progress.failed.toLocaleString()} failed`
                : ""}
            </span>
            <progress
              max={progress?.phase === "reading" ? progress.listed : 1}
              value={progress?.phase === "reading" ? progress.done : undefined}
            />
            <button
              type="button"
              data-testid="gallery-download-cancel"
              onClick={() => run.controller.abort()}
            >
              Cancel
            </button>
          </div>
        ) : run.kind === "idle" ? null : (
          <div
            className="gallery-download-status"
            role="status"
            data-testid="gallery-download-result"
          >
            {run.kind === "saved" ? (
              <span>
                Saved {circuits(run.count)} as{" "}
                <a href={run.url} download={run.fileName}>
                  {run.fileName}
                </a>
                .
              </span>
            ) : run.kind === "nothing" ? (
              <span>
                {run.failed.length > 0
                  ? "Nothing was saved."
                  : "No circuits matched; nothing was saved."}
              </span>
            ) : run.kind === "cancelled" ? (
              <span>Cancelled; nothing was saved.</span>
            ) : (
              <span className="gallery-download-error">{run.message}</span>
            )}
            {(run.kind === "saved" || run.kind === "nothing") &&
            run.failed.length > 0 ? (
              <span
                className="gallery-download-error"
                data-testid="gallery-download-failed"
              >
                {run.failed.length.toLocaleString()} failed:{" "}
                {failedIds(run.failed)}
                {run.kind === "saved" ? " (listed in manifest.json)" : ""}.
              </span>
            ) : null}
          </div>
        )}
        <p className="gallery-download-note">
          One Project file per circuit, which File → Open reads, and a
          manifest.json. Dataset circuits keep their dataset's license.
        </p>
      </div>
    </details>
  );
}
