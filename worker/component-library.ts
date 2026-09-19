import { sessionUserOf, type AuthNamespaceLike } from "./auth";
import {
  COMPONENT_DEFINITION_MAX_BYTES,
  COMPONENT_LIBRARY_ID,
  parseSharedDefinition,
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
    const admin = deleted
      ? (await sessionUserOf(request, env))?.isAdmin === true
      : false;
    if (deleted && !admin)
      return Response.json(
        { error: "Administrator access required" },
        { status: 403 },
      );
    return isList
      ? call("list", {
          query: (url.searchParams.get("q") ?? "").slice(0, 100),
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit"),
          deleted,
        })
      : call("get", { id, admin });
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
  if (request.method === "PATCH" && !user.isAdmin)
    return Response.json(
      { error: "Administrator access required" },
      { status: 403 },
    );
  const text = await request.text();
  if (
    new TextEncoder().encode(text).length >
    COMPONENT_DEFINITION_MAX_BYTES + 1024
  )
    return Response.json(
      { error: "Component definition is too large" },
      { status: 413 },
    );
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
    if (
      !body ||
      !Number.isSafeInteger(body.revision) ||
      Number(body.revision) < 0
    )
      throw new Error("Expected a component revision");
    if (request.method === "PUT")
      body.definition = parseSharedDefinition(body.definition);
    else if (!["shared", "official", "deleted"].includes(String(body.status)))
      throw new Error("Invalid component status");
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid component definition",
      },
      { status: 400 },
    );
  }
  return call(request.method === "PUT" ? "save" : "status", {
    id,
    revision: body.revision,
    definition: body.definition,
    status: body.status,
    userId: user.id,
    author: user.displayName,
    admin: user.isAdmin === true,
  });
}
