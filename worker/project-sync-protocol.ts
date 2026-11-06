import {
  parseProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "@icm/project-protocol";
import { GALLERY_MAX_PROJECT_BYTES, isRecord } from "./gallery-store";
import { projectPayloadHash, type ProjectEvent } from "./project-sync-journal";

// Four maximum-sized documents plus JSON escaping and bounded metadata.
export const MAX_SYNC_BYTES = 20 * 1024 * 1024;
export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  revision: number;
  schema_version: number;
  project_text: string;
  preview_svg: string;
  gallery_entry_id: string | null;
  favorite: number;
}
export interface ProjectVersionRow {
  id: string;
  project_id: string;
  revision: number;
  name: string;
  saved_at: string;
  schema_version: number;
  project_text: string;
  preview_svg: string;
}
export interface ProjectChange {
  origin: "cn" | "overseas";
  kind?: "quota";
  reservation?: string;
  id: string;
  ownerUserId: string;
  head: string;
  parents: string[];
  project: ProjectRow | null;
  versions: ProjectVersionRow[];
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);
const positive = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
function document(value: Record<string, unknown>): boolean {
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 120 ||
    !positive(value.schema_version) ||
    Number(value.schema_version) > CURRENT_PROJECT_FILE_VERSION ||
    typeof value.project_text !== "string" ||
    new TextEncoder().encode(value.project_text).length >
      GALLERY_MAX_PROJECT_BYTES ||
    !positive(value.revision)
  )
    return false;
  try {
    parseProject(value.project_text);
    return true;
  } catch {
    return false;
  }
}

/** Decode the versioned peer boundary before ownership lookup or any durable write. */
export async function decodeProjectEvent(
  value: unknown,
): Promise<{ event: ProjectEvent; change: ProjectChange } | null> {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !["cn", "overseas"].includes(String(value.origin)) ||
    !identifier(value.epoch) ||
    !positive(value.sequence) ||
    !identifier(value.eventId) ||
    typeof value.payload !== "string" ||
    new TextEncoder().encode(value.payload).length > MAX_SYNC_BYTES ||
    typeof value.payloadHash !== "string" ||
    (await projectPayloadHash(value.payload)) !== value.payloadHash
  )
    return null;
  let change: unknown;
  try {
    change = JSON.parse(value.payload);
  } catch {
    return null;
  }
  if (
    !isRecord(change) ||
    change.origin !== value.origin ||
    !identifier(change.id) ||
    !identifier(change.ownerUserId) ||
    change.head !== value.eventId ||
    !Array.isArray(change.parents) ||
    change.parents.length > 32 ||
    !change.parents.every(identifier) ||
    new Set(change.parents).size !== change.parents.length ||
    change.parents.includes(change.head) ||
    !Array.isArray(change.versions) ||
    change.versions.length > 3
  )
    return null;
  const row = change.project;
  if (change.kind !== undefined && change.kind !== "quota") return null;
  if (
    change.kind === "quota" &&
    (value.origin !== "overseas" ||
      !identifier(change.reservation) ||
      row !== null ||
      change.versions.length ||
      change.parents.length)
  )
    return null;
  if (
    row !== null &&
    (!isRecord(row) ||
      !document(row) ||
      row.id !== change.id ||
      row.user_id !== change.ownerUserId ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      !(row.favorite === 0 || row.favorite === 1) ||
      !(row.gallery_entry_id === null || identifier(row.gallery_entry_id)))
  )
    return null;
  for (const v of change.versions) {
    if (
      !isRecord(v) ||
      !document(v) ||
      !identifier(v.id) ||
      v.project_id !== change.id ||
      typeof v.saved_at !== "string"
    )
      return null;
  }
  if (
    new Set(change.versions.map((v) => v.id)).size !== change.versions.length ||
    new Set(change.versions.map((v) => v.revision)).size !==
      change.versions.length ||
    (isRecord(row) &&
      change.versions.some((v) => v.revision >= Number(row.revision)))
  )
    return null;
  if (row === null && change.versions.length !== 0) return null;
  return {
    event: value as unknown as ProjectEvent,
    change: change as unknown as ProjectChange,
  };
}
