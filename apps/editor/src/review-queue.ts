// /review: one drawing at a time, its reference beside it, a verdict and
// flags. This module is the page's data and rules; the page draws them.

/** What a reviewer can flag, with its key; the last two are community's. */
const REVIEW_FLAGS = [
  { key: "wrong", label: "Wrong circuit", hotkey: "1" },
  { key: "netlist", label: "Netlist error", hotkey: "2" },
  { key: "loose", label: "Too loose", hotkey: "3" },
  { key: "ugly", label: "Too ugly", hotkey: "4" },
  { key: "overlap", label: "Overlap / unreadable", hotkey: "5" },
  { key: "wiring", label: "Wiring break", hotkey: "6" },
  { key: "incomplete", label: "Incomplete", hotkey: "7" },
  { key: "simple", label: "Too simple", hotkey: "8", community: true },
  { key: "duplicate", label: "Duplicate", hotkey: "9", community: true },
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

/** A box on one of Review's two pictures, in fractions of its size. */
export interface ReviewMark {
  side: "original" | "redraw";
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** Boxes the reviewer drew on the pictures. */
  marks?: ReviewMark[];
  at: string;
  resolved: boolean;
}

/** One change of an entry's drawing, as GET /api/gallery/<id>/reviews lists it. */
export interface EntryFix {
  id: string;
  editor: string;
  devices: number;
  wires: number;
  labels: number;
  addressed: number;
  at: string;
}

/** One card of GET /api/gallery/review/<scope>/queue, with its store. */
export interface ReviewCard {
  id: string;
  /** The store it came from: `community` or a dataset's key. */
  scope: string;
  name: string;
  author: string;
  /** Who fixed a dataset's drawing: a second byline. */
  fixedBy?: string[];
  previewRevision: string;
  components: number;
  reviews: number;
  likes: number;
  likedByViewer: boolean;
  mine: ShownReview | null;
  /** A community circuit's reference image, if its author gave one. */
  reference?: { revision: string };
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

/** The stores /review reads, as its sidebar lists them: the community first. */
export const REVIEW_STORES = ["community", "analoggenie", "circuitthink"];

/** Random (the default) mixes every store; any other scope is one store. */
export function scopeFromSearch(search: string): string {
  const scope = new URLSearchParams(search).get("scope") ?? "";
  return REVIEW_STORES.includes(scope) ? scope : "random";
}

/**
 * Whether only drawings with a reference figure show: yes unless the
 * address turns it off (`refs=0`), so a reviewer starts on pairs to compare.
 */
export function referencesOnlyFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("refs") !== "0";
}

/**
 * Random's order: every store's drawings shuffled, the reviewer's unreviewed
 * ones first. Each store alone keeps the server's order.
 */
export function shuffledQueue(
  cards: readonly ReviewCard[],
  draw: () => number = Math.random,
): ReviewCard[] {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(draw() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return [
    ...shuffled.filter((card) => !reviewed(card)),
    ...shuffled.filter(reviewed),
  ];
}

/** A drawing with something to compare it with: a figure or a reference. */
export const hasReference = (card: ReviewCard) =>
  Boolean(card.comparison || card.reference);
