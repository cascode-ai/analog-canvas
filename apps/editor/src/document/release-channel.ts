/**
 * Which release channel this editor is being served from (ADR 0057).
 *
 * The same build serves the public site and the preview; only the Worker
 * knows which, and it says so at /api/channel. Anything short of a clear
 * "preview" answer is production: a failed request, an old Worker without
 * the endpoint, or a test with no network must never dress the public site
 * up as a preview.
 */
export type ReleaseChannel = "production" | "preview";

export async function loadReleaseChannel(
  fetchLike: typeof fetch | null = typeof fetch === "function" ? fetch : null,
): Promise<ReleaseChannel> {
  if (!fetchLike) return "production";
  try {
    const response = await fetchLike("/api/channel", {
      credentials: "same-origin",
    });
    if (!response.ok) return "production";
    const body = (await response.json()) as { channel?: unknown };
    return body.channel === "preview" ? "preview" : "production";
  } catch {
    return "production";
  }
}
