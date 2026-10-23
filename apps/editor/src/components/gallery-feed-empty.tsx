import type { GalleryFeedState } from "../gallery-client";
import {
  galleryFiltersNarrowQuery,
  type GalleryFilterState,
} from "../gallery-filters";

/**
 * What an empty wall says. A wall that could not load says why, whatever
 * filters (restored on every visit) narrow it: a filter's "nothing matches"
 * would be untrue then (2026-10-23).
 */
export function GalleryWallEmpty({
  state,
  filters,
  narrowedName,
  signedIn,
  datasetName,
}: {
  state: Pick<GalleryFeedState, "status" | "failure" | "entries">;
  filters: GalleryFilterState;
  narrowedName: string | null;
  signedIn: boolean;
  datasetName: string | null;
}) {
  if (state.status === "unavailable")
    return (
      <p className="gallery-status" data-testid="gallery-unavailable">
        {state.failure ?? "Gallery is unavailable. Try again later."}
      </p>
    );
  if (state.entries.length > 0) return null;
  const {
    author,
    ownerUserId,
    tags: selectedTags,
    netlistable: netlistableOnly,
    withoutNetlist: withoutNetlistOnly,
    ai: aiFilter,
    liked: likedOnly,
    parts: selectedParts,
  } = filters;
  const narrowedToAuthor = author !== null || ownerUserId !== null;
  return (
    <>
      {selectedTags.length > 0 && !narrowedToAuthor ? (
        <p className="gallery-status" data-testid="gallery-tags-empty">
          No circuits match the selected tags.
        </p>
      ) : null}
      {narrowedToAuthor ? (
        <p className="gallery-status" data-testid="gallery-filter-empty">
          No public circuits by {narrowedName} yet.
        </p>
      ) : null}
      {!narrowedToAuthor &&
      selectedTags.length === 0 &&
      !netlistableOnly &&
      !withoutNetlistOnly &&
      aiFilter === null &&
      !likedOnly &&
      selectedParts.length > 0 ? (
        <p className="gallery-status" data-testid="gallery-parts-empty">
          No circuits of the chosen sizes.
        </p>
      ) : null}
      {!narrowedToAuthor &&
      (netlistableOnly ||
        withoutNetlistOnly ||
        aiFilter !== null ||
        likedOnly) ? (
        <p className="gallery-status" data-testid="gallery-mark-empty">
          {likedOnly && !signedIn
            ? "Sign in to collect the circuits you like."
            : likedOnly && netlistableOnly
              ? "None of the circuits you liked extracts to a netlist yet."
              : likedOnly && !withoutNetlistOnly && aiFilter === null
                ? "You have not liked any circuits yet."
                : likedOnly ||
                    [
                      netlistableOnly,
                      withoutNetlistOnly,
                      aiFilter !== null,
                    ].filter(Boolean).length > 1
                  ? "No circuits match these filters."
                  : netlistableOnly
                    ? "No circuits here extract to a netlist yet."
                    : withoutNetlistOnly
                      ? "Every circuit here extracts to a netlist."
                      : aiFilter === "ai"
                        ? "No AI-generated circuits here yet."
                        : aiFilter === "dataset"
                          ? "No dataset circuits here yet."
                          : "No circuits made by hand here yet."}
        </p>
      ) : null}
      {!galleryFiltersNarrowQuery(filters) ? (
        <p className="gallery-status" data-testid="gallery-empty">
          {datasetName
            ? `No ${datasetName} circuits imported yet.`
            : "No published circuits yet."}
        </p>
      ) : null}
    </>
  );
}
