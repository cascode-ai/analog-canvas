import {
  AnalyticsDO,
  queryAnalyticsSummary,
  queryVisitStats,
  readSessionSource,
  readVisitorId,
  recordPageView,
  sessionCookie,
  visitorCookie,
  type DurableObjectNamespaceLike,
} from "./analytics";
import {
  routeAgentSessionRequest,
  type AgentSessionNamespaceLike,
} from "./agent-session";
import { routeGalleryRequest, type GalleryNamespaceLike } from "./gallery";
import { routeSimulationRequest, type SimulationEnv } from "./simulation";
import { stagingAccessGate, type StagingEnv } from "./staging-gate";
import { routeAuthRequest, type AuthNamespaceLike } from "./auth";

export { AnalyticsDO } from "./analytics";
export { AgentSessionDO } from "./agent-session";
export { GalleryDO } from "./gallery";
export { AuthDO } from "./auth";

type Env = SimulationEnv &
  StagingEnv & {
    ANALYTICS: DurableObjectNamespaceLike;
    ASSETS: { fetch(request: Request): Promise<Response> };
    ANALYTICS_KEY: string | undefined;
    AGENT_SESSION: AgentSessionNamespaceLike;
    AGENT_ALLOWED_ORIGIN?: string;
    GALLERY: GalleryNamespaceLike;
    AUTH: AuthNamespaceLike;
    GH_OAUTH_CLIENT_ID?: string;
    GH_OAUTH_CLIENT_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    AUTH_EMAIL_FROM?: string;
    ADMIN_EMAILS?: string;
    ADMIN_EMAILS_EXTRA?: string;
  };

type RequestCf = {
  country?: string;
  latitude?: string;
  longitude?: string;
};

const BOT_UA =
  /bot|crawler|spider|slurp|headless|phantom|pingdom|uptime|lighthouse|pagespeed|curl|wget|python|axios|fetch\//i;

const CAMPAIGN_SOURCES: Record<string, string> = {
  google: "search:google",
  bing: "search:bing",
  baidu: "search:baidu",
  duckduckgo: "search:duckduckgo",
  wechat: "social:wechat",
  weixin: "social:wechat",
  linkedin: "social:linkedin",
  twitter: "social:x",
  x: "social:x",
  github: "social:github",
  zhihu: "social:zhihu",
  bilibili: "social:bilibili",
  xiaohongshu: "social:xiaohongshu",
  rednote: "social:xiaohongshu",
  email: "campaign:email",
  newsletter: "campaign:email",
  qr: "campaign:qr",
  qrcode: "campaign:qr",
  rss: "campaign:rss",
};

const REFERRER_CATEGORIES: readonly (readonly [string, readonly string[]])[] = [
  ["search:bing", ["bing.com"]],
  ["search:baidu", ["baidu.com"]],
  ["search:duckduckgo", ["duckduckgo.com"]],
  ["search:yahoo", ["yahoo.com"]],
  ["search:yandex", ["yandex.com", "yandex.ru"]],
  ["search:ecosia", ["ecosia.org"]],
  ["search:naver", ["naver.com"]],
  ["search:sogou", ["sogou.com"]],
  ["search:360", ["so.com"]],
  ["social:wechat", ["weixin.qq.com", "servicewechat.com", "wechat.com"]],
  ["social:linkedin", ["linkedin.com", "lnkd.in"]],
  ["social:x", ["x.com", "twitter.com", "t.co"]],
  ["social:facebook", ["facebook.com", "fb.com"]],
  ["social:instagram", ["instagram.com"]],
  ["social:reddit", ["reddit.com", "redd.it"]],
  ["social:github", ["github.com"]],
  ["social:zhihu", ["zhihu.com"]],
  ["social:bilibili", ["bilibili.com"]],
  ["social:xiaohongshu", ["xiaohongshu.com", "xhslink.com"]],
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Before any route, including the APIs: a staging deployment that cannot
    // identify its caller serves nobody. Production leaves ICM_ENVIRONMENT
    // unset, so this returns null there and costs one comparison.
    const stagingRefusal = stagingAccessGate(request, env);
    if (stagingRefusal) return stagingRefusal;

    const url = new URL(request.url);

    const agentResponse = await routeAgentSessionRequest(request, env);
    if (agentResponse) return agentResponse;

    const authResponse = await routeAuthRequest(request, env);
    if (authResponse) return authResponse;

    const galleryResponse = await routeGalleryRequest(request, env);
    if (galleryResponse) return galleryResponse;

    const simulationResponse = await routeSimulationRequest(request, env);
    if (simulationResponse) return simulationResponse;

    if (url.pathname === "/api/track" && request.method === "POST") {
      return trackPageView(request, env);
    }
    if (url.pathname === "/api/stats" && request.method === "GET") {
      return stats(env);
    }
    if (url.pathname === "/api/analytics" && request.method === "GET") {
      return analytics(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return serveAsset(request, env);
  },
};

/**
 * Serve a static asset, and let a missing one be missing.
 *
 * The boundary, which is the thing an earlier attempt did not draw: a path
 * under `/assets/` names a CONTENT-HASHED FILE. The name is a promise about
 * the bytes behind it, so if those bytes are gone the honest answer is 404.
 * Every other path is a CLIENT ROUTE — `/editor`, `/g/<id>` — which never had
 * a file behind it, and whose miss is answered with the shell so the app can
 * boot and route it.
 *
 * The asset layer cannot tell them apart: `not_found_handling:
 * single-page-application` answers both with index.html at status 200. That
 * is right for a route and wrong for an asset, and it is the bug a browser
 * reports as "Failed to fetch dynamically imported module" after a redeploy
 * retires a chunk name. So `/assets/*` runs the Worker first, and the shell
 * arriving where a script was requested is recognised and turned into a 404.
 *
 * Detection is by content type rather than by comparing bytes: a real file
 * under /assets/ is script, style, font or image, and never text/html.
 */
async function serveAsset(request: Request, env: Env): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/assets/")) return response;
  const isShellFallback = (response.headers.get("content-type") ?? "")
    .toLowerCase()
    .includes("text/html");
  if (!isShellFallback) return response;
  return new Response(`Not found: ${path}`, {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // A retired name must not be cached as anything, least of all as a
      // 404 that outlives the next deploy that might reuse it.
      "cache-control": "no-store",
    },
  });
}

