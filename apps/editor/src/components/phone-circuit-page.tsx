/**
 * A phone views a circuit and leaves drawing to a computer or a tablet
 * (2026-10-14): the circuit's picture, what it is, its SPICE netlist on
 * request, and its link to open elsewhere. Neither page loads the editor;
 * someone who wants it anyway opens it for this tab.
 */
import "../styles/gallery-entry.css";
import "../styles/phone-circuit.css";

import { useEffect, useState } from "react";

import { usePageTitle } from "../app/use-page-title";
import { isDailyAllowanceRefusal } from "../daily-allowance";
import { galleryPreviewUrl } from "../gallery-client";
import { openEditorOnPhone } from "../phone-viewing";
import { GalleryChrome } from "./gallery-chrome";

export interface PhoneEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
  previewRevision: string;
  tags?: string[];
  netlistable?: boolean;
  aiGenerated?: boolean;
}

export type PhoneNetlist =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "blocked"; reasons: string[] }
  | { status: "unavailable"; message: string };

type VisitStats = { pv: number; uv: number } | null | undefined;

function EditorAnyway() {
  return (
    <button
      type="button"
      className="phone-circuit-editor-anyway"
      data-testid="phone-editor-anyway"
      onClick={() => openEditorOnPhone()}
    >
      Open the editor anyway
    </button>
  );
}

/** What /editor shows on a phone. */
export function PhoneEditorNotice({ visitStats }: { visitStats?: VisitStats }) {
  usePageTitle("Editor");
  return (
    <div className="review-shell">
      <GalleryChrome subtitle="Editor" visitStats={visitStats} />
      <main className="phone-circuit" data-testid="phone-editor-notice">
        <h1>Drawing needs a computer or a tablet</h1>
        <p className="phone-circuit-description">
          On a phone, browse the Gallery and open any circuit to look at it.
          Open this site on a computer or a tablet to draw.
        </p>
        <div className="phone-circuit-actions">
          <a className="phone-circuit-primary" href="/">
            Browse the Gallery
          </a>
        </div>
        <EditorAnyway />
      </main>
    </div>
  );
}

