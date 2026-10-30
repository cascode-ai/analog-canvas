// Selection boards (docs/specs/selection-boards.md) at /boards/<id>: an ordered list
// of Gallery entries. Anyone holding a board's link sees its entries' names, authors
// and previews; any signed-in account that is not blocked may change it, and every
// change is recorded under that account. An administrator makes a board at /boards.

import { sessionUserOf, type SessionUser } from "./auth";
import { BOARDS_HOME_PAGE, BOARD_PAGE } from "./boards-page";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  callGallery,
  recoverFormulaPreview,
  renderPreview,
} from "./gallery-requests";
import { type GalleryEnv } from "./gallery-store";
import { type BoardActor } from "./gallery-store-boards";
import { sameOrigin } from "./same-origin";

/**
 * A board draws each entry plain, as a benchmark Task holds it: no colour on parts,
 * labels or wires, and none of the drafting drawn over the circuit (frames,
 * construction lines, notes, arrows, circles). Net and supply labels stay. Bump the
 * rule's version when it changes, so cached drawings are drawn again.
 */
const PLAIN_RULE = 1;
const COLOUR_KEYS = new Set(["color", "textColor", "fillColor", "strokeColor"]);

export function plainProjectText(text: string): string {
  const uncolour = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(uncolour);
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    for (const [key, field] of Object.entries(object)) {
      if (COLOUR_KEYS.has(key) && typeof field === "string") delete object[key];
      else uncolour(field);
    }
    const style = object.styleOverride;
    if (style && typeof style === "object" && Object.keys(style).length === 0)
      delete object.styleOverride;
  };
  const project = JSON.parse(text) as {
    documents?: { drafting?: { objects?: unknown[] } }[];
  };
  for (const document of project.documents ?? []) {
    if (document.drafting?.objects) document.drafting.objects = [];
    uncolour(document);
  }
  return JSON.stringify(project);
}

async function plainPreview(projectText: string): Promise<string> {
  const project = parseProject(plainProjectText(projectText));
  return renderPreview(
    project,
    createProjectSymbolResolver(project, builtInSymbols),
  );
}

function edgeCache(): Cache | null {
  if (typeof caches === "undefined") return null;
  return (
    (caches as CacheStorage & { readonly default?: Cache }).default ?? null
  );
}

/** A board's id is its link: 24 letters and digits, about 143 bits. */
const BOARD_ID = /^[A-Za-z0-9]{24}$/u;
/** A Gallery entry id as the wall and /g/<id> name it. */
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/u;

function newBoardId(): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/**
 * An entry id from what a person pastes: the id itself, or any Canvas link that
 * names it (/g/<id>, /api/gallery/<id>…). Null when it names none.
 */
export function entryIdOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (ENTRY_ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const match = /^\/(?:g|api\/gallery)\/([^/]+)/u.exec(url.pathname);
  const id = match ? decodeURIComponent(match[1]!) : "";
  return ENTRY_ID.test(id) ? id : null;
}

function actorOf(user: SessionUser): BoardActor {
  return { id: user.id, name: user.displayName, admin: user.isAdmin };
}

const noStore = { "cache-control": "no-store", "x-robots-tag": "noindex" };

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: noStore });
}

function page(html: string): Response {
  return new Response(html, {
    headers: {
      ...noStore,
      "content-type": "text/html; charset=utf-8",
      // The link is the key: never send it on to another site.
      "referrer-policy": "same-origin",
      "content-security-policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; " +
        "base-uri 'none'; form-action 'self'",
    },
  });
}

async function readBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The signed-in account a change needs, or the response that refuses it. */
async function editor(
  request: Request,
  env: GalleryEnv,
): Promise<SessionUser | Response> {
  if (!sameOrigin(request)) return json({ error: "cross-origin" }, 403);
  const user = await sessionUserOf(request, env);
  if (!user) return json({ error: "sign-in-required" }, 401);
  if (user.blocked) return json({ error: "blocked" }, 403);
  return user;
}

/** What the page may offer this reader; the board keeps who made it to itself. */
function withViewer(
  payload: Record<string, unknown>,
  user: SessionUser | null,
) {
  const board = { ...(payload.board as Record<string, unknown>) };
  const madeIt = user !== null && board.createdById === user.id;
  delete board.createdById;
  return {
    ...payload,
    board,
    viewer: user
      ? {
          signedIn: true,
          name: user.displayName,
          canEdit: !user.blocked,
          canUnlock: !user.blocked && (user.isAdmin || madeIt),
          admin: user.isAdmin,
        }
      : {
          signedIn: false,
          name: null,
          canEdit: false,
          canUnlock: false,
          admin: false,
        },
  };
}

/** Each change as the store takes it, its entries named by id; null when one names none. */
function storeChanges(raw: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null;
  const changes: Record<string, unknown>[] = [];
  for (const change of raw) {
    if (!change || typeof change !== "object") return null;
    const next = { ...(change as Record<string, unknown>) };
    if (next.kind === "add" || next.kind === "replace") {
      const id = entryIdOf(next.entry ?? next.entryId);
      if (!id) return null;
      next.entryId = id;
      delete next.entry;
    }
    changes.push(next);
  }
  return changes;
}

