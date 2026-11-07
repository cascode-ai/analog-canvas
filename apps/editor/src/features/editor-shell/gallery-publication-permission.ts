import type { GalleryEntryContext } from "./gallery-example-commands";
import { gallerySourceOfEntryId } from "../../gallery-sources";
export function canUpdateGalleryPublication(
  context: GalleryEntryContext | null,
  user: { id: string; isAdmin: boolean; role?: string } | null,
  datasetEdits?: { allowed: boolean } | null,
): boolean {
  if (!context || !user) return false;
  // A reference dataset's drawing: whoever the server lets fix it, which
  // the quota says (enough public circuits of one's own, or a curator).
  if (gallerySourceOfEntryId(context.id)) return datasetEdits?.allowed === true;
  return (
    user.isAdmin || user.role === "moderator" || context.ownerUserId === user.id
  );
}
