// What every part of the Gallery store shares: the storage handle and the
// Worker's bindings, limits, circuit ids and previews, and entry rows with
// their public summaries.

import { COMPONENT_COUNT_RULE_VERSION } from "./gallery-components";
import { readGalleryCuration, type GalleryAttention } from "./gallery-curation";
import { AI_ACCOUNT_PROVIDER, AI_SEATS, type AuthNamespaceLike } from "./auth";

/**
 * A circuit's id is its address, so it is short enough to read out loud and
 * type. Ten characters of this alphabet carry ~50 bits — far more than the
 * wall will ever hold — and the alphabet drops the characters that get
 * misread when someone copies a link off a screen: no 0/o, 1/l/i, or u.
 *
 * Existing entries keep the UUIDs they were given. This shortens what new
 * links look like; it never rewrites an address someone may have shared.
 */
const SHORT_ID_ALPHABET = "23456789abcdefghjkmnpqrstvwxyz";
export const SHORT_ID_LENGTH = 10;

export function shortId(length = SHORT_ID_LENGTH): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let id = "";
  for (const byte of bytes) {
    id += SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length];
  }
  return id;
}

export const GALLERY_MAX_PROJECT_BYTES = 2 * 1024 * 1024;
export const GALLERY_MAX_REJECT_REASON_LENGTH = 500;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const GALLERY_MAX_NAME_LENGTH = 120;
export const GALLERY_MAX_AUTHOR_LENGTH = 40;
/** Room for notes and a full citation, DOI included; tiles show three lines. */
export const GALLERY_MAX_DESCRIPTION_LENGTH = 1000;
/**
 * Publishes one account may make in a UTC day. Anti-garbage protection, not a
 * pace limit: ten stopped an ordinary afternoon of posting a chapter's worth
 * of figures. It counted by IP before it counted by account, so one shared
 * campus or office exit spent the allowance for everyone behind it.
 */
export const GALLERY_DAILY_SUBMISSION_LIMIT = 100;
/** Publishes an AI account (an Owner's seat) may make in a UTC day. */
export const GALLERY_AI_SEAT_DAILY_LIMIT = 500;

/**
 * Whether an entry is an AI account's: its owner is listed in AI_SEATS and
 * its byline is that seat's name, now or before it became one. A person's
 * account under a listed id, which AuthDO leaves alone, keeps its own.
 */
export function isAiSeatEntry(
  ownerUserId: string | null | undefined,
  author: string | null | undefined,
): boolean {
  return AI_SEATS.some(
    ({ userId, displayName, formerName }) =>
      userId === ownerUserId &&
      (author === displayName || author === formerName),
  );
}

/** The day's allowance of the account a session belongs to. */
export function dailySubmissionLimit(user: { provider: string }): number {
  return user.provider === AI_ACCOUNT_PROVIDER
    ? GALLERY_AI_SEAT_DAILY_LIMIT
    : GALLERY_DAILY_SUBMISSION_LIMIT;
}

/**
 * Other people's circuits one account may open — read their Project Code —
 * in a UTC day. A person browsing never meets it; a script cannot carry the
 * whole Gallery off at once. Each circuit counts once a day; the wall, search
 * and previews are not counted.
 */
export const GALLERY_DAILY_OPEN_LIMIT = 100;

const GALLERY_MAX_TAGS = 12;
const GALLERY_MAX_TAG_LENGTH = 32;

export interface SvgPreviewDimensions {
  width: number;
  height: number;
}

/** Read the renderer-owned SVG viewBox without parsing or trusting its body. */
export function svgPreviewDimensions(
  svgText: string,
): SvgPreviewDimensions | null {
  const root = /<svg\b[^>]*>/iu.exec(svgText)?.[0];
  const value = root
    ? /\bviewBox\s*=\s*(["'])(.*?)\1/iu.exec(root)?.[2]
    : undefined;
  if (!value) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (
    parts.length !== 4 ||
    !parts.every(Number.isFinite) ||
    parts[2]! <= 0 ||
    parts[3]! <= 0
  ) {
    return null;
  }
  return { width: parts[2]!, height: parts[3]! };
}

type SqlResult<T> = {
  toArray(): T[];
  one(): T;
};

export type SqlStorage = {
  exec<T>(query: string, ...bindings: unknown[]): SqlResult<T>;
};

export type DurableObjectStateLike = {
  storage: {
    sql: SqlStorage;
    transactionSync<T>(callback: () => T): T;
  };
};

export type GalleryNamespaceLike = {
  getByName(name: string): {
    fetch(input: string, init?: RequestInit): Promise<Response>;
  };
};

export type GalleryEnv = {
  /**
   * Read-only, Gallery-only credential for the private off-site backup job
   * and for reading the public Gallery's netlists by script.
   */
  GALLERY_BACKUP_TOKEN?: string;
  /**
   * Read-only credential for the private, manually started whole-store backup:
   * the backup pages with private Cloud Projects, nothing else.
   */
  STORE_BACKUP_TOKEN?: string;
  GALLERY: GalleryNamespaceLike;
  /** Sessions are the only identity: publishing requires one. */
  AUTH?: AuthNamespaceLike;
  ADMIN_EMAILS?: string;
  ADMIN_EMAILS_EXTRA?: string;
};

export interface GalleryEntrySummary {
  curationRevision: number;
  attention?: GalleryAttention;
  assessedPreviewRevision?: string;
  id: string;
  name: string;
  author: string;
  /** Stable identity behind the mutable public byline; null for legacy rows. */
  ownerUserId: string | null;
  description: string;
  createdAt: string;
  /**
   * Content revision of the stored SVG. The public URL includes this so a
   * changed rendering gets a new cache key while identical bytes reuse the
   * existing immutable response.
   */
  previewRevision: string;
  /** Intrinsic preview ratio; absent only for an invalid or legacy SVG. */
  previewWidth?: number;
  previewHeight?: number;
  schemaVersion: number;
  tags: string[];
  /**
   * Whether this circuit currently extracts to a design netlist. A schematic
   * is allowed to be abbreviated, so this is a mark of extra completeness and
   * never a gate: circuits without it are published and browsed alike.
   */
  netlistable: boolean;
  /**
   * The publisher's AI mark: true when they say an AI made the circuit,
   * absent otherwise. The author may change it with any later update.
   */
  aiGenerated?: boolean;
  /**
   * How many parts the top Cell draws (see `galleryComponentCount`); absent
   * until the scheduled refresh has counted an older entry.
   */
  componentCount?: number;
  likes: number;
  /** Whether the requesting account has liked it; false when signed out. */
  likedByViewer: boolean;
}

/**
 * One tag normalization for every write and filter: trimmed, lowercased,
 * inner whitespace collapsed, `[a-z0-9 +/-]` only, capped in length and
 * count, deduplicated.
 */
export function sanitizeGalleryTags(
  value: unknown,
  limit = GALLERY_MAX_TAGS,
): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw
      .toLowerCase()
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[^a-z0-9 +/-]/gu, "")
      .slice(0, GALLERY_MAX_TAG_LENGTH)
      .trim();
    if (tag.length === 0 || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length === limit) break;
  }
  return tags;
}

