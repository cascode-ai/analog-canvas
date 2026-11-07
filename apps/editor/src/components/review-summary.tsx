import { useEffect, useState } from "react";

import "../styles/review-page.css";

import { flagLabel, storesOf, type ShownReview } from "../review-queue";

interface PersonWork {
  person: string;
  reviews: number;
  passes: number;
  issues: number;
  fixes: number;
  circuits: number;
  changes: number;
  addressed: number;
}

const WORK_FIELDS = [
  "reviews",
  "passes",
  "issues",
  "fixes",
  "circuits",
  "changes",
  "addressed",
] as const;

const num = (value: number) => value.toLocaleString("en-US");

/** Each store's people, summed by person: one row per reviewer or fixer. */
function mergedPeople(lists: PersonWork[][]): PersonWork[] {
  const byPerson = new Map<string, PersonWork>();
  for (const row of lists.flat()) {
    const sum = byPerson.get(row.person);
    if (!sum) byPerson.set(row.person, { ...row });
    else for (const field of WORK_FIELDS) sum[field] += row[field];
  }
  return [...byPerson.values()].sort(
    (a, b) => b.reviews + b.fixes - (a.reviews + a.fixes),
  );
}

type Issues = {
  issues: (ShownReview & { store: string })[];
  disputed: { id: string; store: string }[];
};

/**
 * Review's statistics: who reviewed and fixed how much, and, for the Owner,
 * the open issues and disputed drawings to decide, each a link into Review.
 */
export function ReviewSummary({
  fetchLike = fetch,
}: {
  fetchLike?: typeof fetch;
}) {
  const [people, setPeople] = useState<PersonWork[] | null>(null);
  const [open, setOpen] = useState<Issues | null>(null);
  useEffect(() => {
    let cancelled = false;
    const stores = storesOf("random");
    const read = <T,>(store: string, part: string) =>
      fetchLike(`/api/gallery/review/${store}/${part}`, {
        credentials: "same-origin",
      }).then((response) =>
        response.ok ? (response.json() as Promise<T>) : null,
      );
    void Promise.all(
      stores.map((store) => read<{ people: PersonWork[] }>(store, "people")),
    )
      .then((lists) => {
        if (!cancelled)
          setPeople(mergedPeople(lists.map((each) => each?.people ?? [])));
      })
      .catch(() => undefined);
    // Only the Owner reads the issues; anyone else is answered 403.
    void Promise.all(
      stores.map((store) =>
        read<{ issues: ShownReview[]; disputed: string[] }>(
          store,
          "issues",
        ).then(
          (payload) =>
            payload && {
              issues: payload.issues.map((issue) => ({ ...issue, store })),
              disputed: payload.disputed.map((id) => ({ id, store })),
            },
        ),
      ),
    )
      .then((lists) => {
        if (cancelled || lists.some((each) => !each)) return;
        setOpen({
          issues: lists.flatMap((each) => each!.issues),
          disputed: lists.flatMap((each) => each!.disputed),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchLike]);

  const link = (store: string, id: string) =>
    `/review?scope=${store}&id=${encodeURIComponent(id)}`;
  return (
    <section className="review-summary" data-testid="review-summary">
      <div className="datasets-card">
        <h3>Reviewers · every store</h3>
        {people === null ? (
          <p className="datasets-empty">Loading…</p>
        ) : people.length === 0 ? (
          <p className="datasets-empty">No reviews or fixes yet.</p>
        ) : (
          <table className="review-people-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Reviews</th>
                <th>Passed</th>
                <th>Flagged</th>
                <th>Drawings fixed</th>
                <th>Objects changed</th>
                <th>Issues answered</th>
              </tr>
            </thead>
            <tbody>
              {people.map((row) => (
                <tr key={row.person}>
                  <td>{row.person}</td>
                  <td>{num(row.reviews)}</td>
                  <td>{num(row.passes)}</td>
                  <td>{num(row.issues)}</td>
                  <td>{num(row.circuits)}</td>
                  <td>{num(row.changes)}</td>
                  <td>{num(row.addressed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? (
        <div className="datasets-card" data-testid="review-open-issues">
          <h3>
            Open issues · {open.issues.length}
            <button
              type="button"
              className="review-export"
              onClick={() => {
                // Every open issue with its flags and comment, for whoever
                // fixes the drawings.
                const file = new Blob(
                  [
                    JSON.stringify(
                      { exportedAt: new Date().toISOString(), ...open },
                      null,
                      2,
                    ),
                  ],
                  { type: "application/json" },
                );
                const anchor = Object.assign(document.createElement("a"), {
                  href: URL.createObjectURL(file),
                  download: "review-issues.json",
                });
                anchor.click();
                URL.revokeObjectURL(anchor.href);
              }}
            >
              Export JSON
            </button>
          </h3>
          {open.issues.length === 0 ? (
            <p className="datasets-empty">No open issues.</p>
          ) : (
            <ul className="review-issue-list">
              {open.issues.slice(0, 60).map((issue) => (
                <li key={issue.id}>
                  <a href={link(issue.store, issue.entryId)}>{issue.entryId}</a>{" "}
                  {issue.flags.map(flagLabel).join(", ")}
                  {issue.note ? <span> — {issue.note}</span> : null}
                  <span className="meta"> · {issue.reviewer}</span>
                </li>
              ))}
            </ul>
          )}
          {open.disputed.length ? (
            <p className="review-disputed">
              <b>Disputed</b> (passed and flagged):{" "}
              {open.disputed.map(({ id, store }) => (
                <a key={id} href={link(store, id)}>
                  {id}
                </a>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
