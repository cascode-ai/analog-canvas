import { readComponentWrite } from "./component-write-request";
import { sessionUserOf, type AuthNamespaceLike } from "./auth";
import {
  COMPONENT_LIBRARY_ID,
  COMPONENT_PREVIEW_BATCH_LIMIT,
} from "../apps/editor/src/features/user-components/component-library-contract";
export { ComponentLibraryDO } from "./component-library-do";

export interface ComponentLibraryEnv {
  COMPONENT_LIBRARY?: {
    getByName(name: string): {
      fetch(input: string, init?: RequestInit): Promise<Response>;
    };
  };
  AUTH?: AuthNamespaceLike;
}

export async function routeComponentLibraryRequest(
  request: Request,
  env: ComponentLibraryEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    url.pathname !== "/api/components" &&
    !url.pathname.startsWith("/api/components/")
  )
    return null;
  if (!env.COMPONENT_LIBRARY)
    return Response.json(
      { error: "Shared component library is unavailable" },
      { status: 503 },
    );
  const id = url.pathname.slice("/api/components/".length);
  const isList = url.pathname === "/api/components";
  if (!isList && !COMPONENT_LIBRARY_ID.test(id))
    return Response.json({ error: "Invalid component ID" }, { status: 400 });
  const call = (operation: string, body: Record<string, unknown>) =>
    env
      .COMPONENT_LIBRARY!.getByName("components")
      .fetch(`https://components/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
  if (request.method === "GET") {
    const deleted = url.searchParams.get("status") === "deleted";
    const user = await sessionUserOf(request, env);
    const admin = user?.isAdmin === true;
    if (deleted && !user)
      return Response.json(
        { error: "Sign in to manage deleted components" },
        { status: 403 },
      );
    if (isList && url.searchParams.get("view") === "previews") {
      const items = (url.searchParams.get("ids") ?? "")
        .split(",")
        .filter(Boolean)
        .map((item) => {
          const at = item.lastIndexOf(":");
          return {
            id: item.slice(0, at),
            revision: Number(item.slice(at + 1)),
          };
        });
      if (
        !items.length ||
        items.length > COMPONENT_PREVIEW_BATCH_LIMIT ||
        items.some(
          ({ id, revision }) =>
            !COMPONENT_LIBRARY_ID.test(id) ||
            !Number.isSafeInteger(revision) ||
            revision < 1,
        )
      )
        return Response.json(
          { error: "Invalid preview list" },
          { status: 400 },
        );
      return call("previews", { items, admin, userId: user?.id });
    }
    return isList
      ? call("list", {
          query: (url.searchParams.get("q") ?? "").slice(0, 100),
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit"),
          deleted,
          ownerOnly: deleted && !admin,
          userId: user?.id,
          summary: url.searchParams.get("view") === "summary",
          ...(url.searchParams.has("catalog")
            ? {
                catalog: {
                  version: Number(url.searchParams.get("catalog")),
                  type: url.searchParams.get("type") ?? "all",
                  order: url.searchParams.get("order") ?? "circuit-first",
                  ...(url.searchParams.has("author")
                    ? { authorId: url.searchParams.get("author") }
                    : {}),
                },
                ...(url.searchParams.has("since")
                  ? { ifCatalogRevision: Number(url.searchParams.get("since")) }
                  : {}),
              }
            : {}),
        })
      : call("get", {
          id,
          admin,
          userId: user?.id,
          preview: url.searchParams.get("view") === "preview",
          identity: url.searchParams.get("view") === "identity",
          revision: Number(url.searchParams.get("revision")),
        });
  }
  if (!new Set(["PUT", "PATCH"]).has(request.method) || isList)
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (
    (origin && origin !== url.origin) ||
    (site && !["same-origin", "none"].includes(site))
  )
    return Response.json(
      { error: "Cross-origin writes are forbidden" },
      { status: 403 },
    );
  const user = await sessionUserOf(request, env);
  if (!user)
    return Response.json(
      { error: "Sign in to save a component to the public library" },
      { status: 401 },
    );
  const body = await readComponentWrite(request);
  if (body instanceof Response) return body;
  return call(request.method === "PUT" ? "save" : "status", {
    id,
    revision: body.revision,
    definition: body.definition,
    circuit: body.circuit,
    status: body.status,
    action: body.action,
    userId: user.id,
    author: user.displayName,
    admin: user.isAdmin === true,
    idempotencyKey: body.idempotencyKey,
  });
}
