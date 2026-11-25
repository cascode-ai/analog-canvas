// The selection board (docs/specs/selection-boards.md) at /boards: one ordered list
// of Gallery entries. Anyone sees its entries' names, authors and previews; any
// signed-in account that is not blocked may change it, and every change is recorded
// under that account. Its first change makes it.
// A board may hold reference datasets' circuits (ag-308, ct-001…) beside the wall's:
// the board's own store keeps their ids, and their names, facts and drawings come
// from each dataset's store here.

import {
  hasBearer,
  ownerTokenUserOf,
  sessionUserOf,
  type SessionUser,
} from "./auth";
import { BOARD_PAGE } from "./boards-page";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import {
  callGallery,
  recoverFormulaPreview,
  renderPreview,
} from "./gallery-requests";
import { withGalleryStore } from "./gallery-datasets";
import { gallerySourceOfEntryId, type GallerySource } from "./gallery-sources";
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

function plainProjectText(text: string): string {
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

/** A Gallery entry id as the wall and /g/<id> name it. */
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/u;

/**
 * The one board's id in the store (gallery-store-boards.ts mainBoardId); null
 * while the store cannot name it, such as a store still on an older build.
 */
export async function mainBoardIdOf(env: GalleryEnv): Promise<string | null> {
  const { status, payload } = await callGallery<{ id?: unknown }>(
    env,
    "board-main",
    {},
  );
  return status === 200 && typeof payload.id === "string" ? payload.id : null;
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

/**
 * The account a change comes from: a same-origin session, or an agent's API
 * token from its account page (a browser never adds a bearer by itself).
 */
export async function boardEditorOf(
  request: Request,
  env: GalleryEnv,
): Promise<SessionUser | null> {
  return hasBearer(request)
    ? ownerTokenUserOf(request, env)
    : sessionUserOf(request, env);
}

/** The signed-in account a change needs, or the response that refuses it. */
async function editor(
  request: Request,
  env: GalleryEnv,
): Promise<SessionUser | Response> {
  const viaToken = hasBearer(request);
  if (!viaToken && !sameOrigin(request))
    return json({ error: "cross-origin" }, 403);
  const user = await boardEditorOf(request, env);
  if (!user)
    return json({ error: viaToken ? "bad-token" : "sign-in-required" }, 401);
  return user;
}

/** What the page may offer this reader; the board keeps its maker's account to itself. */
export function withViewer(
  payload: Record<string, unknown>,
  user: SessionUser | null,
) {
  const board = { ...(payload.board as Record<string, unknown>) };
  delete board.createdById;
  return {
    ...payload,
    board,
    viewer: user
      ? {
          signedIn: true,
          accountId: user.id,
          name: user.displayName,
          canEdit: true,
          canUnlock: true,
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

type EntrySummary = Record<string, unknown>;

/** What a board shows of each named reference-dataset circuit public in its own store. */
async function datasetEntries(
  env: GalleryEnv,
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, EntrySummary>> {
  const bySource = new Map<GallerySource, Set<string>>();
  for (const id of ids) {
    const source = id ? gallerySourceOfEntryId(id) : null;
    if (!source || !id) continue;
    const wanted = bySource.get(source) ?? new Set<string>();
    bySource.set(source, wanted.add(id));
  }
  const found = new Map<string, EntrySummary>();
  await Promise.all(
    [...bySource].map(async ([source, wanted]) => {
      const { status, payload } = await callGallery<{
        entries?: Record<string, EntrySummary>;
      }>(withGalleryStore(env, source), "board-entries", {
        ids: [...wanted],
      });
      if (status !== 200) return;
      for (const [id, entry] of Object.entries(payload.entries ?? {}))
        found.set(id, entry);
    }),
  );
  return found;
}

/** A board read with its reference-dataset circuits named and counted from their own stores. */
export async function withDatasetEntries(
  env: GalleryEnv,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const items = Array.isArray(payload.items)
    ? (payload.items as { entryId: string; entry: unknown }[])
    : [];
  const events = Array.isArray(payload.events)
    ? (payload.events as {
        entryId?: string | null;
        previousEntryId?: string | null;
      }[])
    : [];
  const ids = [
    ...items.map((item) => item.entryId),
    ...events.flatMap((event) => [event.entryId, event.previousEntryId]),
  ].filter((id): id is string => !!id && !!gallerySourceOfEntryId(id));
  if (!ids.length) return payload;
  const found = await datasetEntries(env, ids);
  const names = { ...(payload.entryNames as Record<string, string>) };
  for (const [id, entry] of found) names[id] = String(entry.name ?? id);
  return {
    ...payload,
    items: items.map((item) =>
      gallerySourceOfEntryId(item.entryId)
        ? { ...item, entry: found.get(item.entryId) ?? null }
        : item,
    ),
    entryNames: names,
  };
}

/** The reference-dataset circuits that changes add and that are public in their own store. */
export async function datasetPublicIds(
  env: GalleryEnv,
  entryIds: string[],
): Promise<string[]> {
  return [...(await datasetEntries(env, entryIds)).keys()];
}

/** Each change as the store takes it, its entries named by id; null when one names none. */
export function storeChanges(raw: unknown): Record<string, unknown>[] | null {
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
    return method === "GET" ? page(BOARD_PAGE) : null;
  }
  // A link from when there were several boards opens the one board.
  if (/^\/boards\/[^/]+\/?$/u.test(url.pathname) && method === "GET")
    return Response.redirect(`${url.origin}/boards`, 301);

  if (url.pathname !== "/api/board" && !url.pathname.startsWith("/api/board/"))
    return null;
  const segments = url.pathname
    .slice("/api/board".length)
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  const boardId = await mainBoardIdOf(env);
  if (!boardId) return json({ error: "board-unavailable" }, 503);

  // GET /api/board — the board, for anyone.
  if (segments.length === 0 && method === "GET") {
    const { status, payload } = await callGallery<Record<string, unknown>>(
      env,
      "board-read",
      { id: boardId },
    );
    if (status !== 200) return json(payload, status);
    return json(
      withViewer(
        await withDatasetEntries(env, payload),
        await sessionUserOf(request, env),
      ),
    );
  }

  // POST /api/board/changes — add, replace, remove, move, note, rename, lock.
  if (segments.length === 1 && segments[0] === "changes") {
    if (method !== "POST") return json({ error: "method-not-allowed" }, 405);
    const user = await editor(request, env);
    if (user instanceof Response) return user;
    const body = await readBody(request);
    const changes = storeChanges(body?.changes);
    if (!changes) return json({ error: "bad-changes" }, 400);
    const added = changes
      .filter((change) => change.kind === "add" || change.kind === "replace")
      .map((change) => String(change.entryId));
    const { status, payload } = await callGallery<Record<string, unknown>>(
      env,
      "board-change",
      {
        id: boardId,
        changes,
        datasetPublic: await datasetPublicIds(env, added),
        actor: actorOf(user),
      },
    );
    return json(
      status === 200
        ? withViewer(await withDatasetEntries(env, payload), user)
        : payload,
      status,
    );
  }

  // GET /api/board/export — the list in order, for scripts.
  if (segments.length === 1 && segments[0] === "export" && method === "GET") {
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
    const read = (await withDatasetEntries(
      env,
      payload as Record<string, unknown>,
    )) as typeof payload;
    return json({
      title: payload.board.title,
      slots: payload.board.slots,
      lockedAt: payload.board.lockedAt,
      revision: payload.board.revision,
      items: (read.items ?? []).map((item) => ({
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

  // GET /api/board/preview/<entry id> — an entry's preview while it is on the board.
  if (segments.length === 2 && segments[0] === "preview" && method === "GET") {
    const entryId = segments[1]!.replace(/\.svg$/u, "");
    if (!ENTRY_ID.test(entryId)) return json({ error: "not-found" }, 404);
    type Drawing = {
      dataset?: boolean;
      status?: string;
      previewRevision?: string;
      svgText?: string;
      projectText?: string;
    };
    let { status, payload } = await callGallery<Drawing>(env, "board-preview", {
      id: boardId,
      entryId,
    });
    // On the board, and a reference dataset's circuit: its drawing is in its own store.
    const source = gallerySourceOfEntryId(entryId);
    if (status === 200 && payload.dataset && source)
      ({ status, payload } = await callGallery<Drawing>(
        withGalleryStore(env, source),
        "board-entry-preview",
        { entryId },
      ));
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