export async function routeBoardsRequest(
  request: Request,
  env: GalleryEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const method = request.method;

  if (url.pathname === "/boards" || url.pathname === "/boards/") {
    return method === "GET" ? page(BOARDS_HOME_PAGE) : null;
  }
  const pageMatch = /^\/boards\/([^/]+)\/?$/u.exec(url.pathname);
  if (pageMatch && method === "GET") {
    return BOARD_ID.test(pageMatch[1]!) ? page(BOARD_PAGE) : null;
  }

  if (!url.pathname.startsWith("/api/boards")) return null;
  const segments = url.pathname
    .slice("/api/boards".length)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  // POST /api/boards — an administrator makes a board.
  if (segments.length === 0) {
    if (method !== "POST") return json({ error: "method-not-allowed" }, 405);
    const user = await editor(request, env);
    if (user instanceof Response) return user;
    if (!user.isAdmin) return json({ error: "admin-only" }, 403);
    const body = await readBody(request);
    if (!body) return json({ error: "bad-request" }, 400);
    const entries: string[] = [];
    for (const value of Array.isArray(body.entries) ? body.entries : []) {
      const id = entryIdOf(value);
      if (!id) return json({ error: "bad-entry", entry: String(value) }, 400);
      entries.push(id);
    }
    const { status, payload } = await callGallery<Record<string, unknown>>(
      env,
      "board-create",
      {
        id: newBoardId(),
        title: body.title,
        slots: body.slots ?? 50,
        entries,
        actor: actorOf(user),
      },
    );
    return json(
      status === 200
        ? withViewer(payload as Record<string, unknown>, user)
        : payload,
      status,
    );
  }

  const boardId = segments[0]!;
  if (!BOARD_ID.test(boardId)) return json({ error: "board-not-found" }, 404);

  // GET /api/boards/<id> — the board, for anyone holding its link.
  if (segments.length === 1 && method === "GET") {
    const { status, payload } = await callGallery<Record<string, unknown>>(
      env,
      "board-read",
      { id: boardId },
    );
    if (status !== 200) return json(payload, status);
    return json(withViewer(payload, await sessionUserOf(request, env)));
  }

  // POST /api/boards/<id>/changes — add, replace, remove, move, note, rename, lock.
  if (segments.length === 2 && segments[1] === "changes") {
    if (method !== "POST") return json({ error: "method-not-allowed" }, 405);
    const user = await editor(request, env);
    if (user instanceof Response) return user;
    const body = await readBody(request);
    const changes = storeChanges(body?.changes);
    if (!changes) return json({ error: "bad-changes" }, 400);
    const { status, payload } = await callGallery<Record<string, unknown>>(
      env,
      "board-change",
      { id: boardId, changes, actor: actorOf(user) },
    );
    return json(status === 200 ? withViewer(payload, user) : payload, status);
  }

  // GET /api/boards/<id>/export — the list in order, for scripts.
  if (segments.length === 2 && segments[1] === "export" && method === "GET") {
    const { status, payload } = await callGallery<{
      board?: {
        title: string;
        slots: number;
        lockedAt: string | null;
        revision: number;
      };
      items?: {
        position: number;
        entryId: string;
        note: string;
        addedBy: string;
        addedAt: string;
        type: string | null;
        entry: {
          name: string;
          author: string;
          tagType: string | null;
          transistors: number | null;
          levels: string | null;
        } | null;
      }[];
    }>(env, "board-read", { id: boardId });
    if (status !== 200 || !payload.board) return json(payload, status);
    return json({
      title: payload.board.title,
      slots: payload.board.slots,
      lockedAt: payload.board.lockedAt,
      revision: payload.board.revision,
      items: (payload.items ?? []).map((item) => ({
        position: item.position + 1,
        entryId: item.entryId,
        url: `${url.origin}/g/${encodeURIComponent(item.entryId)}`,
        name: item.entry?.name ?? null,
        author: item.entry?.author ?? null,
        type: item.type ?? item.entry?.tagType ?? null,
        transistors: item.entry?.transistors ?? null,
        levels: item.entry?.levels ?? null,
        note: item.note,
        addedBy: item.addedBy,
        addedAt: item.addedAt,
      })),
    });
  }

  // GET /api/boards/<id>/preview/<entry id> — an entry's preview while it is on the board.
  if (segments.length === 3 && segments[1] === "preview" && method === "GET") {
    const entryId = segments[2]!.replace(/\.svg$/u, "");
    if (!ENTRY_ID.test(entryId)) return json({ error: "not-found" }, 404);
    const { status, payload } = await callGallery<{
      status?: string;
      previewRevision?: string;
      svgText?: string;
      projectText?: string;
    }>(env, "board-preview", { id: boardId, entryId });
    if (status !== 200 || payload.status !== "public" || !payload.svgText)
      return json({ error: "not-found" }, 404);
    const immutable =
      url.searchParams.get("v") === String(payload.previewRevision);
    const headers = (cacheControl: string) => ({
      "content-type": "image/svg+xml",
      "cache-control": cacheControl,
      "x-robots-tag": "noindex",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'",
    });
    // One plain drawing per revision and rule, kept at the edge for the next reader.
    const cache = immutable ? edgeCache() : null;
    const key = new Request(
      `${url.origin}${url.pathname}?v=${encodeURIComponent(String(payload.previewRevision))}&rule=${PLAIN_RULE}`,
    );
    const cached = await cache?.match(key).catch(() => undefined);
    if (cached)
      return new Response(cached.body, {
        headers: headers("private, max-age=86400"),
      });
    let svg: string;
    try {
      svg = payload.projectText
        ? await plainPreview(payload.projectText)
        : payload.svgText;
    } catch {
      // A drawing this build cannot redraw keeps the Gallery's own preview.
      svg = await recoverFormulaPreview(payload.svgText, payload.projectText);
    }
    if (cache)
      await cache
        .put(
          key,
          new Response(svg, {
            headers: headers("public, max-age=31536000, immutable"),
          }),
        )
        .catch(() => undefined);
    return new Response(svg, {
      headers: headers(immutable ? "private, max-age=86400" : "no-store"),
    });
  }

  return json({ error: "not-found" }, 404);
}
