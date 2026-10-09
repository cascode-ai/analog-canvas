import { describe, expect, it } from "vitest";

import { RECYCLED_KEEP_COUNT, recycledRetentionNote } from "./my-submissions";

describe("recycledRetentionNote", () => {
  // The bin holds a fixed number of withdrawals per account and expires
  // nothing on a clock. A card that named a removal date would be promising
  // a day the worker never acts on, which is the bug this replaces.
  it("names the rule that removes an entry, never a date", () => {
    const note = recycledRetentionNote({ rejectReason: null });
    expect(note).toContain(
      `your ${RECYCLED_KEEP_COUNT} most recent withdrawals`,
    );
    expect(note).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(note.toLowerCase()).not.toContain("expire");
  });

  it("keeps the restore path honest for a rejected entry", () => {
    // A withdrawal the owner rejected is not the author's to republish, so
    // the same card must not offer them Restore.
    expect(recycledRetentionNote({ rejectReason: "Loose wires." })).toContain(
      "Only the Owner can restore",
    );
    expect(recycledRetentionNote({ rejectReason: null })).toContain(
      "Restore republishes it",
    );
  });

  it("leaves the Owner's withdrawal to the Owner (#1540)", () => {
    // The worker refuses the author's Restore of it, so the card names who
    // can, and promises no slot among the author's own withdrawals.
    const note = recycledRetentionNote({
      rejectReason: null,
      withdrawnByCurator: true,
    });
    expect(note).toBe("Withdrawn by the Owner. Only the Owner can restore it.");
  });
});
