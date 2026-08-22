import { useEffect, useState } from "react";

/**
 * Version history of one gallery entry, for reviewers and the entry's
 * owner: every update snapshotted the previous state; Restore adopts a
 * version after snapshotting the current one, so restores are themselves
 * reversible. An ordinary owner's restore re-enters review server-side.
 */

export interface GalleryEntryVersion {
  versionId: string;
  versionNo: number;
  name: string;
  author: string;
  tags: string[];
  createdAt: string;
}

export async function loadEntryVersions(
  entryId: string,
  fetchLike: typeof fetch = fetch,
): Promise<GalleryEntryVersion[] | null> {
  try {
    const response = await fetchLike(`/api/gallery/${entryId}/versions`, {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      versions?: GalleryEntryVersion[];
    };
    return payload.versions ?? [];
  } catch {
    return null;
  }
}

async function restoreVersion(
  entryId: string,
  versionId: string,
  fetchLike: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchLike(
      `/api/gallery/${entryId}/versions/${versionId}/restore`,
      { method: "POST", credentials: "same-origin" },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export interface VersionHistoryDialogProps {
  entryId: string;
  entryName: string;
  onRestored(): void;
  onClose(): void;
}

export function VersionHistoryDialog({
  entryId,
  entryName,
  onRestored,
  onClose,
}: VersionHistoryDialogProps) {
  const [versions, setVersions] = useState<GalleryEntryVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadEntryVersions(entryId).then((loaded) => {
      if (!cancelled) setVersions(loaded ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [entryId]);

  async function restore(versionId: string): Promise<void> {
    setBusy(true);
    setError(null);
    const ok = await restoreVersion(entryId, versionId);
    setBusy(false);
    if (ok) onRestored();
    else setError("Could not restore this version.");
  }

  return (
    <div
      className="insert-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="publish-gallery-dialog version-history-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-history-title"
        data-testid="version-history-dialog"
      >
        <header className="publish-gallery-header">
          <p>Every update keeps the previous state</p>
          <h2 id="version-history-title">Version history — {entryName}</h2>
        </header>
        {versions === null ? (
          <p className="publish-gallery-note">Loading history…</p>
        ) : versions.length === 0 ? (
          <p className="publish-gallery-note" data-testid="version-empty">
            No earlier versions yet — history starts with the first update.
          </p>
        ) : (
          <div className="version-list">
            {versions.map((version) => (
              <article
                key={version.versionId}
                className="version-row"
                data-testid={`version-${version.versionNo}`}
              >
                <img
                  src={`/api/gallery/${entryId}/versions/${version.versionId}/preview.svg`}
                  alt={`Version ${version.versionNo} preview`}
                  loading="lazy"
                />
                <div className="version-copy">
                  <b>
                    v{version.versionNo} · {version.name}
                  </b>
                  <small>
                    {version.author ? `${version.author} · ` : ""}
                    {new Date(version.createdAt).toLocaleString()}
                    {version.tags.length > 0
                      ? ` · ${version.tags.join(", ")}`
                      : ""}
                  </small>
                </div>
                <button
                  type="button"
                  className="publish-gallery-primary"
                  data-testid={`version-restore-${version.versionNo}`}
                  disabled={busy}
                  onClick={() => void restore(version.versionId)}
                >
                  Restore
                </button>
              </article>
            ))}
          </div>
        )}
        {error ? (
          <p role="alert" className="publish-gallery-error">
            {error}
          </p>
        ) : null}
        <div className="publish-gallery-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
