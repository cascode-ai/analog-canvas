// What a failed request to the Worker came to, as one short line a screen can
// show. The Worker's refusals stay distinct (worker/api-rate-limit.ts,
// worker/gallery.ts) instead of all reading as "unavailable".
import { dailyOpenResetTime, isDailyAllowanceRefusal } from "./daily-allowance";

export type RequestFailureKind =
  "rate-limited" | "daily-limit" | "not-found" | "server-error" | "offline";

export interface RequestFailure {
  failure: RequestFailureKind;
  message: string;
}

/** Whether a read's answer is a failure rather than what it asked for. */
export function isRequestFailure(value: unknown): value is RequestFailure {
  return typeof value === "object" && value !== null && "failure" in value;
}

/** A fetch that threw: the browser never reached the Worker. */
export const OFFLINE_FAILURE: RequestFailure = {
  failure: "offline",
  message: "Could not reach the server. Check your connection and try again.",
};

/** An OK reply whose body is not the answer it should be. */
export const UNREADABLE_REPLY: RequestFailure = {
  failure: "server-error",
  message: "The server's reply could not be read. Try again later.",
};

function retrySeconds(response: Response, body: unknown): number {
  const fromBody = (body as { retryAfterSeconds?: unknown } | null)
    ?.retryAfterSeconds;
  if (typeof fromBody === "number" && fromBody > 0) return Math.ceil(fromBody);
  const fromHeader = Number(response.headers.get("retry-after"));
  return Number.isFinite(fromHeader) && fromHeader > 0
    ? Math.ceil(fromHeader)
    : 60;
}

/**
 * Classifies a reply that is not OK. Each caller answers a 401 itself, with
 * its own sign-in line.
 */
export async function requestFailureOf(
  response: Response,
  fallback?: string,
): Promise<RequestFailure> {
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: unknown; resetAt?: unknown } | null;
  const { status } = response;
  if (body?.error === "action-superseded")
    return {
      failure: "server-error",
      message:
        "The earlier operation completed, but the circuit's status has changed since. Refresh to see its current state.",
    };
  if (body?.error === "action-propagation-pending")
    return {
      failure: "server-error",
      message:
        "The change was saved. Synchronization is still finishing; retry to confirm.",
    };
  if (body?.error === "action-unconfirmed")
    return {
      failure: "server-error",
      message:
        "The result is not confirmed. Retry to check the same operation.",
    };
  if (await isDailyAllowanceRefusal(response)) {
    const resetAt = typeof body?.resetAt === "string" ? body.resetAt : "";
    return {
      failure: "daily-limit",
      message: Number.isNaN(Date.parse(resetAt))
        ? "Today's limit is reached. Try again tomorrow."
        : `Today's limit is reached. Try again after ${dailyOpenResetTime({ resetAt })}.`,
    };
  }
  if (status === 429)
    return {
      failure: "rate-limited",
      message: `Too many requests. Wait ${retrySeconds(response, body)} seconds and try again.`,
    };
  if (status === 404) return { failure: "not-found", message: "Not found." };
  return {
    failure: "server-error",
    message:
      fallback ??
      (status >= 500
        ? `The server could not answer (${status}). Try again later.`
        : `The server refused the request (${status}).`),
  };
}
