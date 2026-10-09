// What the Gallery's routes share: calls into its store, session and
// credential checks, request fields, and preview rendering.

import { formulaPreviewNeedsRefresh } from "./gallery-preview";
import { prepareDocumentFormulaArtifacts } from "@icm/derived";
import { parseProject } from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  type SymbolResolver,
} from "@icm/symbols";
import { type CircuitProject } from "@icm/model";
import { sessionUserOf, type SessionUser } from "./auth";
import { bearerMatches } from "./bearer";
import { aiSeatOf, isAiSeatEntry, type GalleryEnv } from "./gallery-store";

function galleryStub(env: GalleryEnv) {
  return env.GALLERY.getByName("gallery");
}

export async function callGallery<T>(
  env: GalleryEnv,
  operation: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: T }> {
  const response = await galleryStub(env).fetch(
    `https://gallery/${operation}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, payload: (await response.json()) as T };
}

export async function isAdmin(
  request: Request,
  env: GalleryEnv,
): Promise<boolean> {
  const user = await sessionUserOf(request, env);
  return user?.isAdmin === true;
}

/**
 * The dedicated read-only Gallery credential. It authorizes only the bounded
 * Gallery reads that name it (the automated backup and the netlist pages):
 * never admin writes, unbounded dumps, or private Cloud Projects. Do not add
 * it to isAdmin.
 */
export function hasGalleryReadToken(
  request: Request,
  env: GalleryEnv,
): boolean {
  return bearerMatches(request, env.GALLERY_BACKUP_TOKEN);
}

/**
 * The dedicated read-only store credential: the same paginated backup pages,
 * with private Cloud Projects, and nothing else — no wall, no writes. Do not
 * add it to isAdmin.
 */
export function hasStoreBackupToken(
  request: Request,
  env: GalleryEnv,
): boolean {
  return bearerMatches(request, env.STORE_BACKUP_TOKEN);
}

/** `…/maintenance/automated-backup`, the only path the store credential opens. */
export function isAutomatedBackup(segments: readonly string[]): boolean {
  return (
    segments.length === 2 &&
    segments[0] === "maintenance" &&
    segments[1] === "automated-backup"
  );
}

/** Curation authority: an admin or an appointed moderator. */
export async function canReview(
  request: Request,
  env: GalleryEnv,
): Promise<boolean> {
  const user = await sessionUserOf(request, env);
  return user?.isAdmin === true || user?.role === "moderator";
}

/**
 * Whether a session reads a hidden (rejected or withdrawn) entry as its owner
 * does: it owns the entry, or both are AI accounts' (#1540; all are the
 * Owner's). Reading only: managing the entry stays its owner's.
 */
export function readsAsOwner(
  user: SessionUser | null,
  entry: {
    ownerUserId?: string | null | undefined;
    author?: string | null | undefined;
  },
): boolean {
  if (!user) return false;
  if (entry.ownerUserId != null && entry.ownerUserId === user.id) return true;
  return (
    aiSeatOf(user) !== undefined &&
    isAiSeatEntry(entry.ownerUserId, entry.author)
  );
}

/**
 * Whether a session reads an entry's testbench, its simulation folders
 * (#1545): one of the Owner's own accounts (OWNER_ACCOUNT_IDS), the entry's
 * owner, or an AI account reading an AI account's entry. Nobody else, a
 * curator included: anyone else gets the drawing without it.
 */
export function readsTestbench(
  user: SessionUser | null,
  entry: {
    ownerUserId?: string | null | undefined;
    author?: string | null | undefined;
  },
): boolean {
  return user?.isOwner === true || readsAsOwner(user, entry);
}

/**
 * Who may manage one entry's lifecycle surfaces (withdrawal, version
 * history): a reviewer, or the signed-in owner of that entry. `reads` also
 * covers who reads its history as the owner does (readsAsOwner), and
 * `testbench` who reads its testbench (readsTestbench).
 */
export async function entryManager(
  request: Request,
  env: GalleryEnv,
  id: string,
): Promise<{
  found: boolean;
  reviewer: boolean;
  owner: boolean;
  reads: boolean;
  testbench: boolean;
  status: string | null;
  rejectReason: string | null;
  withdrawnByCurator: boolean;
}> {
  const existing = await callGallery<{
    entry?: { author?: string };
    ownerUserId?: string | null;
    status?: string;
    rejectReason?: string | null;
    withdrawnByCurator?: boolean;
  }>(env, "any-entry", { id });
  if (existing.status !== 200) {
    return {
      found: false,
      reviewer: false,
      owner: false,
      reads: false,
      testbench: false,
      status: null,
      rejectReason: null,
      withdrawnByCurator: false,
    };
  }
  const reviewer = await canReview(request, env);
  const user = await sessionUserOf(request, env);
  const owner =
    user !== null &&
    existing.payload.ownerUserId != null &&
    existing.payload.ownerUserId === user.id;
  const held = {
    ownerUserId: existing.payload.ownerUserId,
    author: existing.payload.entry?.author,
  };
  return {
    found: true,
    reviewer,
    owner,
    reads: readsAsOwner(user, held),
    testbench: readsTestbench(user, held),
    status: existing.payload.status ?? null,
    rejectReason: existing.payload.rejectReason ?? null,
    withdrawnByCurator: existing.payload.withdrawnByCurator === true,
  };
}

export function fieldText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : null;
}

/**
 * The look `renderPreview` draws. One version always draws an unchanged
 * Project the same way, so whoever keeps a preview (AnalogArena's Submissions,
 * docs/specs/analog-arena.md) redraws it when this changes. Bump it with any
 * change that alters what a preview draws for an unchanged Project: here, in
 * `@icm/render-svg`, in the built-in symbols' artwork or in formula
 * typesetting. gallery-requests.test.ts fails when a fixture's preview changes
 * while this stays.
 */
export const PREVIEW_RENDERER_VERSION = "1";

export async function renderPreview(
  project: CircuitProject,
  resolver: SymbolResolver,
): Promise<string> {
  const topDocument = project.documents.find(
    (document) => document.id === project.topDocumentId,
  )!;
  const prepared = await prepareDocumentFormulaArtifacts(topDocument);
  try {
    return renderDocumentSvg(topDocument, resolver);
  } finally {
    prepared.release();
  }
}

export async function recoverFormulaPreview(
  svg: string,
  projectText?: string,
): Promise<string> {
  if (!projectText || !formulaPreviewNeedsRefresh(svg)) return svg;
  const project = parseProject(projectText);
  return renderPreview(
    project,
    createProjectSymbolResolver(project, builtInSymbols),
  );
}