/** Storage form: `,a,b,` so `LIKE '%,a,%'` matches exactly one tag. */
export function wrapTags(tags: string[]): string {
  return tags.length === 0 ? "" : `,${tags.join(",")},`;
}

export function unwrapTags(stored: string | null): string[] {
  if (!stored) return [];
  return stored.split(",").filter((tag) => tag.length > 0);
}

export interface EntryRow {
  curation_json: string;
  id: string;
  name: string;
  author: string;
  description: string;
  created_at: string;
  schema_version: number;
  status: string;
  recycled_at: string | null;
  owner_user_id: string | null;
  submitter_email: string | null;
  submitter_provider: string | null;
  tags: string | null;
  reject_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  project_text: string;
  svg_text: string;
  netlistable: number;
  ai_generated: number;
  component_count: number;
  component_count_version: number;
  preview_revision: string;
  preview_width: number | null;
  preview_height: number | null;
}

export type EntrySummaryRow = Pick<
  EntryRow,
  | "id"
  | "name"
  | "author"
  | "description"
  | "created_at"
  | "owner_user_id"
  | "schema_version"
  | "tags"
  | "curation_json"
  | "netlistable"
  | "preview_revision"
  | "preview_width"
  | "preview_height"
> &
  Partial<
    Pick<
      EntryRow,
      "ai_generated" | "component_count" | "component_count_version"
    >
  >;

/**
 * A part count as stored: with this build's rule version when the writer
 * counted it, or unversioned, so the scheduled refresh counts it, when not.
 */
export function countedParts(value: unknown): [number, number] {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? [value, COMPONENT_COUNT_RULE_VERSION]
    : [0, 0];
}

export function summaryOf(
  row: EntrySummaryRow & { likes?: number; liked_by_viewer?: number },
  includeAttention = false,
): GalleryEntrySummary {
  const curation = readGalleryCuration(row.curation_json);
  return {
    curationRevision: curation?.revision ?? 0,
    ...(includeAttention && curation?.attention
      ? {
          attention: curation.attention,
          assessedPreviewRevision: curation.assessedPreviewRevision,
        }
      : {}),
    id: row.id,
    name: row.name,
    author: row.author,
    ownerUserId: row.owner_user_id,
    description: row.description,
    createdAt: row.created_at,
    // Existing rows receive the additive column as empty. "legacy" moves
    // them off the formerly mutable URL once; their next SVG write stores a
    // content hash like every new row.
    previewRevision: row.preview_revision || "legacy",
    ...(row.preview_width !== null && row.preview_height !== null
      ? {
          previewWidth: row.preview_width,
          previewHeight: row.preview_height,
        }
      : {}),
    schemaVersion: row.schema_version,
    tags: unwrapTags(row.tags),
    netlistable: row.netlistable === 1,
    ...(row.ai_generated === 1 ? { aiGenerated: true } : {}),
    ...(row.component_count_version && row.component_count !== undefined
      ? { componentCount: row.component_count }
      : {}),
    likes: row.likes ?? 0,
    likedByViewer: (row.liked_by_viewer ?? 0) === 1,
  };
}

/** Republication invalidates in-flight metadata writes even if the SVG stays identical. */
export function advanceCurationRevision(row: EntryRow, at: string): string {
  const previous = readGalleryCuration(row.curation_json);
  return JSON.stringify({
    attention: previous?.attention ?? null,
    assessedPreviewRevision: previous?.assessedPreviewRevision ?? "",
    updatedAt: previous?.updatedAt ?? at,
    updatedBy: previous?.updatedBy ?? "",
    source: previous?.source ?? "manual",
    revision: (previous?.revision ?? 0) + 1,
  });
}
