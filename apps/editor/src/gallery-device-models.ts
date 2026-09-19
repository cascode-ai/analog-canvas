import { parseProject, serializeProject } from "@icm/project-protocol";
import { executeProjectTransaction } from "@icm/edit-engine";
import type { GalleryFeedEntry } from "./gallery-client";
import { planNetlistProcess } from "./features/netlist-export/netlist-process";
import type { NetlistExportProfile } from "./features/netlist-export/netlist-process-presets";

export interface GalleryDeviceModelReport {
  scanned: number;
  total: number | null;
  filled: number;
  instances: number;
  failures: Array<{ id: string; name: string; message: string }>;
  complete: boolean;
  error?: string;
}

/**
 * Give every stored circuit the models its devices never got.
 *
 * This is the editor's own "Fill devices" plan run over the library: for each
 * circuit it writes only what is missing — a model for a device that has none,
 * and the dimensions the process template carries with it — and leaves every
 * authored model, dimension and value exactly as its author left it. A circuit
 * with nothing missing is read and put down again untouched.
 *
 * Writing goes through the ordinary entry update, so the server re-renders the
 * preview, re-answers the netlist mark, and keeps the original byline.
 */
export async function fillGalleryDeviceModels(
  profile: NetlistExportProfile,
  onProgress: (report: GalleryDeviceModelReport) => void,
  fetchLike: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<GalleryDeviceModelReport> {
  const report: GalleryDeviceModelReport = {
    scanned: 0,
    total: null,
    filled: 0,
    instances: 0,
    failures: [],
    complete: false,
  };
  const publish = () => onProgress(structuredClone(report));
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  const read = async (url: string) => {
    const timeout = AbortSignal.timeout(15_000);
    const response = await fetchLike(url, {
      credentials: "same-origin",
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok)
      throw new Error(`Could not read Gallery (${response.status})`);
    return response.json() as Promise<unknown>;
  };
  try {
    do {
      signal?.throwIfAborted();
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const page = (await read(`/api/gallery?${query}`)) as {
        entries?: GalleryFeedEntry[];
        total?: number;
        nextCursor?: string | null;
      };
      if (!Array.isArray(page.entries))
        throw new Error("Invalid Gallery response");
      report.total = page.total ?? report.total;
      for (const entry of page.entries) {
        signal?.throwIfAborted();
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        report.scanned += 1;
        try {
          const detail = (await read(
            `/api/gallery/${encodeURIComponent(entry.id)}`,
          )) as {
            projectText?: string;
            status?: string;
            entry?: GalleryFeedEntry;
          };
          if (
            detail.status !== "public" ||
            typeof detail.projectText !== "string"
          )
            throw new Error("Circuit is no longer publicly available");
          const project = parseProject(detail.projectText);
          const edits = planNetlistProcess(project, profile, {
            onlyMissing: true,
          });
          if (edits.length === 0) {
            publish();
            continue;
          }
          const instances = new Set<string>();
          for (const edit of edits) {
            if (edit.kind !== "transact_document") continue;
            for (const item of edit.edits) {
              if (item.kind === "set_instance_netlist")
                instances.add(item.instanceId);
              if (item.kind === "bulk_patch_instance_netlist")
                for (const assignment of item.assignments)
                  instances.add(assignment.instanceId);
            }
          }
          const result = executeProjectTransaction(project, {
            transactionId: `gallery-device-models-${entry.id}`,
            projectId: project.id,
            expectedStructureRevision: project.structureRevision,
            actor: { kind: "human", id: "gallery-maintenance" },
            edits,
          });
          if (!result.ok) throw new Error(result.error.message);
          const update = await fetchLike(
            `/api/gallery/${encodeURIComponent(entry.id)}`,
            {
              method: "PUT",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: detail.entry?.name ?? entry.name,
                description: detail.entry?.description ?? entry.description,
                tags: detail.entry?.tags ?? entry.tags,
                projectText: serializeProject(result.project),
              }),
              ...(signal ? { signal } : {}),
            },
          );
          if (!update.ok)
            throw new Error(`Could not update the circuit (${update.status})`);
          report.filled += 1;
          report.instances += instances.size;
        } catch (error) {
          if (signal?.aborted) throw error;
          report.failures.push({
            id: entry.id,
            name: entry.name,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        publish();
      }
      cursor = page.nextCursor ?? null;
      if (cursor && cursors.has(cursor))
        throw new Error("Gallery paging repeated itself");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    report.complete = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  publish();
  return report;
}
