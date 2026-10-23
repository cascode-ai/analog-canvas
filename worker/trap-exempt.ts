/**
 * The Owner, admins, moderators and AI seats: their own tools read the
 * Gallery in bulk, so they meet no trap circuit and are never blocked, not
 * even by a block recorded under their email by another account.
 */
export function exemptFromTraps(user: {
  isOwner?: boolean;
  isAdmin?: boolean;
  seat?: string;
  role?: string;
}): boolean {
  return Boolean(
    user.isOwner || user.isAdmin || user.seat || user.role === "moderator",
  );
}
