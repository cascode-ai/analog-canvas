/**
 * The owner's and an author's tools on the wall: withdraw, reject and review
 * an entry, queue its simulation check, the duplicate report, and the
 * passing message each one leaves.
 */
import { useState } from "react";
import {
  announceGalleryChange,
  type GalleryFeedEntry,
} from "../gallery-client";
import type { GalleryDuplicateReport } from "../gallery-duplicates";
import { queueGallerySimulationChecks } from "../gallery-simulation-checks";
import { galleryLifecycleRequest } from "../gallery-lifecycle-request";
import { galleryPublicationRequest } from "../gallery-publication-request";
import { requestFailureOf } from "../request-failure";

export function useGalleryOwnerTools({
  isOwner,
  removeManagedEntry,
  setOwnerNotice,
}: {
  isOwner: boolean;
  removeManagedEntry: (entry: GalleryFeedEntry) => void;
  setOwnerNotice: (notice: { text: string; ok: boolean } | null) => void;
}) {
  const [duplicateReport, setDuplicateReport] =
    useState<GalleryDuplicateReport | null>(null);
  const [ownerBusy, setOwnerBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<GalleryFeedEntry | null>(null);
  const [reviewing, setReviewing] = useState<GalleryFeedEntry | null>(null);

  async function withdrawEntry(entry: GalleryFeedEntry): Promise<void> {
    setOwnerBusy(entry.id);
    setOwnerNotice(null);
    let failureMessage: string | undefined;
    try {
      const response = await galleryLifecycleRequest(entry.id, "recycle");
      if (!response.ok) {
        failureMessage = (await requestFailureOf(response)).message;
        throw new Error();
      }
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
        text:
          failureMessage ??
          `Could not confirm withdrawal of “${entry.name}”. Try again.`,
      });
    } finally {
      setOwnerBusy(null);
    }
  }

  async function rejectEntry(reason: string, notify: boolean): Promise<void> {
    if (!rejecting || !reason.trim()) return;
    setOwnerBusy(rejecting.id);
    setOwnerNotice(null);
    try {
      const response = await galleryPublicationRequest(
        `/api/gallery/${rejecting.id}/reject`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason.trim(), notify }),
        },
      );
      if (!response.ok) throw new Error();
      const { emailed } = (await response.json().catch(() => ({}))) as {
        emailed?: boolean;
      };
      removeManagedEntry(rejecting);
      announceGalleryChange({ entryId: rejecting.id });
      // The rejection stands either way; a failed email is said, not hidden.
      setOwnerNotice(
        notify && emailed !== true
          ? {
              ok: false,
              text: `“${rejecting.name}” was rejected and hidden, but the email to its author was not sent.`,
            }
          : {
              ok: true,
              text: `“${rejecting.name}” was rejected and hidden from the Gallery${notify ? "; its author was emailed the reason" : ""}.`,
            },
      );
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
  /** The Owner's accounts queue the server's check of its testbench (#1545). */
  async function verifySimulation(entry: GalleryFeedEntry): Promise<void> {
    setOwnerNotice(null);
    const queued = await queueGallerySimulationChecks(fetch, {
      ids: [entry.id],
    });
    setOwnerNotice(
      !queued || queued.failures?.length || queued.missing?.includes(entry.id)
        ? {
            ok: false,
            text: `Could not queue a simulation check of “${entry.name}”. Try again.`,
          }
        : queued.noTestbench.includes(entry.id)
          ? {
              ok: true,
              text: `“${entry.name}” has no testbench to check.`,
            }
          : {
              ok: true,
              text: `“${entry.name}” waits for its simulation check, ${queued.waiting} in the queue. The checks run one at a time within minutes.`,
            },
    );
  }
  return {
    duplicateReport,
    setDuplicateReport,
    ownerBusy,
    rejecting,
    setRejecting,
    reviewing,
    setReviewing,
    withdrawEntry,
    rejectEntry,
    verifySimulation,
  };
}