/** One circuit as a phone shows it; the page supplies its data. */
export function PhoneCircuitView({
  entry,
  netlist,
  copied,
  onShowNetlist,
  onCopyLink,
}: {
  entry: PhoneEntry;
  netlist: PhoneNetlist | null;
  copied: boolean;
  onShowNetlist: () => void;
  onCopyLink: () => void;
}) {
  const day = entry.createdAt.slice(0, 10);
  return (
    <main className="phone-circuit" data-testid="phone-circuit">
      <h1>{entry.name}</h1>
      <p className="phone-circuit-meta">
        {entry.author ? `${entry.author} · ` : ""}
        {day}
        {entry.netlistable ? " · Netlist" : ""}
        {entry.aiGenerated ? " · AI" : ""}
      </p>
      <div className="phone-circuit-preview">
        <img
          src={galleryPreviewUrl(entry.id, entry.previewRevision)}
          alt={`Schematic of ${entry.name}`}
        />
      </div>
      {entry.description ? (
        <p className="phone-circuit-description">{entry.description}</p>
      ) : null}
      {entry.tags?.length ? (
        <ul className="phone-circuit-tags">
          {entry.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}
      <div className="phone-circuit-actions">
        <a href="/">Back to the Gallery</a>
        <button type="button" onClick={onCopyLink}>
          {copied ? "Link copied" : "Copy link"}
        </button>
        {netlist === null ? (
          <button
            type="button"
            data-testid="phone-show-netlist"
            onClick={onShowNetlist}
          >
            Show SPICE netlist
          </button>
        ) : null}
      </div>
      {netlist?.status === "loading" ? (
        <p className="phone-circuit-note">Writing the netlist…</p>
      ) : netlist?.status === "ready" ? (
        <pre className="phone-circuit-netlist" data-testid="phone-netlist">
          {netlist.text}
        </pre>
      ) : netlist?.status === "blocked" ? (
        <p className="phone-circuit-note" data-testid="phone-netlist-blocked">
          This drawing does not yet make a netlist: {netlist.reasons.join("; ")}
        </p>
      ) : netlist?.status === "unavailable" ? (
        <p className="phone-circuit-note">{netlist.message}</p>
      ) : null}
      <p className="phone-circuit-note">
        To edit, copy or simulate this circuit, open its link on a computer or a
        tablet.
      </p>
      <EditorAnyway />
    </main>
  );
}

type PageState =
  | { status: "loading" }
  | { status: "ready"; entry: PhoneEntry }
  | { status: "message"; message: string };

/** What /g/<id> shows on a phone. */
export function PhoneCircuitPage({
  entryId,
  visitStats,
}: {
  entryId: string | null;
  visitStats?: VisitStats;
}) {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [netlist, setNetlist] = useState<PhoneNetlist | null>(null);
  const [copied, setCopied] = useState(false);
  usePageTitle(
    entryId ? (state.status === "ready" ? state.entry.name : "Circuit") : null,
  );
  useEffect(() => {
    if (!entryId) return;
    let cancelled = false;
    void fetch(`/api/gallery/${encodeURIComponent(entryId)}?summary=1`, {
      credentials: "same-origin",
    })
      .then(async (response) => {
        const message =
          response.status === 401
            ? "Sign in to see this circuit."
            : response.status === 404
              ? "This circuit is not in the Gallery."
              : !response.ok
                ? "The circuit could not be loaded. Try again later."
                : null;
        if (message) return { status: "message" as const, message };
        const body = (await response.json()) as { entry?: PhoneEntry };
        return body.entry
          ? { status: "ready" as const, entry: body.entry }
          : {
              status: "message" as const,
              message: "The circuit could not be loaded. Try again later.",
            };
      })
      .catch(() => ({
        status: "message" as const,
        message: "The circuit could not be loaded. Check your connection.",
      }))
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [entryId]);
  if (!entryId) return <PhoneEditorNotice visitStats={visitStats} />;
  const showNetlist = () => {
    setNetlist({ status: "loading" });
    void fetch(`/api/gallery/${encodeURIComponent(entryId)}?netlist=spice`, {
      credentials: "same-origin",
    })
      .then(async (response): Promise<PhoneNetlist> => {
        if (await isDailyAllowanceRefusal(response))
          return {
            status: "unavailable",
            message:
              "You have opened today's allowance of circuits; the netlist opens again tomorrow.",
          };
        if (!response.ok)
          return {
            status: "unavailable",
            message: "The netlist could not be loaded. Try again later.",
          };
        const body = (await response.json()) as {
          netlist?: { text?: string; blocked?: string[] };
        };
        return typeof body.netlist?.text === "string"
          ? { status: "ready", text: body.netlist.text }
          : { status: "blocked", reasons: body.netlist?.blocked ?? [] };
      })
      .catch((): PhoneNetlist => ({
        status: "unavailable",
        message: "The netlist could not be loaded. Check your connection.",
      }))
      .then(setNetlist);
  };
  const copyLink = () => {
    void navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  return (
    <div className="review-shell">
      <GalleryChrome subtitle="Circuit" visitStats={visitStats} />
      {state.status === "ready" ? (
        <PhoneCircuitView
          entry={state.entry}
          netlist={netlist}
          copied={copied}
          onShowNetlist={showNetlist}
          onCopyLink={copyLink}
        />
      ) : (
        <main className="phone-circuit">
          <p className="phone-circuit-note" data-testid="phone-circuit-status">
            {state.status === "loading"
              ? "Loading the circuit…"
              : state.message}
          </p>
          <div className="phone-circuit-actions">
            <a href="/">Back to the Gallery</a>
          </div>
        </main>
      )}
    </div>
  );
}

export default PhoneCircuitPage;
