import { useEffect, useState } from "react";

import { copyMinted } from "./owner-tokens";

/** One read key as the server lists it; never its secret. */
export interface ReadKeyRow {
  id: string;
  label: string;
  scope: "gallery" | "full";
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  uses: number;
}

const KEYS_URL = "/api/auth/read-keys";
const DAYS = [30, 90, 180, 365] as const;

const day = (iso: string) => iso.slice(0, 10);

async function listKeys(): Promise<ReadKeyRow[] | null> {
  try {
    const response = await fetch(KEYS_URL, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return ((await response.json()) as { keys?: ReadKeyRow[] }).keys ?? [];
  } catch {
    return null;
  }
}

async function mintKey(fields: {
  label: string;
  scope: ReadKeyRow["scope"];
  days: number;
}): Promise<{ id: string; token: string }> {
  const response = await fetch(KEYS_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new Error(`read-keys ${response.status}`);
  return (await response.json()) as { id: string; token: string };
}

async function revokeKey(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${KEYS_URL}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}

type Copy =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "copied"; label: string }
  | { status: "failed"; message: string };

/**
 * The Owner's read keys, on the account's Settings: each lets one person or
 * script read the Gallery without signing in, until its reads are public. One
 * click mints a key and copies it, never showing it; keys are listed with
 * their use and each can be revoked.
 */
export function ReadKeysSection() {
  const [keys, setKeys] = useState<ReadKeyRow[] | null | "failed">(null);
  const [label, setLabel] = useState("");
  const [full, setFull] = useState(false);
  const [days, setDays] = useState<number>(90);
  const [copy, setCopy] = useState<Copy>({ status: "idle" });
  const [revoking, setRevoking] = useState<string | null>(null);
  const reload = () =>
    void listKeys().then((read) => setKeys(read ?? "failed"));
  useEffect(reload, []);
  const copyKey = async () => {
    const name = label.trim();
    if (!name || copy.status === "busy") return;
    setCopy({ status: "busy" });
    const minted = mintKey({
      label: name,
      scope: full ? "full" : "gallery",
      days,
    });
    try {
      await copyMinted(minted);
      setCopy({ status: "copied", label: name });
      setLabel("");
    } catch {
      // A key that never reached the clipboard is revoked at once, so no
      // secret is left that nobody holds.
      const made = await minted.catch(() => null);
      if (made) await revokeKey(made.id);
      setCopy({
        status: "failed",
        message: made
          ? "Could not copy to the clipboard — try again."
          : "Could not make a key — try again.",
      });
    }
    reload();
  };
  const now = Date.now();
  return (
    <section
      className="account-page-section"
      aria-labelledby="account-read-keys"
      data-testid="read-keys"
    >
      <h3 id="account-read-keys">Read keys</h3>
      <p className="account-page-note">
        Lets one person or script read the whole Gallery without signing in,
        with <code>Authorization: Bearer &lt;key&gt;</code>. A key never writes.
        Revoking one stops it within a minute.
      </p>
      <form
        className="account-page-row read-key-form"
        onSubmit={(event) => {
          event.preventDefault();
          void copyKey();
        }}
      >
        <input
          aria-label="Who the key is for"
          placeholder="Who it is for"
          data-testid="read-key-label"
          maxLength={80}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
        <label>
          <input
            type="checkbox"
            data-testid="read-key-full"
            checked={full}
            onChange={(event) => setFull(event.currentTarget.checked)}
          />{" "}
          Reviews and history
        </label>
        <select
          aria-label="Valid for"
          data-testid="read-key-days"
          value={days}
          onChange={(event) => setDays(Number(event.currentTarget.value))}
        >
          {DAYS.map((count) => (
            <option key={count} value={count}>
              {count} days
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="account-page-primary"
          data-testid="read-key-copy"
          disabled={!label.trim() || copy.status === "busy"}
        >
          {copy.status === "busy" ? "Copying…" : "Copy read key"}
        </button>
      </form>
      {copy.status === "copied" ? (
        <p
          className="account-page-note"
          role="status"
          data-testid="read-key-copied"
        >
          Read key for {copy.label} copied. Send it to them; it is not shown
          again.
        </p>
      ) : copy.status === "failed" ? (
        <p
          className="account-page-note"
          role="alert"
          data-testid="read-key-failed"
        >
          {copy.message}
        </p>
      ) : null}
      {keys === "failed" ? (
        <p className="account-page-note">Could not list the keys.</p>
      ) : keys && keys.length > 0 ? (
        <ul className="read-key-list" data-testid="read-key-list">
          {keys.map((key) => (
            <li key={key.id} className="account-page-row">
              <div>
                <span className="account-page-value">{key.label}</span>
                <span className="account-page-label">
                  {key.scope === "full" ? "Reviews and history · " : ""}
                  Made {day(key.createdAt)} ·{" "}
                  {Date.parse(key.expiresAt) > now
                    ? `expires ${day(key.expiresAt)}`
                    : "expired"}{" "}
                  ·{" "}
                  {key.lastUsedAt
                    ? `${key.uses} reads, last ${day(key.lastUsedAt)}`
                    : "never used"}
                </span>
              </div>
              <button
                type="button"
                data-testid="read-key-revoke"
                disabled={revoking === key.id}
                onClick={() => {
                  setRevoking(key.id);
                  void revokeKey(key.id).then(() => {
                    setRevoking(null);
                    reload();
                  });
                }}
              >
                {revoking === key.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
