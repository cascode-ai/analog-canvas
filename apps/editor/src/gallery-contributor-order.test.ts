import { describe, expect, it } from "vitest";
import { orderContributors } from "./gallery-contributor-order";

const author = (name: string, count: number) => ({
  author: name,
  count,
  ownerUserId: name,
});

describe("orderContributors (#1502)", () => {
  const byCount = [
    author("Rgeph", 40),
    author("claude Opus 5.5", 30),
    author("Agent 10", 5),
    author("Agent 9", 3),
  ];
  it("keeps the server's order by circuits", () => {
    expect(orderContributors(byCount, "count")).toBe(byCount);
  });
  it("orders by name, ignoring case, with numbers in their order", () => {
    expect(
      orderContributors(byCount, "name").map((option) => option.author),
    ).toEqual(["Agent 9", "Agent 10", "claude Opus 5.5", "Rgeph"]);
  });
});
