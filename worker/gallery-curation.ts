import taxonomy from "../config/gallery-taxonomy.json";

export const GALLERY_ISSUE_KINDS = taxonomy.issueKinds;
export type GalleryIssue = { kind: string; detail: string };
export type GalleryAttention = {
  status: "needs-attention" | "resolved";
  issues: GalleryIssue[];
};
export interface GalleryCuration {
  attention: GalleryAttention | null;
  revision: number;
  assessedPreviewRevision: string;
  updatedAt: string;
  updatedBy: string;
  source: "manual" | "visual-audit";
}

export function readGalleryCuration(
  raw: string | null | undefined,
): GalleryCuration | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GalleryCuration;
  } catch {
    return null;
  }
}

export function validGalleryAttention(
  value: unknown,
): value is GalleryAttention | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    (record.status === "needs-attention" || record.status === "resolved") &&
    Array.isArray(record.issues) &&
    record.issues.length <= 12 &&
    record.issues.every((issue: unknown) => {
      if (!issue || typeof issue !== "object") return false;
      const item = issue as Record<string, unknown>;
      return (
        typeof item.kind === "string" &&
        GALLERY_ISSUE_KINDS.includes(item.kind) &&
        typeof item.detail === "string" &&
        item.detail.trim().length > 0 &&
        item.detail.length <= 500
      );
    }) &&
    (record.status !== "needs-attention" || record.issues.length > 0)
  );
}
