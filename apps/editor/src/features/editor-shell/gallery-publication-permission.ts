import type { GalleryEntryContext } from "./gallery-example-commands";
import { gallerySourceOfEntryId } from "../../gallery-sources";
export function canUpdateGalleryPublication(
  context: GalleryEntryContext | null,
  user: { id: string; isAdmin: boolean; role?: string } | null,
): boolean {
  // A reference dataset's circuit is read-only for everyone (#1510).
  return !!(
    context &&
    user &&
    !gallerySourceOfEntryId(context.id) &&
    (user.isAdmin ||
      user.role === "moderator" ||
      context.ownerUserId === user.id)
  );
}
