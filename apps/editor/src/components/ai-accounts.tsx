import { useEffect, useState } from "react";

/**
 * An Owner's AI account ("seat"), listed in the Worker's AI_SEATS: its seat,
 * such as ai-designer-1, and the model's name it publishes under.
 */
interface AiAccount {
  id: string;
  seat: string;
  displayName: string;
}

async function listAiAccounts(): Promise<AiAccount[] | null> {
  try {
    const response = await fetch("/api/auth/ai-accounts", {
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    return ((await response.json()) as { accounts: AiAccount[] }).accounts;
  } catch {
    return null;
  }
}

async function switchToAiAccount(userId: string): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/ai-accounts/switch", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The Owner's AI accounts. Switching makes this browser the AI account, for
 * Agents to draw and publish in, and the ↩ button beside its name in the
 * header switches back; no code or password exists for one.
 */
export function AiAccountsContent() {
  const [accounts, setAccounts] = useState<AiAccount[] | null | "failed">(null);
  const [busy, setBusy] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void listAiAccounts().then((listed) => {
      if (!cancelled) setAccounts(listed ?? "failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (accounts === null)
    return <p className="gallery-status">Loading AI accounts…</p>;
  if (accounts === "failed")
    return (
      <p className="gallery-status" data-testid="ai-accounts-failed">
        Could not load the AI accounts — try again later.
      </p>
    );
  return (
    <div className="account-settings" data-testid="ai-accounts">
      <section className="account-page-section" aria-labelledby="ai-list">
        <h3 id="ai-list">AI accounts</h3>
        {accounts.map((account) => (
          <div
            className="account-page-row"
            key={account.id}
            data-testid={`ai-account-${account.seat}`}
          >
            <div>
              <span className="account-page-value">{account.displayName}</span>
              <span className="account-page-note">{account.seat}</span>
            </div>
            <button
              type="button"
              className="account-page-primary"
              data-testid={`ai-account-switch-${account.seat}`}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setSwitchFailed(false);
                void switchToAiAccount(account.id).then((switched) => {
                  setBusy(false);
                  // The account page starts over as the AI account.
                  if (switched) window.location.assign("/account");
                  else setSwitchFailed(true);
                });
              }}
            >
              Switch to this account
            </button>
          </div>
        ))}
        {switchFailed ? (
          <p className="account-notice" role="alert">
            Could not switch — try again.
          </p>
        ) : null}
        <p className="account-page-note">
          Switching makes this browser the AI account, for Agents to draw and
          publish in; the ↩ button beside its name in the header switches back
          to you. What it publishes is always marked AI-generated.
        </p>
      </section>
    </div>
  );
}