async function trackPageView(request: Request, env: Env): Promise<Response> {
  const noContent = () => new Response(null, { status: 204 });
  if (!isSameOriginTrackRequest(request)) return noContent();
  if (request.headers.get("DNT") === "1") return noContent();
  const userAgent = request.headers.get("User-Agent") ?? "";
  if (!userAgent || BOT_UA.test(userAgent)) return noContent();

  const payload = (await request.json().catch(() => null)) as {
    p?: unknown;
    r?: unknown;
    s?: unknown;
  } | null;
  const path = normalizeTrackedPath(payload?.p);
  if (!path) return noContent();

  const cookieHeader = request.headers.get("Cookie");
  const existing = readVisitorId(cookieHeader);
  const visitorId = existing ?? crypto.randomUUID();
  const previousSource = normalizedSessionSource(
    readSessionSource(cookieHeader),
  );
  const source =
    previousSource ??
    normalizeAcquisitionSource(payload?.r, payload?.s, urlOf(request));
  const cf = (request as Request & { cf?: RequestCf }).cf ?? {};
  const rawCountry =
    typeof cf.country === "string" ? cf.country.toUpperCase() : "";
  const country = /^[A-Z0-9]{2}$/.test(rawCountry) ? rawCountry : "XX";
  const secure = request.url.startsWith("https://");
  const headers = new Headers({ "cache-control": "no-store" });
  if (!existing) headers.append("Set-Cookie", visitorCookie(visitorId, secure));
  headers.append("Set-Cookie", sessionCookie(source, secure));

  try {
    const result = await recordPageView(env.ANALYTICS, visitorId, {
      path,
      country,
      lat: cfNumber(cf.latitude),
      lng: cfNumber(cf.longitude),
      source,
    });
    return Response.json(result, { headers });
  } catch {
    return new Response(null, { status: 204, headers });
  }
}

async function stats(env: Env): Promise<Response> {
  try {
    const result = await queryVisitStats(env.ANALYTICS);
    return Response.json(
      { ...result, scope: "all" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Analytics unavailable" }, { status: 502 });
  }
}

async function analytics(request: Request, env: Env): Promise<Response> {
  if (
    env.ANALYTICS_KEY &&
    new URL(request.url).searchParams.get("key") !== env.ANALYTICS_KEY
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    return Response.json(await queryAnalyticsSummary(env.ANALYTICS), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Analytics unavailable" }, { status: 502 });
  }
}

export function normalizeTrackedPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let path = raw.split("?")[0]?.split("#")[0] ?? "";
  if (!path.startsWith("/")) return null;
  if (path.length > 120) path = path.slice(0, 120);
  if (path.startsWith("/api/") || /^\/analytics\/?$/.test(path)) return null;
  return path;
}

export function normalizeAcquisitionSource(
  rawReferrer: unknown,
  rawCampaignSource: unknown,
  siteUrl: URL,
): string {
  if (typeof rawCampaignSource === "string" && rawCampaignSource.trim()) {
    const key = rawCampaignSource.trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,40}$/.test(key)) return "campaign:other";
    return CAMPAIGN_SOURCES[key] ?? "campaign:other";
  }
  if (typeof rawReferrer !== "string" || !rawReferrer.trim())
    return "direct-or-unknown";
  try {
    const referrer = new URL(rawReferrer);
    if (!/^https?:$/.test(referrer.protocol)) return "direct-or-unknown";
    const hostname = canonicalHostname(referrer.hostname);
    if (!hostname || hostname === canonicalHostname(siteUrl.hostname))
      return "direct-or-unknown";
    if (/^google\.[a-z.]+$/.test(hostname)) return "search:google";
    for (const [source, domains] of REFERRER_CATEGORIES) {
      if (
        domains.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        )
      ) {
        return source;
      }
    }
    return /^[a-z0-9.-]{1,100}$/.test(hostname)
      ? `ref:${hostname}`
      : "ref:other";
  } catch {
    return "direct-or-unknown";
  }
}

function normalizedSessionSource(value: string | null): string | null {
  if (!value) return null;
  if (
    value === "direct-or-unknown" ||
    value === "campaign:other" ||
    value === "ref:other" ||
    Object.values(CAMPAIGN_SOURCES).includes(value) ||
    REFERRER_CATEGORIES.some(([source]) => source === value) ||
    /^ref:[a-z0-9.-]{1,100}$/.test(value)
  ) {
    return value;
  }
  return null;
}

function isSameOriginTrackRequest(request: Request): boolean {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (origin && origin !== expectedOrigin) return false;
  if (fetchSite && fetchSite !== "same-origin") return false;
  if (origin || fetchSite === "same-origin") return true;
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
}

function canonicalHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

function cfNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function urlOf(request: Request): URL {
  return new URL(request.url);
}
