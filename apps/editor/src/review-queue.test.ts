import { describe, expect, it } from "vitest";
import {
  authorFromSearch,
  entryIdOf,
  flagsFor,
  hasReference,
  matchesMine,
  matchesReviewSearch,
  mineFromSearch,
  mineProgress,
  nextUnreviewed,
  referencesOnlyFromSearch,
  reviewAuthors,
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
  it("starts Community with every drawing and the datasets on their figures", () => {
    expect(referencesOnlyFromSearch("?scope=community")).toBe(false);
    expect(referencesOnlyFromSearch("?scope=community&refs=1")).toBe(true);
    expect(referencesOnlyFromSearch("?scope=analoggenie")).toBe(true);
    expect(referencesOnlyFromSearch("?scope=random&refs=0")).toBe(false);
    expect(referencesOnlyFromSearch("")).toBe(true);
    expect(authorFromSearch("?scope=community&author=Magic%20Li")).toBe(
      "Magic Li",
    );
    expect(authorFromSearch("?scope=community")).toBeNull();
  });

  it("shows one's own drawings without counting them as left to review", () => {
    const cards = [
      { ...card("a"), own: true },
      card("b"),
      card("c", review("pass")),
    ];
    expect(reviewProgress(cards)).toEqual({ passed: 1, flagged: 0, left: 1 });
    expect(nextUnreviewed(cards, 2)).toBe(1);
  });

  it("finds one's own drawings others flagged or passed, or without a reference (#2129)", () => {
    const flagged = { ...card("a"), own: true, outcome: "flagged" as const };
    const passed = {
      ...card("b"),
      own: true,
      outcome: "passed" as const,
      reference: { revision: "r" },
    };
    const waiting = { ...card("c"), own: true };
    const others = { ...card("d"), outcome: "flagged" as const };
    const cards = [flagged, passed, waiting, others];
    const ids = (filter: Parameters<typeof matchesMine>[1]) =>
      cards.filter((each) => matchesMine(each, filter)).map((each) => each.id);
    expect(ids("all")).toEqual(["a", "b", "c"]);
    expect(ids("flagged")).toEqual(["a"]);
    expect(ids("passed")).toEqual(["b"]);
    expect(ids("no-reference")).toEqual(["a", "c"]);
    expect(mineProgress([flagged, passed, waiting])).toEqual({
      passed: 1,
      flagged: 1,
      left: 1,
    });
    expect(mineFromSearch("?scope=community&mine=no-reference")).toBe(
      "no-reference",
    );
    expect(mineFromSearch("?mine=bogus")).toBeNull();
  });

  it("searches by name, author, id or link and lists authors by their drawings", () => {
    const mirror = {
      ...card("rmhkjz7h8z"),
      name: "Cascode mirror",
      author: "Lu Jie",
    };
    expect(matchesReviewSearch(mirror, "  MIRROR ")).toBe(true);
    expect(matchesReviewSearch(mirror, "lu jie")).toBe(true);
    expect(matchesReviewSearch(mirror, "rmhk")).toBe(true);
    expect(
      matchesReviewSearch(
        mirror,
        "https://analog-canvas.tokenzhang.com/g/rmhkjz7h8z",
      ),
    ).toBe(true);
    expect(matchesReviewSearch(mirror, "bandgap")).toBe(false);
    expect(matchesReviewSearch(mirror, "")).toBe(true);
    expect(
      reviewAuthors([
        { ...card("a"), author: "Rgeph" },
        { ...card("b"), author: "Magic Li" },
        { ...card("c"), author: "Rgeph" },
        { ...card("d"), author: "Lu Jie" },
        // A dataset's byline has its own row among the stores.
        { ...card("e"), scope: "analoggenie", author: "AnalogGenie (redrawn)" },
      ]),
    ).toEqual([
      { author: "Rgeph", count: 2 },
      { author: "Lu Jie", count: 1 },
      { author: "Magic Li", count: 1 },
    ]);
  });

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
    expect(scopeFromSearch("?scope=analogretriever")).toBe("analogretriever");
    expect(scopeFromSearch("?scope=image2net")).toBe("image2net");
    expect(scopeFromSearch("?scope=nope")).toBe("random");
    expect(scopeFromSearch("")).toBe("random");
  });
});
