/**
 * The sidebar's quick filters: Needs attention and its reason, the two pairs
 * of marks (AI or by hand, with or without a netlist), and Liked.
 */
import type { ReactNode } from "react";
import type { GalleryFilterState } from "../gallery-filters";
import {
  GALLERY_ISSUE_KINDS,
  galleryIssueKindLabel,
} from "../gallery-issue-kinds";
import { HeartIcon } from "./gallery-feed-tile";

/**
 * The "With netlist" filter's glyph: the SPICE deck a circuit extracts to.
 * A star said "rating" on a wall of circuits and sat beside the like heart,
 * where two accents competed for the same meaning. The cards spell the mark
 * out instead, as "Netlist": the glyph alone was easy to miss there.
 */
function NetlistIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
      <path d="M8 8.5h8M8 12.5h8M8 16.5h5" />
    </svg>
  );
}

/** A quick filter's row, highlighted while it narrows the wall. */
function quickMarkClass(selected: boolean): string {
  return selected
    ? "gallery-tag-option gallery-tag-mark gallery-tag-selected"
    : "gallery-tag-option gallery-tag-mark";
}

/** "Without netlist": the netlist glyph, struck through. */
function NoNetlistIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="3" width="15" height="18" rx="2.5" />
      <path d="M3 21 21 3" />
    </svg>
  );
}

/** "Made by hand": a person, the other side of the AI mark. */
function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function GalleryQuickFilters({
  signedIn,
  isOwner,
  attentionOnly,
  attentionKind,
  attentionKindCounts,
  aiFilter,
  netlistableOnly,
  withoutNetlistOnly,
  likedOnly,
  updateFilters,
  quickCount,
}: {
  signedIn: boolean;
  isOwner: boolean;
  attentionOnly: boolean;
  attentionKind: string | null;
  attentionKindCounts: Record<string, number>;
  aiFilter: GalleryFilterState["ai"];
  netlistableOnly: boolean;
  withoutNetlistOnly: boolean;
  likedOnly: boolean;
  updateFilters: (patch: Partial<GalleryFilterState>) => void;
  quickCount: (
    key:
      "attention" | "netlistable" | "withoutNetlist" | "ai" | "human" | "liked",
  ) => ReactNode;
}) {
  return (
    <>
      {signedIn || attentionOnly ? (
        <button
          type="button"
          className="gallery-sidebar-option"
          aria-pressed={attentionOnly}
          onClick={() =>
            updateFilters({
              attention: !attentionOnly,
              attentionKind: null,
            })
          }
          data-testid="gallery-filter-attention"
        >
          <span>Needs attention{signedIn && !isOwner ? " · Mine" : ""}</span>
          {quickCount("attention")}
        </button>
      ) : null}
      {attentionOnly ? (
        <label className="gallery-attention-reason">
          <span>Reason</span>
          <select
            value={attentionKind ?? ""}
            onChange={(event) =>
              updateFilters({
                attentionKind: event.currentTarget.value || null,
              })
            }
            data-testid="gallery-filter-attention-reason"
          >
            <option value="">Every reason</option>
            {GALLERY_ISSUE_KINDS.filter(
              (kind) =>
                kind === attentionKind || (attentionKindCounts[kind] ?? 0) > 0,
            ).map((kind) => (
              <option key={kind} value={kind}>
                {galleryIssueKindLabel(kind)} (
                {(attentionKindCounts[kind] ?? 0).toLocaleString()})
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {/* Two pairs. The sides of a pair exclude each other: choosing
          one moves the choice there, and choosing it again shows
          both sides. */}
      <button
        type="button"
        className={quickMarkClass(aiFilter === "ai")}
        data-testid="gallery-filter-ai"
        aria-pressed={aiFilter === "ai"}
        title={
          aiFilter === "ai"
            ? "Show circuits however they were made"
            : "Show only AI-generated circuits"
        }
        onClick={() => updateFilters({ ai: aiFilter === "ai" ? null : "ai" })}
      >
        <span className="gallery-tile-mark gallery-tile-ai">AI</span>{" "}
        <span>AI generated</span>
        {quickCount("ai")}
      </button>
      <button
        type="button"
        className={quickMarkClass(aiFilter === "human")}
        data-testid="gallery-filter-human"
        aria-pressed={aiFilter === "human"}
        title={
          aiFilter === "human"
            ? "Show circuits however they were made"
            : "Show only circuits not marked AI-generated"
        }
        onClick={() =>
          updateFilters({
            ai: aiFilter === "human" ? null : "human",
          })
        }
      >
        <PersonIcon /> <span>Human made</span>
        {quickCount("human")}
      </button>
      <button
        type="button"
        className={quickMarkClass(netlistableOnly)}
        data-testid="gallery-filter-netlistable"
        aria-pressed={netlistableOnly}
        title={
          netlistableOnly
            ? "Stop filtering by netlist"
            : "Show only circuits that extract to a netlist"
        }
        onClick={() =>
          updateFilters({
            netlistable: !netlistableOnly,
            withoutNetlist: false,
          })
        }
      >
        <NetlistIcon /> <span>With netlist</span>
        {quickCount("netlistable")}
      </button>
      <button
        type="button"
        className={quickMarkClass(withoutNetlistOnly)}
        data-testid="gallery-filter-without-netlist"
        aria-pressed={withoutNetlistOnly}
        title={
          withoutNetlistOnly
            ? "Stop filtering by netlist"
            : "Show only circuits that do not extract to a netlist"
        }
        onClick={() =>
          updateFilters({
            withoutNetlist: !withoutNetlistOnly,
            netlistable: false,
          })
        }
      >
        <NoNetlistIcon /> <span>Without netlist</span>
        {quickCount("withoutNetlist")}
      </button>
      {signedIn || likedOnly ? (
        <button
          type="button"
          className={quickMarkClass(likedOnly)}
          data-testid="gallery-filter-liked"
          aria-pressed={likedOnly}
          title={
            likedOnly
              ? "Stop filtering by your likes"
              : "Show only circuits you have liked"
          }
          onClick={() => updateFilters({ liked: !likedOnly })}
        >
          <HeartIcon filled={true} /> <span>Liked</span>
          {quickCount("liked")}
        </button>
      ) : null}
    </>
  );
}
