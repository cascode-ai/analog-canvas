/**
 * A `/g/<id>` link on a computer opens the editor only once the Gallery is
 * known to hold that circuit: a withdrawn or mistyped one shows so, as a
 * phone does, rather than a blank New Circuit (#2159).
 */
import { useEffect, useState, type ReactNode } from "react";

/**
 * Whether the reader can read the entry. Only a 404 says it is gone; an
 * outage or a refusal leaves the editor to say what failed.
 */
export function galleryEntryPresence(
  fetchLike: typeof fetch,
  entryId: string,
): Promise<boolean> {
  return fetchLike(`/api/gallery/${encodeURIComponent(entryId)}?summary=1`, {
    credentials: "same-origin",
  }).then(
    (response) => response.status !== 404,
    () => true,
  );
}

/** The editor, or the missing page, once `presence` has answered. */
export function GalleryEntryGate({
  presence,
  missing,
  children,
}: {
  /** Null when the page opens no Gallery link. */
  presence: Promise<boolean> | null;
  missing: ReactNode;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(presence ? null : true);
  useEffect(() => {
    let cancelled = false;
    void presence?.then((found) => {
      if (!cancelled) setPresent(found);
    });
    return () => {
      cancelled = true;
    };
  }, [presence]);
  if (present === null)
    return <div className="analytics-loading">Loading editor…</div>;
  return present ? children : missing;
}
