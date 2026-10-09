import { useEffect, useState } from "react";

/** Where the privacy notice reads and sets "Stop counting me". */
export const ANALYTICS_OPT_OUT_PATH = "/api/track/opt-out";
/** Where a counted page load reports how long it took (#1581). */
export const ANALYTICS_PAGE_LOAD_PATH = "/api/track/load";

let pageLoadReported = false;

/**
 * Once per page load, report how long it took (#1581): the document's first
 * byte, and when the page was shown (its largest paint, or the load event
 * where a browser has none). A tab that opened in the background is left
 * out, since its timings say nothing about the network.
 */
function reportPageLoad(): void {
  if (pageLoadReported) return;
  pageLoadReported = true;
  if (document.visibilityState === "hidden") return;
  let largestPaint = 0;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) largestPaint = entry.startTime;
    });
    observer.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    observer = null;
  }
  const send = () => {
    observer?.disconnect();
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (!navigation) return;
    const shown = largestPaint || navigation.loadEventEnd;
    if (!(navigation.responseStart > 0) || !(shown > 0)) return;
    void fetch(ANALYTICS_PAGE_LOAD_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      keepalive: true,
      cache: "no-store",
      body: JSON.stringify({
        t: Math.round(navigation.responseStart),
        l: Math.round(shown),
      }),
    }).catch(() => {
      // The report is fire-and-forget.
    });
  };
  // The largest paint settles shortly after load.
  const afterLoad = () => window.setTimeout(send, 3000);
  if (document.readyState === "complete") afterLoad();
  else window.addEventListener("load", afterLoad, { once: true });
}

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

    // Do Not Track and Global Privacy Control both mean: do not count me.
    if (
      navigator.doNotTrack === "1" ||
      (navigator as Navigator & { globalPrivacyControl?: boolean })
        .globalPrivacyControl === true
    )
      return;
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
    reportPageLoad();
  }, [path]);

  return stats;
}
