import { CANVAS_HOST } from "./arena-paths";

/** Who a rejected entry tells, as the Gallery store knows them. */
export interface RejectionAuthor {
  /** The entry's name, as its author published it. */
  entryName: string;
  ownerUserId: string | null;
  /** The address the account had when it published, if any. */
  submitterEmail: string | null;
}

/**
 * The email a curator's rejection sends the author: the circuit, the
 * reason, where to fix it, and that a reply reaches the Owner.
 */
export function rejectionNotice(
  displayName: string | null,
  entryName: string,
  reason: string,
): { subject: string; text: string } {
  return {
    subject: `Your Analog Canvas Gallery circuit "${entryName}" was not accepted`,
    text: [
      `Hi ${displayName?.trim() || "there"},`,
      "",
      `Your circuit "${entryName}" was taken off the public Gallery.`,
      "",
      `Reason: ${reason}`,
      "",
      `It is still in your account: open it from My submissions (https://${CANVAS_HOST}/mine), fix it and publish it again. If you think this is a mistake, just reply to this email.`,
      "",
      "Token Zhang",
      "Analog Canvas",
    ].join("\n"),
  };
}
