import type { GalleryEntryContext } from "./gallery-example-commands";
import { gallerySourceOfEntryId } from "../../gallery-sources";
export function canUpdateGalleryPublication(
  context: GalleryEntryContext | null,
  user: { id: string; isAdmin: boolean; role?: string } | null,
  fixes?: { allowed: boolean } | null,
): boolean {
  if (!context || !user) return false;
  // A reference dataset's drawing: whoever the server lets fix it, which
  // the quota says (enough public circuits of one's own, or a curator).
  if (gallerySourceOfEntryId(context.id)) return fixes?.allowed === true;
  // Someone else's circuit is fixed in place by the same right.
  return (
    user.isAdmin ||
    user.role === "moderator" ||
    context.ownerUserId === user.id ||
    fixes?.allowed === true
  );
}

/**
 * Whose drawing the update fixes rather than updates: a reference
 * dataset's (its name), or, for an account that neither owns nor curates
 * it, the circuit's byline. Null for the owner's or a curator's update.
 */
export function galleryFixOf(
  context: GalleryEntryContext | null,
  user: { id: string; isAdmin: boolean; role?: string } | null,
): string | null {
  if (!context || !user) return null;
  const source = gallerySourceOfEntryId(context.id);
  if (source) return source.name;
  return user.isAdmin ||
    user.role === "moderator" ||
    context.ownerUserId === user.id
    ? null
    : context.author;
}
