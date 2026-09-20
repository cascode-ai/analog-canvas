import { requestGalleryScan } from "./gallery-scan-request";
import {
  compareElectricalGraphs,
  projectElectricalGraph,
  type ElectricalGraph,
} from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import type { GalleryFeedEntry } from "./gallery-client";

export interface GalleryDuplicateReport {
  scanned: number;
  total: number | null;
  comparable: number;
  groups: GalleryFeedEntry[][];
  uncheckable: Array<{ entry: GalleryFeedEntry; reason: string }>;
  complete: boolean;
  error?: string;
}

/** A read-only full public-library scan, deliberately independent of UI filters. */
export async function scanGalleryDuplicates(
  onProgress: (report: GalleryDuplicateReport) => void,
  fetchLike: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<GalleryDuplicateReport> {
  const report: GalleryDuplicateReport = {
    scanned: 0,
    total: null,
    comparable: 0,
    groups: [],
    uncheckable: [],
    complete: false,
  };
  const buckets = new Map<
    string,
    Array<{ graph: ElectricalGraph; entries: GalleryFeedEntry[] }>
  >();
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  const request = (url: string) => requestGalleryScan(url, fetchLike, signal);
  const publish = () => {
    report.groups = [...buckets.values()].flatMap((bucket) =>
      bucket
        .filter((item) => item.entries.length > 1)
        .map((item) => item.entries),
    );
    onProgress(structuredClone(report));
  };
  try {
    do {
      signal?.throwIfAborted();
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const page = (await request(`/api/gallery?${query}`)) as {
        entries: GalleryFeedEntry[];
        total?: number;
        nextCursor?: string | null;
      };
      if (!Array.isArray(page.entries))
        throw new Error("Invalid Gallery response");
      report.total = page.total ?? report.total;
      // Bound network concurrency and retain deterministic processing order.
      for (let offset = 0; offset < page.entries.length; offset += 3) {
        const batch = page.entries
          .slice(offset, offset + 3)
          .filter((entry) => !seen.has(entry.id));
        const payloads = await Promise.allSettled(
          batch.map((entry) =>
            request(`/api/gallery/${encodeURIComponent(entry.id)}`),
          ),
        );
        for (const [index, entry] of batch.entries()) {
          signal?.throwIfAborted();
          if (seen.has(entry.id)) continue;
          seen.add(entry.id);
          report.scanned++;
          try {
            const payload = payloads[index]!;
            if (payload.status === "rejected") throw payload.reason;
            const detail = payload.value as {
              projectText?: string;
              status?: string;
              entry?: GalleryFeedEntry;
            };
            if (
              detail.status !== "public" ||
              typeof detail.projectText !== "string"
            )
              throw new Error("Circuit is no longer publicly available");
            if (
              entry.previewRevision &&
              detail.entry?.previewRevision !== entry.previewRevision
            )
              throw new Error("Circuit changed during scanning; scan again");
            const result = projectElectricalGraph(
              parseProject(detail.projectText),
            );
            if (result.status !== "ready") throw new Error(result.reason);
            const bucket = buckets.get(result.graph.bucket) ?? [];
            let match: (typeof bucket)[number] | undefined;
            for (const candidate of bucket) {
              const comparison = compareElectricalGraphs(
                result.graph,
                candidate.graph,
              );
              if (comparison === "unknown")
                throw new Error(
                  "Comparison limit reached; needs manual review",
                );
              if (comparison === "equal") {
                match = candidate;
                break;
              }
            }
            if (match) match.entries.push(entry);
            else {
              bucket.push({ graph: result.graph, entries: [entry] });
              buckets.set(result.graph.bucket, bucket);
            }
            report.comparable++;
          } catch (error) {
            report.uncheckable.push({
              entry,
              reason:
                error instanceof Error
                  ? error.message
                  : "Could not compare this circuit",
            });
          }
        }
        publish();
      }
      cursor = page.nextCursor ?? null;
      if (cursor && cursors.has(cursor))
        throw new Error("Gallery pagination did not advance");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    report.complete = true;
  } catch (error) {
    if (signal?.aborted) throw error;
    report.error = error instanceof Error ? error.message : "Scan interrupted";
  }
  publish();
  return report;
}
