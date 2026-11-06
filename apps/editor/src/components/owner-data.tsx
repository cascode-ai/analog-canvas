import { Fragment, useEffect, useState } from "react";

import {
  AuthorStatsView,
  type AuthorStatsPayload,
  type GalleryStatsSummary,
  readGalleryStats,
} from "./gallery-stats";

/** One author's public circuits, counted (`GET /api/gallery/owner-data`). */
export interface OwnerDataAuthor {
  author: string;
  /** The account ID, or `legacy:` and the byline of an account-less entry. */
  key: string;
  circuits: number;
  /** The parts of its circuits in all, null while none is counted. */
  components: number | null;
  /** Its circuits' transistors counted so far, and how many are still to count. */
  transistors: number;
  transistorsPending: number;
  ai: number;
  withNetlist: number;
  likes: number;
  /** How often others opened its circuits, in all. */
  opens: number;
  latest: string;
}

/** One of an author's public circuits. */
export interface OwnerDataCircuit {
  id: string;
  name: string;
  createdAt: string;
  parts: number | null;
  transistors: number | null;
  netlistable: boolean;
  /** It carries a testbench: the Sim badge. */
  simulatable: boolean;
  aiGenerated: boolean;
  likes: number;
  opens: number;
  /** Opens in the last seven days, today included. */
  opensLastWeek: number;
}

/** A circuit among the most opened, the reference datasets' too. */
export interface OwnerDataOpened {
  id: string;
  name: string;
  author: string;
  opens: number;
  opensLastWeek: number;
}

