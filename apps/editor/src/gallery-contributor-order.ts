import type { GalleryAuthorOption } from "./gallery-client";

/**
 * How the Gallery's contributor list is ordered (#1502): by circuits, the
 * server's order, or by name, letter by letter, ignoring case, with numbers
 * in their natural order.
 */
export type ContributorOrder = "count" | "name";

export const CONTRIBUTOR_ORDER_KEY = "icm.gallery.contributorOrder";

const byName = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

export function orderContributors(
  authors: readonly GalleryAuthorOption[],
  order: ContributorOrder,
): readonly GalleryAuthorOption[] {
  return order === "name"
    ? [...authors].sort(
        (left, right) =>
          byName.compare(left.author.trim(), right.author.trim()) ||
          right.count - left.count,
      )
    : authors;
}
