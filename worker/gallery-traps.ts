// Trap circuits: entries mixed into a member's list pages that the Analog
// Canvas client never shows (their ids are reserved, see
// gallery-reserved-ids.ts). A person cannot open one; only a program walking
// the list does, so an account that reads one is collecting in bulk. It is
// blocked from the Gallery, and the Owner is told who it was
// (docs/specs/community-gallery.md#crawlers-ai-and-floods).

import {
  CURRENT_PROJECT_FILE_VERSION,
  parseProject,
  serializeProject,
} from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { isReservedGalleryId } from "../apps/editor/src/gallery-reserved-ids";
import commonSource from "../apps/editor/src/examples/common-source-amplifier.icproj.json";
import diffPair from "../apps/editor/src/examples/current-mirror-loaded-differential-pair.icproj.json";
import twoStage from "../apps/editor/src/examples/two-stage-op-amp.icproj.json";
import type { SessionUser } from "./auth";
import { exemptFromTraps } from "./trap-exempt";
import { renderPreview } from "./gallery-requests";
import type { GalleryEntrySummary } from "./gallery-store";

interface Trap {
  id: string;
  name: string;
  description: string;
  source: unknown;
}

const TRAPS: readonly Trap[] = [
  {
    id: "ww5fnfambz",
    name: "Common-source stage with source degeneration",
    description: "Small-signal NMOS gain stage with a resistive load.",
    source: commonSource,
  },
  {
    id: "s93tzkszt6",
    name: "Differential pair with current-mirror load",
    description: "Single-ended output, NMOS input pair, PMOS mirror load.",
    source: diffPair,
  },
  {
    id: "ptbzg5vr6a",
    name: "Two-stage Miller-compensated amplifier",
    description: "Differential input stage followed by a common-source stage.",
    source: twoStage,
  },
  {
    id: "sawent8x53",
    name: "Telescopic amplifier, single-ended",
    description: "NMOS input pair with a mirror load and tail source.",
    source: diffPair,
  },
];

/** The trap a path's first segment names, if any. */
export function trapOf(id: string | undefined): Trap | null {
  if (!id || !isReservedGalleryId(id)) return null;
  return TRAPS.find((trap) => trap.id === id) ?? null;
}

/**
 * What a request under a trap id says about its reader. A program (no
 * browser's User-Agent) is collecting; a browser only when it reads a
 * trap's circuit, since a page left open across a deploy shows trap tiles
 * and loads their previews by itself (2026-10-22).
 */
export function trapReadKind(
  request: Request,
  resource: string | undefined,
): "script" | "read" | null {
  const agent = request.headers.get("user-agent") ?? "";
  const browser =
    /^Mozilla\/5\.0 \(/u.test(agent) &&
    /(?:AppleWebKit|Gecko)\//u.test(agent) &&
    !/headless|phantomjs|puppeteer|playwright|python|curl|wget|node|axios|go-http|okhttp|java\/|scrapy|bot|spider|crawl/iu.test(
      agent,
    );
  if (!browser) return "script";
  const summary = new URL(request.url).searchParams.get("summary") === "1";
  return request.method === "GET" && resource === undefined && !summary
    ? "read"
    : null;
}

/**
 * Whether this reader is shown traps and blocked for opening one: any
 * signed-in member, but not the Owner, a curator, a moderator or an AI
 * seat, whose own tools read the Gallery in bulk.
 */
export function readsTraps(user: SessionUser | null): user is SessionUser {
  return user !== null && !exemptFromTraps(user);
}

function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** A trap's tile; beside a page's circuit it takes that one's date. */
function summaryOf(
  trap: Trap,
  like: GalleryEntrySummary | null,
): GalleryEntrySummary {
  return {
    curationRevision: like?.curationRevision ?? 0,
    id: trap.id,
    name: trap.name,
    author: "Analog Canvas",
    ownerUserId: null,
    description: trap.description,
    createdAt: like?.createdAt ?? "2026-09-14T08:00:00.000Z",
    previewRevision: hashOf(trap.id).toString(16).padStart(8, "0"),
    schemaVersion: like?.schemaVersion ?? CURRENT_PROJECT_FILE_VERSION,
    tags: ["amplifier"],
    netlistable: true,
    likes: 0,
    likedByViewer: false,
  };
}

/**
 * One trap placed among a page of at least six circuits, where and which
 * depending on the page, so every walk of the list meets them. Its other
 * fields are its neighbour's, so the page keeps one shape.
 */
export function withTrap(
  entries: GalleryEntrySummary[],
  pageKey: string,
): GalleryEntrySummary[] {
  if (entries.length < 6) return entries;
  const hash = hashOf(pageKey);
  const trap = TRAPS[hash % TRAPS.length]!;
  const at = 2 + ((hash >>> 8) % (entries.length - 2));
  const placed = [...entries];
  placed.splice(at, 0, summaryOf(trap, entries[at - 1]!));
  return placed;
}

const trapTexts = new Map<string, string>();

function projectTextOf(trap: Trap): string {
  let text = trapTexts.get(trap.id);
  if (!text) {
    const project = parseProject(JSON.stringify(trap.source));
    project.name = trap.name;
    text = serializeProject(project);
    trapTexts.set(trap.id, text);
  }
  return text;
}

/**
 * What a trap answers: an ordinary circuit, so the program reading it does
 * not notice; its account is already blocked for the next read.
 */
export async function trapResponse(
  trap: Trap,
  resource: string | undefined,
  like: GalleryEntrySummary | null = null,
): Promise<Response> {
  const projectText = projectTextOf(trap);
  if (resource === "preview.svg") {
    const project = parseProject(projectText);
    const svg = await renderPreview(
      project,
      createProjectSymbolResolver(project, builtInSymbols),
    );
    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "private, no-store",
      },
    });
  }
  return Response.json(
    {
      entry: summaryOf(trap, like),
      status: "public",
      ownerUserId: null,
      projectText,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