interface OwnerData {
  authors: OwnerDataAuthor[];
  mostOpened?: OwnerDataOpened[];
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

/** An author's circuits as the circuit table counts them: parts as components. */
const withComponents = (
  read: AuthorStatsPayload<OwnerDataCircuit>,
): OwnerAuthorStats => ({
  ...read,
  circuits: read.circuits.map((circuit) => ({
    ...circuit,
    components: circuit.parts,
  })),
});

/** One author's circuits, with the circuit table's own field names. */
type OwnerAuthorStats = AuthorStatsPayload<
  OwnerDataCircuit & { components: number | null }
>;

const readAuthor = (key: string) =>
  readOwnerData<AuthorStatsPayload<OwnerDataCircuit>>(
    `?author=${encodeURIComponent(key)}`,
  );

/** The Recount: every public circuit's transistors counted again, in batches. */
type Recount =
  | { status: "idle" }
  | { status: "running"; counted: number; total: number | null }
  | { status: "done"; counted: number }
  | { status: "failed" };

async function recountBatch(
  after: string,
): Promise<{ counted: number; remaining: number; next: string | null } | null> {
  try {
    const response = await fetch("/api/gallery/owner-data/recount", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ after }),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * The Owner's own look at the Gallery (#1446): every author's public
 * circuits counted, and on a click the panel the author sees on their own
 * Statistics tab, with likes and opens beside. Public facts only, and only
 * the Owner's own accounts can read them.
 */
export function OwnerDataContent() {
  const [data, setData] = useState<OwnerData | null | "failed">(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [circuits, setCircuits] = useState<
    Record<string, OwnerAuthorStats | "failed">
  >({});
  // The whole Gallery's statistics, which each author's sit beside.
  const [library, setLibrary] = useState<GalleryStatsSummary>();
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [recount, setRecount] = useState<Recount>({ status: "idle" });
  useEffect(() => {
    let cancelled = false;
    void readOwnerData<OwnerData>().then((read) => {
      if (!cancelled) setData(read ?? "failed");
    });
    void readGalleryStats().then((read) => {
      if (!cancelled && read) setLibrary(read.summary);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  // The open author's circuits, read once until a Recount clears them.
  const openCircuits = open === null ? null : circuits[open];
  useEffect(() => {
    if (open === null || openCircuits !== undefined) return;
    let cancelled = false;
    void readAuthor(open).then((read) => {
      if (!cancelled)
        setCircuits((known) => ({
          ...known,
          [open]: read ? withComponents(read) : "failed",
        }));
    });
    return () => {
      cancelled = true;
    };
  }, [open, openCircuits]);
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
    // A failed read is tried again on the next click.
    if (circuits[key] === "failed")
      setCircuits((known) => {
        const kept = { ...known };
        delete kept[key];
        return kept;
      });
  };
  const refreshAuthor = (key: string) => {
    setRefreshing(key);
    void readAuthor(key).then((read) => {
      setRefreshing(null);
      // A failed refresh keeps the numbers already shown.
      if (read)
        setCircuits((known) => ({ ...known, [key]: withComponents(read) }));
    });
  };
  const runRecount = async () => {
    setRecount({ status: "running", counted: 0, total: null });
    let after = "";
    let counted = 0;
    for (;;) {
      const batch = await recountBatch(after);
      if (!batch) {
        setRecount({ status: "failed" });
        return;
      }
      counted += batch.counted;
      setRecount({
        status: "running",
        counted,
        total: counted + batch.remaining,
      });
      if (batch.next === null) break;
      after = batch.next;
    }
    // The authors again, and each author's circuits read afresh when opened.
    const read = await readOwnerData<OwnerData>();
    if (read) setData(read);
    setCircuits({});
    setRecount({ status: "done", counted });
  };
  const total = data.authors.reduce(
    (sum, row) => ({
      circuits: sum.circuits + row.circuits,
      components: sum.components + (row.components ?? 0),
      transistors: sum.transistors + row.transistors,
      ai: sum.ai + row.ai,
      withNetlist: sum.withNetlist + row.withNetlist,
    }),
    { circuits: 0, components: 0, transistors: 0, ai: 0, withNetlist: 0 },
  );
  const needle = query.trim().toLowerCase();
  const authors = needle
    ? data.authors.filter((row) => row.author.toLowerCase().includes(needle))
    : data.authors;
  const mostOpened = data.mostOpened ?? [];
  return (
    <div className="owner-data" data-testid="owner-data">
      <section className="account-page-section" aria-labelledby="owner-opened">
        <h3 id="owner-opened">Most opened</h3>
        <p className="account-page-note">
          Every time a signed-in reader opens someone else&rsquo;s circuit; its
          author, curators and AI accounts are not counted.
        </p>
        {mostOpened.length === 0 ? (
          <p className="account-page-note" data-testid="owner-data-opened-none">
            No opens counted yet.
          </p>
        ) : (
          <div className="owner-data-scroll">
            <table className="owner-data-table" data-testid="owner-data-opened">
              <thead>
                <tr>
                  <th className="owner-data-number">#</th>
                  <th>Circuit</th>
                  <th>Author</th>
                  <th className="owner-data-number">Opens</th>
                  <th className="owner-data-number">Last 7 days</th>
                </tr>
              </thead>
              <tbody>
                {mostOpened.map((circuit, index) => (
                  <tr key={circuit.id}>
                    <td className="owner-data-number">{index + 1}</td>
                    <td>
                      <a href={`/g/${circuit.id}`}>{circuit.name}</a>
                    </td>
                    <td>{circuit.author}</td>
                    <td className="owner-data-number">{circuit.opens}</td>
                    <td className="owner-data-number">
                      {circuit.opensLastWeek}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="account-page-section" aria-labelledby="owner-authors">
        <h3 id="owner-authors">Authors</h3>
        <p className="account-page-note" data-testid="owner-data-totals">
          {total.circuits} circuits by {data.authors.length} authors ·{" "}
          {total.components.toLocaleString("en-US")} components ·{" "}
          {total.transistors.toLocaleString("en-US")} transistors · {total.ai}{" "}
          AI generated · {total.circuits - total.ai} human made ·{" "}
          {total.withNetlist} with netlist
        </p>
        <div className="owner-data-tools">
          <input
            className="owner-data-search"
            type="search"
            aria-label="Search authors"
            placeholder="Search authors…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <button
            type="button"
            className="owner-data-recount"
            data-testid="owner-data-recount"
            disabled={recount.status === "running"}
            onClick={() => void runRecount()}
            title="Count every public circuit's devices again"
          >
            {recount.status === "running" ? "Recounting…" : "Recount"}
          </button>
          <span
            className="owner-data-recount-status"
            role="status"
            data-testid="owner-data-recount-status"
          >
            {recount.status === "running"
              ? recount.total === null
                ? "Starting…"
                : `${recount.counted.toLocaleString("en-US")} of ${recount.total.toLocaleString("en-US")} circuits`
              : recount.status === "done"
                ? `${recount.counted.toLocaleString("en-US")} circuits recounted`
                : recount.status === "failed"
                  ? "Recount stopped — try again"
                  : null}
          </span>
        </div>
        <div className="owner-data-scroll">
          <table className="owner-data-table">
            <thead>
              <tr>
                <th>Author</th>
                <th className="owner-data-number">Circuits</th>
                <th className="owner-data-number">Components</th>
                <th className="owner-data-number">Transistors</th>
                <th className="owner-data-number">AI</th>
                <th className="owner-data-number">Human</th>
                <th className="owner-data-number">Netlist</th>
                <th className="owner-data-number">Likes</th>
                <th className="owner-data-number">Opens</th>
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
                        {row.components?.toLocaleString("en-US") ?? "—"}
                      </td>
                      <td
                        className="owner-data-number"
                        title={
                          row.transistorsPending
                            ? `${row.transistorsPending} circuits not counted yet`
                            : undefined
                        }
                      >
                        {row.transistors.toLocaleString("en-US")}
                        {row.transistorsPending ? (
                          <span className="owner-data-pending">
                            {" "}
                            +{row.transistorsPending} pending
                          </span>
                        ) : null}
                      </td>
                      <td className="owner-data-number">{row.ai}</td>
                      <td className="owner-data-number">
                        {row.circuits - row.ai}
                      </td>
                      <td className="owner-data-number">{row.withNetlist}</td>
                      <td className="owner-data-number">{row.likes}</td>
                      <td className="owner-data-number">{row.opens}</td>
                      <td className="owner-data-date">{day(row.latest)}</td>
                    </tr>
                    {open === row.key ? (
                      <tr className="owner-data-detail">
                        <td colSpan={10}>
                          {listed === undefined ? (
                            <p className="account-page-note">Loading…</p>
                          ) : listed === "failed" ? (
                            <p className="account-page-note">
                              Could not load these circuits.
                            </p>
                          ) : (
                            <div data-testid="owner-data-circuits">
                              <AuthorStatsView
                                stats={listed}
                                library={library}
                                who={row.author}
                                refreshing={refreshing === row.key}
                                onRefresh={() => refreshAuthor(row.key)}
                                columns={[
                                  {
                                    key: "likes",
                                    label: "Likes",
                                    value: (circuit) => circuit.likes,
                                  },
                                  {
                                    key: "opens",
                                    label: "Opens",
                                    value: (circuit) => circuit.opens,
                                  },
                                  {
                                    key: "week",
                                    label: "Last 7 days",
                                    value: (circuit) => circuit.opensLastWeek,
                                  },
                                ]}
                              />
                            </div>
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
