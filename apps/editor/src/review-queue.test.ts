import { describe, expect, it } from "vitest";
import {
  entryIdOf,
  flagsFor,
  hasReference,
  nextUnreviewed,
  reviewProgress,
  scopeFromSearch,
  shuffledQueue,
  withReview,
  type ReviewCard,
  type ShownReview,
} from "./review-queue";

const review = (verdict: "pass" | "issue", current = true): ShownReview => ({
  id: "r",
  entryId: "x",
  revision: "v",
  current,
  reviewer: "A",
  verdict,
  flags: verdict === "issue" ? ["loose"] : [],
  note: "",
  at: "2026-11-07T00:00:00Z",
  resolved: false,
});

const card = (id: string, mine: ShownReview | null = null): ReviewCard => ({
  id,
  scope: "community",
  name: id,
  author: "a",
  previewRevision: "v",
  components: 3,
  reviews: mine?.current ? 1 : 0,
  likes: 0,
  likedByViewer: false,
  mine,
});

describe("review queue", () => {
  it("finds the drawing a pasted link or id names", () => {
    expect(entryIdOf("https://analog-canvas.tokenzhang.com/g/ct-016")).toBe(
      "ct-016",
    );
    expect(entryIdOf("/review?scope=amsnet&id=amsnet-12&refs=0")).toBe(
      "amsnet-12",
    );
    expect(entryIdOf("  rmhkjz7h8z ")).toBe("rmhkjz7h8z");
    expect(entryIdOf("not a link")).toBeNull();
  });

  it("counts progress by the reviewer's current reviews and finds the next unreviewed", () => {
    const cards = [
      card("a", review("pass")),
      card("b", review("issue")),
      // A review of an older version no longer counts.
      card("c", review("pass", false)),
      card("d"),
    ];
    expect(reviewProgress(cards)).toEqual({ passed: 1, flagged: 1, left: 2 });
    expect(nextUnreviewed(cards, 2)).toBe(3);
    expect(nextUnreviewed(cards, 3)).toBe(2);
    expect(nextUnreviewed([card("a", review("pass"))], 0)).toBeNull();
    expect(withReview(cards[2]!, review("issue"))).toMatchObject({
      reviews: 1,
      mine: { verdict: "issue" },
    });
    // Random shuffles every store's drawings, the unreviewed first.
    const mixed = shuffledQueue(cards);
    expect(
      mixed
        .slice(0, 2)
        .map((each) => each.id)
        .sort(),
    ).toEqual(["c", "d"]);
    expect(mixed).toHaveLength(4);
    expect(
      [card("e"), { ...card("f"), reference: { revision: "r" } }]
        .filter(hasReference)
        .map((each) => each.id),
    ).toEqual(["f"]);
  });

  it("offers too simple and duplicate for community drawings only", () => {
    expect(flagsFor("analoggenie").map((flag) => flag.key)).not.toContain(
      "duplicate",
    );
    expect(flagsFor("community").map((flag) => flag.hotkey)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
    ]);
    expect(scopeFromSearch("?scope=community")).toBe("community");
    expect(scopeFromSearch("?scope=analoggenie")).toBe("analoggenie");
    expect(scopeFromSearch("?scope=amsnet")).toBe("amsnet");
    expect(scopeFromSearch("?scope=analogretriever")).toBe("random");
    expect(scopeFromSearch("")).toBe("random");
  });
});
