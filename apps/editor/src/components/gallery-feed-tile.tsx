/**
 * One tile on the wall: a published circuit with its marks, byline, like,
 * tags and owner controls, or a bundled example standing in for one.
 */
import { lazy, Suspense } from "react";
import { TilePreview } from "./tile-preview";
import { galleryPreviewUrl, type GalleryFeedEntry } from "../gallery-client";
import type { BundledGalleryTile } from "./gallery-bundled-fallback";
import { galleryTagLabel } from "../gallery-tag-label";
import type { GallerySource } from "../gallery-sources";

const GalleryTileMenu = lazy(() =>
  import("./gallery-owner-controls").then((module) => ({
    default: module.GalleryTileMenu,
  })),
);
const GalleryOwnerRejectButton = lazy(() =>
  import("./gallery-owner-controls").then((module) => ({
    default: module.GalleryOwnerRejectButton,
  })),
);

/**
 * The like mark, drawn rather than typed.
 *
 * An emoji is a different picture on every platform and carries its own
 * colour, which on a wall of circuit drawings reads as a sticker. This is one
 * path that inherits the button's colour: outlined until the circuit is
 * liked, filled once it is, so the state is legible without reading a count.
 */
export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13Z" />
    </svg>
  );
}

function savedAtLabel(createdAt: string): string {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime())
    ? createdAt
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

