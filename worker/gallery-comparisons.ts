// Dataset comparisons over HTTP: the list /datasets reads, a dataset
// netlist, an original figure, and the Owner's import. Only datasets whose
// figures we may show (`comparisons: true`) answer.

import { gallerySourceOfEntryId, type GallerySource } from "./gallery-sources";
import { ownerImportRefusal, withGalleryStore } from "./gallery-datasets";
import { callGallery } from "./gallery-requests";
import { checkedComparison } from "./gallery-store-comparisons";
import { isRecord, type GalleryEnv } from "./gallery-store";

/** Comparisons one import request may carry. */
const COMPARISON_IMPORT_BATCH = 10;
const NO_STORE = { "cache-control": "no-store" };

/** `/api/gallery/sources/<key>/comparisons[/<id>[/figure]]`. */
export async function routeComparisons(
  request: Request,
  env: GalleryEnv,
  source: GallerySource,
  rest: string[],
): Promise<Response> {
  if (!source.comparisons)
    return Response.json({ error: "not-found" }, { status: 404 });
  const store = withGalleryStore(env, source);
  if (rest.length === 0 && request.method === "POST")
    return importComparisons(request, env, store, source);
  if (request.method !== "GET")
    return Response.json({ error: "not-found" }, { status: 404 });
  if (rest.length === 0) {
    const { payload } = await callGallery<{ comparisons?: unknown[] }>(
      store,
      "comparison-list",
      {},
    );
    return Response.json(
      { source: source.key, comparisons: payload.comparisons ?? [] },
      { headers: NO_STORE },
    );
  }
  const id = rest[0]!;
  if (rest.length === 1) {
    const { status, payload } = await callGallery(store, "comparison-netlist", {
      id,
    });
    return Response.json(payload, { status, headers: NO_STORE });
  }
  if (rest.length === 2 && rest[1] === "figure") {
    const { status, payload } = await callGallery<{
      type?: string;
      data?: string;
      revision?: string;
    }>(store, "comparison-figure", { id });
    if (status !== 200 || !payload.data)
      return Response.json(
        { error: "not-found" },
        { status: 404, headers: NO_STORE },
      );
    const named = new URL(request.url).searchParams.get("v");
    return new Response(
      Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0)),
      {
        headers: {
          "content-type": payload.type ?? "application/octet-stream",
          "x-content-type-options": "nosniff",
          // Readers are signed in, so no shared cache keeps it.
          "cache-control":
            named === payload.revision
              ? "private, max-age=31536000, immutable"
              : "private, no-cache",
          etag: `"${payload.revision}"`,
        },
      },
    );
  }
  return Response.json({ error: "not-found" }, { status: 404 });
}

async function importComparisons(
  request: Request,
  env: GalleryEnv,
  store: GalleryEnv,
  source: GallerySource,
): Promise<Response> {
  const refusal = await ownerImportRefusal(request, env);
  if (refusal) return refusal;
  const body = (await request.json().catch(() => null)) as {
    comparisons?: unknown;
  } | null;
  const items = Array.isArray(body?.comparisons) ? body.comparisons : null;
  if (!items || items.length === 0 || items.length > COMPARISON_IMPORT_BATCH)
    return Response.json({ error: "invalid-fields" }, { status: 400 });
  const results = [];
  for (const item of items) {
    const id = isRecord(item) && typeof item.id === "string" ? item.id : "";
    if (!id || gallerySourceOfEntryId(id)?.key !== source.key) {
      results.push({ id, ok: false, error: "invalid-id" });
      continue;
    }
    const checked = checkedComparison(item as Record<string, unknown>);
    if ("error" in checked) {
      results.push({ id, ok: false, error: checked.error });
      continue;
    }
    const { status, payload } = await callGallery<{
      error?: string;
      created?: boolean;
    }>(store, "comparison-import", { id, ...checked.row });
    results.push(
      status === 200
        ? { id, ok: true, created: payload.created === true }
        : { id, ok: false, error: payload.error ?? `http-${status}` },
    );
  }
  return Response.json({ source: source.key, results });
}
