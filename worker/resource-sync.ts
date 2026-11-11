import { bearerMatches } from "./bearer";
import { PROFILE_BYLINE_TICK } from "./profile-bylines";
import { OPEN_STREAM_SUFFIX } from "./regional-open-counts";
import { ACTIVITY_STREAM_SUFFIX } from "./regional-activity";
import { readSyncJson } from "./project-sync-http";
import {
  INTERACTION_STREAM_SUFFIX,
  RESOURCE_MAX_BYTES,
  type ReplicaConfig,
} from "./resource-replica";
import {
  GALLERY_SOURCES,
  galleryStoreName,
  gallerySourceOfEntryId,
} from "./gallery-sources";
type Namespace = {
  getByName(name: string): {
    fetch(url: string, init?: RequestInit): Promise<Response>;
  };
};
export type ResourceSyncEnv = ReplicaConfig & {
  RESOURCE_SYNC_TOKEN?: string;
  RESOURCE_SYNC_ADMIN_TOKEN?: string;
  AUTH?: Namespace;
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
  if (url.pathname === "/api/resource-sync/bylines/run") {
    if (!bearerMatches(request, env.RESOURCE_SYNC_ADMIN_TOKEN))
      return refuse("unauthorized", 401);
    if (request.method !== "POST") return refuse("method-not-allowed", 405);
    if (!env.AUTH) return refuse("byline-unavailable", 503);
    try {
      const result = await env.AUTH.getByName("auth").fetch(
        "https://auth" + PROFILE_BYLINE_TICK,
        { method: "POST" },
      );
      const response = new Response(result.body, result);
      response.headers.set("cache-control", "no-store");
      return response;
    } catch {
      return refuse("byline-unavailable", 503);
    }
  }
  const match =
    /^\/api\/resource-sync\/([a-z0-9-]+)\/(status|changes|seed|location)$/.exec(
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
  const activity = stream.endsWith(ACTIVITY_STREAM_SUFFIX);
  const name = interactions
    ? stream.slice(0, -INTERACTION_STREAM_SUFFIX.length)
    : opens
      ? stream.slice(0, -OPEN_STREAM_SUFFIX.length)
      : activity
        ? stream.slice(0, -ACTIVITY_STREAM_SUFFIX.length)
        : stream;
  const source = GALLERY_SOURCES.find((s) => s.key === name);
  const store =
    name === "components" && !interactions && !opens && !activity
      ? env.COMPONENT_LIBRARY?.getByName("components")
      : name === "gallery"
        ? env.GALLERY?.getByName("gallery")
        : source
          ? env.GALLERY?.getByName(galleryStoreName(source))
          : undefined;
  if (!store) return refuse("unknown-resource-store", 404);
  let id: string | null = null;
  if (operation === "location") {
    if (!source || interactions || opens) return refuse("not-found", 404);
    id = url.searchParams.get("id");
    if (
      !id ||
      gallerySourceOfEntryId(id)?.key !== source.key ||
      [...url.searchParams.keys()].length !== 1
    )
      return refuse("invalid-resource-id", 400);
    if (request.method !== "GET") return refuse("method-not-allowed", 405);
  }

  if (!(
    (request.method === "GET" && operation !== "seed") ||
    (request.method === "POST" && operation !== "status")
  ))
    return refuse("method-not-allowed", 405);
  try {
    const receiving = operation === "changes" && request.method === "POST";
    const body = {
      stream,
      ...(id ? { id } : {}),
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