export function GalleryWallTile({
  entry,
  linkedId,
  duplicates,
  datasetWall,
  isOwner,
  viewerId,
  ownerBusy,
  selectedTags,
  selectAuthor,
  toggleLike,
  toggleTag,
  setRejecting,
  setReviewing,
  withdrawEntry,
  verifySimulation,
}: {
  entry: GalleryFeedEntry;
  linkedId: string | null;
  duplicates: ReadonlyMap<
    string,
    { group: number; count: number; revision: string | undefined }
  >;
  datasetWall: GallerySource | null;
  isOwner: boolean;
  viewerId: string | null;
  ownerBusy: string | null;
  selectedTags: readonly string[];
  selectAuthor: (
    nextAuthor: string | null,
    nextOwnerUserId?: string | null,
  ) => void;
  toggleLike: (entryId: string) => Promise<void>;
  toggleTag: (tag: string) => void;
  setRejecting: (entry: GalleryFeedEntry) => void;
  setReviewing: (entry: GalleryFeedEntry) => void;
  withdrawEntry: (entry: GalleryFeedEntry) => Promise<void>;
  /** The Owner's accounts' "Verify simulation" (#1545); absent for anyone else. */
  verifySimulation?: ((entry: GalleryFeedEntry) => Promise<void>) | undefined;
}) {
  return (
    <div
      className={
        entry.id === linkedId
          ? "gallery-tile-wrap is-linked"
          : "gallery-tile-wrap"
      }
    >
      <a
        className="gallery-tile"
        href={`/g/${entry.id}`}
        data-testid={`gallery-tile-${entry.id}`}
      >
        <TilePreview
          key={`${entry.id}-${entry.previewRevision}`}
          src={galleryPreviewUrl(entry.id, entry.previewRevision)}
          alt={`Preview of ${entry.name}`}
          {...(entry.previewWidth !== undefined &&
          entry.previewHeight !== undefined
            ? {
                width: entry.previewWidth,
                height: entry.previewHeight,
              }
            : {})}
        />
        <span className="gallery-tile-copy">
          <span className="gallery-tile-name">
            {entry.name}
            {duplicates.has(entry.id) &&
            duplicates.get(entry.id)!.revision === entry.previewRevision ? (
              <span
                className="gallery-duplicate-badge"
                title={`Same netlist as ${duplicates.get(entry.id)!.count - 1} other circuits. See duplicate group ${duplicates.get(entry.id)!.group}.`}
              >
                Duplicate · group {duplicates.get(entry.id)!.group}
              </span>
            ) : null}
            {entry.netlistable ? (
              <span
                className="gallery-tile-mark gallery-tile-netlist"
                data-testid={`gallery-netlist-${entry.id}`}
                title="Extracts to a SPICE netlist"
              >
                Netlist
              </span>
            ) : null}
            {entry.aiGenerated ? (
              <span
                className="gallery-tile-mark gallery-tile-ai"
                data-testid={`gallery-ai-${entry.id}`}
                title="AI-generated, as its publisher says"
              >
                AI
              </span>
            ) : null}
            {entry.simVerified ? (
              <span
                className="gallery-tile-mark gallery-tile-sim"
                data-testid={`gallery-sim-${entry.id}`}
                title="Its testbench ran again on the hosted simulator and met every Spec it states"
              >
                Sim
              </span>
            ) : null}
          </span>
          <span className="gallery-tile-meta">
            {entry.author ? (
              <>
                <button
                  type="button"
                  className="gallery-tile-author"
                  data-testid={`gallery-author-${entry.id}`}
                  title={`Show circuits by ${entry.author}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    selectAuthor(entry.author, entry.ownerUserId ?? null);
                  }}
                >
                  {entry.author}
                </button>
                {" · "}
              </>
            ) : null}
            {savedAtLabel(entry.createdAt)}
            {datasetWall ? null : " · "}
            {datasetWall ? null : (
              <button
                type="button"
                className="gallery-tile-like"
                data-testid={`gallery-like-${entry.id}`}
                aria-pressed={entry.likedByViewer === true}
                title={
                  entry.likedByViewer ? "Remove your like" : "Like this circuit"
                }
                aria-label={
                  entry.likedByViewer
                    ? `Remove your like from ${entry.name}`
                    : `Like ${entry.name}`
                }
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void toggleLike(entry.id);
                }}
              >
                <HeartIcon filled={entry.likedByViewer === true} />
                {entry.likes ?? 0}
              </button>
            )}
          </span>
          {entry.description ? (
            <span
              className="gallery-tile-description"
              title={entry.description}
            >
              {entry.description}
            </span>
          ) : null}
          {entry.tags && entry.tags.length > 0 ? (
            <span className="gallery-tile-tags">
              {entry.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="gallery-tile-tag"
                  data-testid={`gallery-tile-tag-${entry.id}-${tag.replace(/\s/gu, "-")}`}
                  title={`Filter by ${galleryTagLabel(tag)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!selectedTags.includes(tag)) toggleTag(tag);
                  }}
                >
                  {galleryTagLabel(tag)}
                </button>
              ))}
            </span>
          ) : null}
        </span>
      </a>
      {!datasetWall &&
      (isOwner ||
        verifySimulation ||
        (!!viewerId && viewerId === entry.ownerUserId)) ? (
        <Suspense fallback={null}>
          {isOwner ? (
            <GalleryOwnerRejectButton
              entry={entry}
              busy={ownerBusy === entry.id}
              onReject={() => setRejecting(entry)}
            />
          ) : null}
          <GalleryTileMenu
            entry={entry}
            busy={ownerBusy === entry.id}
            administrator={isOwner}
            onReview={() => setReviewing(entry)}
            onWithdraw={() => void withdrawEntry(entry)}
            {...(verifySimulation
              ? { onVerifySimulation: () => void verifySimulation(entry) }
              : {})}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export function GalleryBundledTile({ tile }: { tile: BundledGalleryTile }) {
  return (
    <a
      className="gallery-tile gallery-tile-bundled"
      href={`/editor?example=${tile.id}`}
      data-testid={`gallery-bundled-${tile.id}`}
    >
      <span
        className="gallery-tile-preview"
        // Server-free preview: our own renderer's escaped SVG output.
        dangerouslySetInnerHTML={{ __html: tile.svg }}
      />
      <span className="gallery-tile-copy">
        <span className="gallery-tile-kicker">Built-in example</span>
        <span className="gallery-tile-name">{tile.name}</span>
        <span className="gallery-tile-description" title={tile.description}>
          {tile.description}
        </span>
      </span>
    </a>
  );
}
