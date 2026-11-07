import { describe, expect, it } from "vitest";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { groupCatalogEntries } from "./component-catalog-groups";

const entry = (
  id: string,
  name: string,
  authorId: string,
  createdAt: string,
  capability: ComponentLibrarySummary["capability"] = "symbol-only",
): ComponentLibrarySummary => ({
  id,
  revision: 1,
  authorId,
  author: authorId,
  status: "shared",
  createdAt,
  updatedAt: createdAt,
  name,
  capability,
  pinCount: 2,
  parameterCount: 0,
});

describe("groupCatalogEntries", () => {
  it("keeps list order and heads a group with its newest record", () => {
    const groups = groupCatalogEntries([
      entry("a", "Decoder", "alice", "2026-01-01"),
      entry("b", "Amp", "alice", "2026-01-02"),
      entry("c", " decoder ", "alice", "2026-01-03"),
    ]);
    expect(groups.map((group) => group.head.id)).toEqual(["c", "b"]);
    expect(groups[0]!.others.map((other) => other.id)).toEqual(["a"]);
  });

  it("never joins two authors' records of one name", () => {
    const groups = groupCatalogEntries([
      entry("a", "Decoder", "alice", "2026-01-01"),
      entry("b", "Decoder", "bob", "2026-01-01"),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("does not head a group with a record that cannot be placed", () => {
    const [group] = groupCatalogEntries([
      entry("new", "Decoder", "alice", "2026-02-01", "needs-repair"),
      entry("old", "Decoder", "alice", "2026-01-01"),
    ]);
    expect(group!.head.id).toBe("old");
    expect(group!.others.map((other) => other.id)).toEqual(["new"]);
  });
});
