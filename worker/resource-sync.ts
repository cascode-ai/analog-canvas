import { bearerMatches } from "./bearer";
import { OPEN_STREAM_SUFFIX } from "./regional-open-counts";
import { readSyncJson } from "./project-sync-http";
import {
  INTERACTION_STREAM_SUFFIX,
  RESOURCE_MAX_BYTES,
  type ReplicaConfig,
} from "./resource-replica";
import { GALLERY_SOURCES, galleryStoreName } from "./gallery-sources";
type Namespace = {
  getByName(name: string): {
    fetch(url: string, init?: RequestInit): Promise<Response>;
  };
};
export type ResourceSyncEnv = ReplicaConfig & {
  RESOURCE_SYNC_TOKEN?: string;
  RESOURCE_SYNC_ADMIN_TOKEN?: string;
  GALLERY?: Namespace;
  COMPONENT_LIBRARY?: Namespace;
};
export async function routeResourceSync(
  request: Request,
  env: ResourceSyncEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/resource-sync/")) return null;
  const noStore = { "cache-control": "no-store" };
  const refuse = (error: string, status: number) =>
    Response.json({ error }, { status, headers: noStore });
  if (!env.RESOURCE_REGION || !env.RESOURCE_SYNC_TOKEN)
    return refuse("not-found", 404);
  const match =
    /^\/api\/resource-sync\/([a-z0-9-]+)\/(status|changes|seed)$/.exec(
      url.pathname,
    );
  if (!match) return refuse("not-found", 404);
  const stream = match[1]!,
    operation = match[2]!;
  if (
    !bearerMatches(
      request,
      operation === "seed"
        ? env.RESOURCE_SYNC_ADMIN_TOKEN
        : env.RESOURCE_SYNC_TOKEN,
    )
  )
    return refuse("unauthorized", 401);
  // A Gallery store's likes and reviews travel in `<store>-interactions`.
  const interactions = stream.endsWith(INTERACTION_STREAM_SUFFIX);
  const opens = stream.endsWith(OPEN_STREAM_SUFFIX);
  const name = interactions
    ? stream.slice(0, -INTERACTION_STREAM_SUFFIX.length)
    : opens
      ? stream.slice(0, -OPEN_STREAM_SUFFIX.length)
      : stream;
  const source = GALLERY_SOURCES.find((s) => s.key === name);
  const store =
    name === "components" && !interactions && !opens
      ? env.COMPONENT_LIBRARY?.getByName("components")
      : name === "gallery"
        ? env.GALLERY?.getByName("gallery")
        : source
          ? env.GALLERY?.getByName(galleryStoreName(source))
          : undefined;
  if (!store) return refuse("unknown-resource-store", 404);
  if (!(
    (request.method === "GET" && operation !== "seed") ||
    (request.method === "POST" && operation !== "status")
  ))
    return refuse("method-not-allowed", 405);
  try {
    const receiving = operation === "changes" && request.method === "POST";
    const body = {
      stream,
      after: Number(url.searchParams.get("after") ?? 0),
      ...(receiving
        ? { envelope: await readSyncJson(request, RESOURCE_MAX_BYTES * 2) }
        : {}),
    };
    const result = await store.fetch(
      "https://resources/resource-sync/" + (receiving ? "receive" : operation),
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    const response = new Response(result.body, result);
    response.headers.set("cache-control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof RangeError) return refuse("too-large", 413);
    if (error instanceof SyntaxError) return refuse("invalid-json", 400);
    throw error;
  }
}
