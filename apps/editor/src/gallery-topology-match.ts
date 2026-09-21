import { requestGalleryScan } from "./gallery-scan-request";
import type { CircuitProject } from "@icm/model";
import {
  compareElectricalTopologies,
  electricalGraphTopologySimilarity,
  projectElectricalGraph,
} from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import type { GalleryFeedEntry } from "./gallery-client";

export interface GalleryTopologyMatch {
  entry: GalleryFeedEntry;
  exact: boolean;
  similarity: number;
}

export interface GalleryTopologyMatchReport {
  scanned: number;
  total: number | null;
  comparable: number;
  matches: GalleryTopologyMatch[];
  uncheckable: number;
  complete: boolean;
  sourceError?: string;
  error?: string;
}

const NEAREST_LIMIT = 5;

/** Compare one current Cell against the whole public Gallery, on demand. */
export async function scanGalleryTopologyMatches(
  project: CircuitProject,
  onProgress: (report: GalleryTopologyMatchReport) => void,
  fetchLike: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<GalleryTopologyMatchReport> {
  const source = projectElectricalGraph(project);
  const report: GalleryTopologyMatchReport = {
    scanned: 0,
    total: null,
    comparable: 0,
    matches: [],
    uncheckable: 0,
    complete: false,
  };
  if (source.status !== "ready") {
    report.sourceError = source.reason;
    report.complete = true;
    onProgress(structuredClone(report));
    return report;
  }

  const candidates: GalleryTopologyMatch[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  const request = (url: string) => requestGalleryScan(url, fetchLike, signal);
  const publish = () => {
    const ordered = [...candidates].sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        right.similarity - left.similarity ||
        left.entry.name.localeCompare(right.entry.name) ||
        left.entry.id.localeCompare(right.entry.id),
    );
    report.matches = [
      ...ordered.filter((item) => item.exact),
      ...ordered.filter((item) => !item.exact).slice(0, NEAREST_LIMIT),
    ];
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
            ) {
              throw new Error("Circuit is no longer publicly available");
            }
            const candidate = projectElectricalGraph(
              parseProject(detail.projectText),
            );
            if (candidate.status !== "ready") throw new Error(candidate.reason);
            const exact = compareElectricalTopologies(
              source.graph,
              candidate.graph,
            );
            if (exact === "unknown")
              throw new Error("Comparison limit reached");
            candidates.push({
              entry: detail.entry ?? entry,
              exact: exact === "equal",
              similarity:
                exact === "equal"
                  ? 1
                  : electricalGraphTopologySimilarity(
                      source.graph,
                      candidate.graph,
                    ),
            });
            report.comparable++;
          } catch {
            report.uncheckable++;
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
