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
import { sessionUserOf } from "./auth";
import { bearerMatches } from "./bearer";
import { type GalleryEnv } from "./gallery-store";

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
 * Who may manage one entry's lifecycle surfaces (withdrawal, version
 * history): a reviewer, or the signed-in owner of that entry.
 */
export async function entryManager(
  request: Request,
  env: GalleryEnv,
  id: string,
): Promise<{
  found: boolean;
  reviewer: boolean;
  owner: boolean;
  status: string | null;
  rejectReason: string | null;
}> {
  const existing = await callGallery<{
    ownerUserId?: string | null;
    status?: string;
    rejectReason?: string | null;
  }>(env, "any-entry", { id });
  if (existing.status !== 200) {
    return {
      found: false,
      reviewer: false,
      owner: false,
      status: null,
      rejectReason: null,
    };
  }
  const reviewer = await canReview(request, env);
  const user = await sessionUserOf(request, env);
  const owner =
    user !== null &&
    existing.payload.ownerUserId != null &&
    existing.payload.ownerUserId === user.id;
  return {
    found: true,
    reviewer,
    owner,
    status: existing.payload.status ?? null,
    rejectReason: existing.payload.rejectReason ?? null,
  };
}

export function fieldText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : null;
}

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
