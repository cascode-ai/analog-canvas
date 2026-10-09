/**
 * The owner's and an author's tools on the wall: withdraw, reject and review
 * an entry, the duplicate report, and the passing message each one leaves.
 */
import { useEffect, useState } from "react";
import {
  announceGalleryChange,
  type GalleryFeedEntry,
} from "../gallery-client";
import type { GalleryDuplicateReport } from "../gallery-duplicates";

export function useGalleryOwnerTools({
  isOwner,
  removeManagedEntry,
}: {
  isOwner: boolean;
  removeManagedEntry: (entry: GalleryFeedEntry) => void;
}) {
  const [duplicateReport, setDuplicateReport] =
    useState<GalleryDuplicateReport | null>(null);
  const [ownerBusy, setOwnerBusy] = useState<string | null>(null);
  // A withdraw or reject says how it went in a passing message over the
  // wall, as Publish does, so the wall never moves (#1504).
  const [ownerNotice, setOwnerNotice] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);
  useEffect(() => {
    if (!ownerNotice) return;
    const timer = window.setTimeout(() => setOwnerNotice(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [ownerNotice]);
  const [rejecting, setRejecting] = useState<GalleryFeedEntry | null>(null);
  const [reviewing, setReviewing] = useState<GalleryFeedEntry | null>(null);

  async function withdrawEntry(entry: GalleryFeedEntry): Promise<void> {
    setOwnerBusy(entry.id);
    setOwnerNotice(null);
    try {
      const response = await fetch(`/api/gallery/${entry.id}/recycle`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      removeManagedEntry(entry);
      announceGalleryChange({ entryId: entry.id });
      setOwnerNotice({
        ok: true,
        text: isOwner
          ? `“${entry.name}” was moved to the recycle bin.`
          : `“${entry.name}” was withdrawn. Restore it from My submissions.`,
      });
    } catch {
      setOwnerNotice({
        ok: false,
        text: `Could not withdraw “${entry.name}”. Try again.`,
      });
    } finally {
      setOwnerBusy(null);
    }
  }

  async function rejectEntry(reason: string): Promise<void> {
    if (!rejecting || !reason.trim()) return;
    setOwnerBusy(rejecting.id);
    setOwnerNotice(null);
    try {
      const response = await fetch(`/api/gallery/${rejecting.id}/reject`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) throw new Error();
      removeManagedEntry(rejecting);
      announceGalleryChange({ entryId: rejecting.id });
      setOwnerNotice({
        ok: true,
        text: `“${rejecting.name}” was rejected and hidden from the Gallery.`,
      });
      setRejecting(null);
    } catch {
      setOwnerNotice({
        ok: false,
        text: `Could not reject “${rejecting.name}”.`,
      });
    } finally {
      setOwnerBusy(null);
    }
  }
  return {
    duplicateReport,
    setDuplicateReport,
    ownerBusy,
    ownerNotice,
    setOwnerNotice,
    rejecting,
    setRejecting,
    reviewing,
    setReviewing,
    withdrawEntry,
    rejectEntry,
  };
}
