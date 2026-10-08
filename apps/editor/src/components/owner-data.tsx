import { Fragment, useEffect, useState } from "react";

/** One author's public circuits, counted (`GET /api/gallery/owner-data`). */
export interface OwnerDataAuthor {
  author: string;
  /** The account ID, or `legacy:` and the byline of an account-less entry. */
  key: string;
  circuits: number;
  averageParts: number | null;
  ai: number;
  withNetlist: number;
  likes: number;
  latest: string;
}

/** One of an author's public circuits. */
export interface OwnerDataCircuit {
  id: string;
  name: string;
  createdAt: string;
  parts: number | null;
  netlistable: boolean;
  aiGenerated: boolean;
  likes: number;
}

interface OwnerData {
  authors: OwnerDataAuthor[];
}

async function readOwnerData<T>(query = ""): Promise<T | null> {
  try {
    const response = await fetch(`/api/gallery/owner-data${query}`, {
      credentials: "same-origin",
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

const day = (iso: string) => iso.slice(0, 10);

/**
 * The Owner's own look at the Gallery (#1446): every author's public
 * circuits counted, and one author's circuits on a click. Public facts only,
 * and only the Owner's own accounts can read them.
 */
export function OwnerDataContent() {
  const [data, setData] = useState<OwnerData | null | "failed">(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [circuits, setCircuits] = useState<
    Record<string, OwnerDataCircuit[] | "failed">
  >({});
  useEffect(() => {
    let cancelled = false;
    void readOwnerData<OwnerData>().then((read) => {
      if (!cancelled) setData(read ?? "failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (data === null)
    return <p className="gallery-status">Loading the Gallery's numbers…</p>;
  if (data === "failed")
    return (
      <p className="gallery-status" data-testid="owner-data-failed">
        Could not load the numbers — try again later.
      </p>
    );
  const toggle = (key: string) => {
    setOpen((current) => (current === key ? null : key));
    // Read once; a failed read is tried again on the next click.
    if (circuits[key] && circuits[key] !== "failed") return;
    void readOwnerData<{ circuits: OwnerDataCircuit[] }>(
      `?author=${encodeURIComponent(key)}`,
    ).then((read) =>
      setCircuits((known) => ({ ...known, [key]: read?.circuits ?? "failed" })),
    );
  };
  const total = data.authors.reduce(
    (sum, row) => ({
      circuits: sum.circuits + row.circuits,
      ai: sum.ai + row.ai,
      withNetlist: sum.withNetlist + row.withNetlist,
    }),
    { circuits: 0, ai: 0, withNetlist: 0 },
  );
  const needle = query.trim().toLowerCase();
  const authors = needle
    ? data.authors.filter((row) => row.author.toLowerCase().includes(needle))
    : data.authors;
  return (
    <div className="owner-data" data-testid="owner-data">
      <section className="account-page-section" aria-labelledby="owner-authors">
        <h3 id="owner-authors">Authors</h3>
        <p className="account-page-note" data-testid="owner-data-totals">
          {total.circuits} circuits by {data.authors.length} authors ·{" "}
          {total.ai} AI generated · {total.circuits - total.ai} human made ·{" "}
          {total.withNetlist} with netlist
        </p>
        <input
          className="owner-data-search"
          type="search"
          aria-label="Search authors"
          placeholder="Search authors…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="owner-data-scroll">
          <table className="owner-data-table">
            <thead>
              <tr>
                <th>Author</th>
                <th className="owner-data-number">Circuits</th>
                <th className="owner-data-number">Avg parts</th>
                <th className="owner-data-number">AI</th>
                <th className="owner-data-number">Human</th>
                <th className="owner-data-number">Netlist</th>
                <th className="owner-data-number">Likes</th>
                <th>Latest</th>
              </tr>
            </thead>
            <tbody>
              {authors.map((row) => {
                const listed = circuits[row.key];
                return (
                  <Fragment key={row.key}>
                    <tr data-testid="owner-data-author">
                      <td>
                        <button
                          type="button"
                          className="owner-data-author"
                          aria-expanded={open === row.key}
                          onClick={() => toggle(row.key)}
                        >
                          {row.author}
                        </button>
                      </td>
                      <td className="owner-data-number">{row.circuits}</td>
                      <td className="owner-data-number">
                        {row.averageParts ?? "—"}
                      </td>
                      <td className="owner-data-number">{row.ai}</td>
                      <td className="owner-data-number">
                        {row.circuits - row.ai}
                      </td>
                      <td className="owner-data-number">{row.withNetlist}</td>
                      <td className="owner-data-number">{row.likes}</td>
                      <td className="owner-data-date">{day(row.latest)}</td>
                    </tr>
                    {open === row.key ? (
                      <tr className="owner-data-detail">
                        <td colSpan={8}>
                          {listed === undefined ? (
                            <p className="account-page-note">Loading…</p>
                          ) : listed === "failed" ? (
                            <p className="account-page-note">
                              Could not load these circuits.
                            </p>
                          ) : (
                            <table
                              className="owner-data-table"
                              data-testid="owner-data-circuits"
                            >
                              <tbody>
                                {listed.map((circuit) => (
                                  <tr key={circuit.id}>
                                    <td>
                                      <a href={`/g/${circuit.id}`}>
                                        {circuit.name}
                                      </a>
                                    </td>
                                    <td className="owner-data-date">
                                      {day(circuit.createdAt)}
                                    </td>
                                    <td className="owner-data-number">
                                      {circuit.parts ?? "—"} parts
                                    </td>
                                    <td>{circuit.aiGenerated ? "AI" : ""}</td>
                                    <td>
                                      {circuit.netlistable ? "Netlist" : ""}
                                    </td>
                                    <td className="owner-data-number">
                                      {circuit.likes} ♥
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
