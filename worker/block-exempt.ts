/**
 * The Owner, admins, moderators and AI seats are never blocked, not even by a
 * block recorded under their email by another account.
 */
export function exemptFromBlocks(user: {
  isOwner?: boolean;
  isAdmin?: boolean;
  seat?: string;
  role?: string;
}): boolean {
  return Boolean(
    user.isOwner || user.isAdmin || user.seat || user.role === "moderator",
  );
}
