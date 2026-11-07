// /review: one drawing at a time, its reference beside it, a verdict and
// flags. This module is the page's data and rules; the page draws them.

/** What a reviewer can flag, with its key; the last two are community's. */
const REVIEW_FLAGS = [
  { key: "wrong", label: "Wrong circuit", hotkey: "1" },
  { key: "loose", label: "Too loose", hotkey: "2" },
  { key: "ugly", label: "Too ugly", hotkey: "3" },
  { key: "overlap", label: "Overlap / unreadable", hotkey: "4" },
  { key: "wiring", label: "Wiring break", hotkey: "5" },
  { key: "incomplete", label: "Incomplete", hotkey: "6" },
  { key: "simple", label: "Too simple", hotkey: "7", community: true },
  { key: "duplicate", label: "Duplicate", hotkey: "8", community: true },
  { key: "other", label: "Other", hotkey: "0" },
] as const;

export function flagsFor(scope: string) {
  return REVIEW_FLAGS.filter(
    (flag) => scope === "community" || !("community" in flag),
  );
}

export function flagLabel(key: string): string {
  return REVIEW_FLAGS.find((flag) => flag.key === key)?.label ?? key;
}

export interface ShownReview {
  id: string;
  entryId: string;
  revision: string;
  current: boolean;
  reviewer: string;
  verdict: "pass" | "issue";
  flags: string[];
  note: string;
  at: string;
  resolved: boolean;
}

/** One card of GET /api/gallery/review/<scope>/queue. */
export interface ReviewCard {
  id: string;
  name: string;
  author: string;
  previewRevision: string;
  components: number;
  reviews: number;
  mine: ShownReview | null;
  comparison?: {
    verdict: string;
    category: string;
    detail: string;
    reason: string;
    figureRevision: string;
  };
}

/** Whether the reviewer's review of this card counts (its current version). */
export const reviewed = (card: ReviewCard) => card.mine?.current === true;

export function reviewProgress(cards: readonly ReviewCard[]) {
  let passed = 0;
  let flagged = 0;
  for (const card of cards)
    if (reviewed(card)) {
      if (card.mine!.verdict === "pass") passed += 1;
      else flagged += 1;
    }
  return { passed, flagged, left: cards.length - passed - flagged };
}

/** The next card after `from` the reviewer has not reviewed, wrapping. */
export function nextUnreviewed(
  cards: readonly ReviewCard[],
  from: number,
): number | null {
  for (let step = 1; step <= cards.length; step += 1) {
    const index = (from + step) % cards.length;
    if (!reviewed(cards[index]!)) return index;
  }
  return null;
}

/** The card with the reviewer's new review in place. */
export function withReview(card: ReviewCard, review: ShownReview): ReviewCard {
  return {
    ...card,
    mine: review,
    reviews: card.reviews + (reviewed(card) ? 0 : 1),
  };
}

export const REVIEW_SCOPES = ["analoggenie", "circuitthink", "community"];

export function scopeFromSearch(search: string): string {
  const scope = new URLSearchParams(search).get("scope") ?? "";
  return REVIEW_SCOPES.includes(scope) ? scope : "analoggenie";
}
