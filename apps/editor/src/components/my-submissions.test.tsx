import { describe, expect, it } from "vitest";

import { RECYCLED_KEEP_COUNT, recycledRetentionNote } from "./my-submissions";

describe("recycledRetentionNote", () => {
  // The bin holds a fixed number of withdrawals per account and expires
  // nothing on a clock. A card that named a removal date would be promising
  // a day the worker never acts on, which is the bug this replaces.
  it("names the rule that removes an entry, never a date", () => {
    const note = recycledRetentionNote(false);
    expect(note).toContain(
      `your ${RECYCLED_KEEP_COUNT} most recent withdrawals`,
    );
    expect(note).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(note.toLowerCase()).not.toContain("expire");
  });

  it("keeps the restore path honest for a rejected entry", () => {
    // A withdrawal the owner rejected is not the author's to republish, so
    // the same card must not offer them Restore.
    expect(recycledRetentionNote(true)).toContain("Only the Owner can restore");
    expect(recycledRetentionNote(false)).toContain("Restore republishes it");
  });
});
