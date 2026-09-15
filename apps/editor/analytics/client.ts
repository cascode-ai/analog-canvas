import { useEffect, useState } from "react";

export type VisitStats = {
  pv: number;
  uv: number;
  scope: "all";
};

/** Read the public counters, record this navigation, and never block the UI. */
export function useVisitStats(path: string): VisitStats | null {
  const [stats, setStats] = useState<VisitStats | null>(null);

  useEffect(() => {
    const analyticsHost =
      window.location.hostname === "analog-canvas.tokenzhang.com" ||
      window.location.hostname.endsWith(".workers.dev");
    if (!analyticsHost || /^\/analytics\/?$/.test(path)) return;

    // The statusbar readout is public data, not tracking. Load it for every
    // visitor, including browsers that ask not to be tracked.
    void fetch("/api/stats", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? ((await response.json()) as VisitStats) : null,
      )
      .then((value) => {
        if (value) setStats(value);
      })
      .catch(() => {
        // Analytics must never interfere with application startup.
      });

    if (navigator.doNotTrack === "1") return;
    let referrerOrigin = "";
    try {
      const referrer = new URL(document.referrer);
      if (/^https?:$/.test(referrer.protocol)) referrerOrigin = referrer.origin;
    } catch {
      // Direct visit or opaque referrer.
    }
    const source =
      new URLSearchParams(window.location.search)
        .get("utm_source")
        ?.trim()
        .toLowerCase()
        .slice(0, 40) ?? "";

    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      cache: "no-store",
      body: JSON.stringify({ p: path, r: referrerOrigin, s: source }),
    }).catch(() => {
      // The beacon is fire-and-forget.
    });
  }, [path]);

  return stats;
}
