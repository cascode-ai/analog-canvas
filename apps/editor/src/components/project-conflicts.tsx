import { useState } from "react";
import { InlineConfirm } from "./inline-confirm";
import { downloadBlob } from "../hosts/download-link";

type Branch = {
  head: string;
  origin: string;
  name: string;
  projectText: string;
  updatedAt: string;
};

/** Conflict contents remain downloadable until the user explicitly chooses a head. */
export function ProjectConflicts({
  id,
  onResolved,
}: {
  id: string;
  onResolved(): void;
}) {
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const endpoint = `/api/projects/${encodeURIComponent(id)}`;
  async function review() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { credentials: "same-origin" });
      const body = await response.json();
      if (response.ok) {
        onResolved();
        return;
      }
      if (
        response.status !== 409 ||
        !Array.isArray(body.conflicts) ||
        !body.conflicts.length
      )
        throw new Error(
          "Could not load conflicting versions. Retry after signing in.",
        );
      setBranches(body.conflicts);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load versions.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function choose(branch: Branch) {
    const response = await fetch(endpoint, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "if-match": branch.head },
      body: JSON.stringify({
        name: branch.name,
        projectText: branch.projectText,
        resolveHeads: branches!.map((item) => item.head),
      }),
    });
    if (!response.ok)
      throw new Error(
        "The versions changed or saving failed. Close and review them again; nothing was overwritten.",
      );
    onResolved();
  }
  return (
    <div className="shelf-conflicts">
      <button type="button" disabled={loading} onClick={() => void review()}>
        {loading ? "Loading versions…" : "Review conflicting versions"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {branches ? (
        <section aria-label="Conflicting Project versions">
          <p>
            Both regions saved changes. Download the versions to compare or
            combine them. Choosing one makes it the current draft; unsaved
            editor tabs stay unchanged.
          </p>
          {branches.map((branch, index) => (
            <div key={branch.head}>
              <p>
                Version {index + 1}: {branch.name} · {branch.origin} ·{" "}
                {branch.updatedAt}
              </p>
              <button
                type="button"
                onClick={() =>
                  downloadBlob(
                    new Blob([branch.projectText], {
                      type: "application/json",
                    }),
                    `conflict-${index + 1}.icproj.json`,
                  )
                }
              >
                Download version {index + 1}
              </button>
              <InlineConfirm
                confirmLabel={`Use version ${index + 1} as current`}
                cancelLabel="Keep reviewing"
                onConfirm={() => choose(branch)}
              >
                Choose version {index + 1}
              </InlineConfirm>
            </div>
          ))}
          <button type="button" onClick={() => setBranches(null)}>
            Close review
          </button>
        </section>
      ) : null}
    </div>
  );
}
