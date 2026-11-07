import { useEffect, useState } from "react";

/** One Owner upload token as the server lists it (#1769); never its secret. */
export interface OwnerTokenRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Where the dataset import (`pnpm gallery:import-batches --post`) reads it. */
const OWNER_TOKEN_FILE = "~/.config/analog-canvas/owner-token";

const day = (iso: string) => iso.slice(0, 10);

/** The label a new token takes: this computer's kind and today, `Mac 2026-11-06`. */
export function defaultTokenLabel(
  platform: string,
  today = new Date().toISOString(),
): string {
  const kind = /mac/iu.test(platform)
    ? "Mac"
    : /win/iu.test(platform)
      ? "Windows"
      : /linux/iu.test(platform)
        ? "Linux"
        : "Computer";
  return `${kind} ${day(today)}`;
}

const TOKENS_URL = "/api/auth/owner-tokens";

async function listTokens(): Promise<OwnerTokenRow[] | null> {
  try {
    const response = await fetch(TOKENS_URL, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (
      ((await response.json()) as { tokens?: OwnerTokenRow[] }).tokens ?? []
    );
  } catch {
    return null;
  }
}

async function mintToken(
  label: string,
): Promise<{ id: string; token: string }> {
  const response = await fetch(TOKENS_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  });
  if (!response.ok) throw new Error(`owner-tokens ${response.status}`);
  return (await response.json()) as { id: string; token: string };
}

async function revokeToken(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${TOKENS_URL}/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Puts a token being minted on the clipboard. Handing the clipboard the
 * pending text keeps the click's permission while the server answers
 * (Safari refuses a write after an await); elsewhere the text is written
 * once it arrives.
 */
export async function copyMinted(
  minted: Promise<{ token: string }>,
): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": minted.then(
          ({ token }) => new Blob([token], { type: "text/plain" }),
        ),
      }),
    ]);
    return;
  }
  const { token } = await minted;
  await navigator.clipboard.writeText(token);
}

type Copy =
  | { status: "idle" }
  | { status: "busy" }
  | { status: "copied" }
  | { status: "failed"; message: string };

/**
 * The Owner's upload tokens (#1769), on the account's Settings: one click
 * mints a token for this computer and copies it, never showing it, for the
 * dataset import to read from the command line; the tokens are listed by
 * label and each can be revoked.
 */
export function OwnerTokensSection() {
  const [tokens, setTokens] = useState<OwnerTokenRow[] | null | "failed">(null);
  const [label, setLabel] = useState(() =>
    defaultTokenLabel(
      typeof navigator === "undefined" ? "" : navigator.platform,
    ),
  );
  const [copy, setCopy] = useState<Copy>({ status: "idle" });
  const [revoking, setRevoking] = useState<string | null>(null);
  const reload = () =>
    void listTokens().then((read) => setTokens(read ?? "failed"));
  useEffect(reload, []);
  const copyToken = async () => {
    const name = label.trim();
    if (!name || copy.status === "busy") return;
    setCopy({ status: "busy" });
    const minted = mintToken(name);
    try {
      await copyMinted(minted);
      setCopy({ status: "copied" });
    } catch {
      // A token that never reached the clipboard is revoked at once, so no
      // secret is left that nobody holds.
      const made = await minted.catch(() => null);
      if (made) await revokeToken(made.id);
      setCopy({
        status: "failed",
        message: made
          ? "Could not copy to the clipboard — try again."
          : "Could not make a token — try again.",
      });
    }
    reload();
  };
  return (
    <section
      className="account-page-section"
      aria-labelledby="account-owner-tokens"
      data-testid="owner-tokens"
    >
      <h3 id="account-owner-tokens">Upload token</h3>
      <p className="account-page-note">
        Lets this computer upload dataset redraws from the command line. Copy
        one, then save it as <code>{OWNER_TOKEN_FILE}</code>.
      </p>
      <form
        className="account-page-row owner-token-form"
        onSubmit={(event) => {
          event.preventDefault();
          void copyToken();
        }}
      >
        <input
          className="owner-token-label"
          aria-label="Token label"
          data-testid="owner-token-label"
          maxLength={80}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
        <button
          type="submit"
          className="account-page-primary"
          data-testid="owner-token-copy"
          disabled={!label.trim() || copy.status === "busy"}
        >
          {copy.status === "busy" ? "Copying…" : "Copy upload token"}
        </button>
      </form>
      {copy.status === "copied" ? (
        <p
          className="account-page-note owner-token-done"
          role="status"
          data-testid="owner-token-copied"
        >
          Upload token copied. Save it on this computer as{" "}
          <code>{OWNER_TOKEN_FILE}</code> to upload from the command line.
        </p>
      ) : copy.status === "failed" ? (
        <p
          className="account-page-note owner-token-error"
          role="alert"
          data-testid="owner-token-failed"
        >
          {copy.message}
        </p>
      ) : null}
      {tokens === "failed" ? (
        <p className="account-page-note">Could not list the tokens.</p>
      ) : tokens && tokens.length > 0 ? (
        <ul className="owner-token-list" data-testid="owner-token-list">
          {tokens.map((token) => (
            <li key={token.id} className="account-page-row">
              <div>
                <span className="account-page-value">{token.label}</span>
                <span className="account-page-label">
                  Made {day(token.createdAt)} ·{" "}
                  {token.lastUsedAt
                    ? `last used ${day(token.lastUsedAt)}`
                    : "never used"}
                </span>
              </div>
              <button
                type="button"
                data-testid="owner-token-revoke"
                disabled={revoking === token.id}
                onClick={() => {
                  setRevoking(token.id);
                  void revokeToken(token.id).then(() => {
                    setRevoking(null);
                    reload();
                  });
                }}
              >
                {revoking === token.id ? "Revoking…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
