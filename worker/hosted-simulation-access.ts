import type { SessionUser } from "./auth-do";

/**
 * Hosted simulation is the team's debugging tool, not a user service (#2074):
 * users run their own simulator on an exported netlist. The team is the
 * Owner's accounts, the AI seats and the administrators.
 */
export function computesOnHostedSimulation(
  user: Pick<SessionUser, "isOwner" | "seat" | "isAdmin">,
): boolean {
  return (
    user.isOwner === true || user.seat !== undefined || user.isAdmin === true
  );
}

/** `/api/auth/me`'s user, told whether the editor offers Simulate. */
export function withHostedSimulation(
  user: SessionUser | null,
): (SessionUser & { hostedSimulation?: true }) | null {
  return user && computesOnHostedSimulation(user)
    ? { ...user, hostedSimulation: true }
    : user;
}
