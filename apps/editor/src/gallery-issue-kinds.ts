import taxonomy from "../../../config/gallery-taxonomy.json";

/**
 * Why a Gallery circuit needs attention, in the order the Gallery lists the
 * reasons: the netlist findings first, then the visual ones. The taxonomy is
 * the one vocabulary the Worker validates against.
 */
export const GALLERY_ISSUE_KINDS: readonly string[] = taxonomy.issueKinds;

const labels: Record<string, string> = taxonomy.issueKindLabels;

export function galleryIssueKindLabel(kind: string): string {
  return labels[kind] ?? kind;
}
