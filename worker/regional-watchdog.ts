import { WATCHDOG_STALE_MS } from "./regional-projects";

type Store = {
  getByName(name: string): {
    fetch(url: string, init?: RequestInit): Promise<Response>;
  };
};
export type RegionalWatchdogEnv = {
  PROJECT_REGION?: string;
  PROJECT_SYNC_TOKEN?: string;
  GALLERY?: Store;
  PROJECTS?: Store;
  PROJECTS_STORE_NAME?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  ADMIN_EMAILS?: string;
};

/**
 * The source watches the private region from outside the border link: the
 * region pulls every few seconds, so a silent region (host down, link cut,
 * credentials broken) reaches the Owner even when the region cannot send mail.
 */
export async function watchRegionalPulls(
  env: RegionalWatchdogEnv,
  now = Date.now(),
  fetchLike: typeof fetch = fetch,
): Promise<"alert" | "recover" | null> {
  if (env.PROJECT_REGION !== "overseas" || !env.PROJECT_SYNC_TOKEN) return null;
  const store = (env.PROJECTS ?? env.GALLERY)?.getByName(
    env.PROJECTS ? (env.PROJECTS_STORE_NAME ?? "projects") : "gallery",
  );
  const to = env.ADMIN_EMAILS?.split(",")[0]?.trim();
  if (!store || !to || !env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) return null;
  const step = (body: object) =>
    store
      .fetch("https://projects/sync-watchdog", {
        method: "POST",
        body: JSON.stringify(body),
      })
      .then((r) => r.json() as Promise<{ action: "alert" | "recover" | null; lastPullAt: number | null }>);
  const { action, lastPullAt } = await step({ now });
  if (!action || lastPullAt === null) return null;
  const minutes = Math.round((now - lastPullAt) / 60_000);
  const subject =
    action === "alert"
      ? `Analog Canvas China region silent for ${minutes} min`
      : "Analog Canvas China region pulling again";
  const text =
    action === "alert"
      ? `The China region last pulled Project changes ${new Date(lastPullAt).toISOString()} (over ${WATCHDOG_STALE_MS / 60_000} min ago). Check the regional host, its border link and canvas-cn-project-sync. This repeats hourly until it recovers.`
      : `The China region pulled again at ${new Date(lastPullAt).toISOString()}.`;
  const sent = await fetchLike("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `regional-watchdog-${action}-${lastPullAt}-${Math.floor(now / 3_600_000)}`,
    },
    body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, to, subject, text }),
  }).catch(() => null);
  if (!sent?.ok) {
    if (action === "alert") await step({ now, unsent: true });
    return null;
  }
  return action;
}
