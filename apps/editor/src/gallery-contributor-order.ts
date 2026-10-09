import type { GalleryAuthorOption } from "./gallery-client";

/**
 * How the Gallery's contributor list is ordered (#1502): by circuits, the
 * server's order, or by name, letter by letter, ignoring case, with numbers
 * in their natural order.
 */
export type ContributorOrder = "count" | "name";

export const CONTRIBUTOR_ORDER_KEY = "icm.gallery.contributorOrder";

/** Whether the list names the reference datasets (#1574): "hidden" or absent. */
export const CONTRIBUTOR_DATASETS_KEY = "icm.gallery.contributorDatasets";

const byName = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/** Two contributor names in the list's A to Z order. */
export function compareContributorNames(left: string, right: string): number {
  return byName.compare(left.trim(), right.trim());
}

export function orderContributors(
  authors: readonly GalleryAuthorOption[],
  order: ContributorOrder,
): readonly GalleryAuthorOption[] {
  return order === "name"
    ? [...authors].sort(
        (left, right) =>
          compareContributorNames(left.author, right.author) ||
          right.count - left.count,
      )
    : authors;
}
