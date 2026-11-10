import { isRegionalAuthorityBrowserRoute } from "../../../worker/regional-auth-contract.ts";

/** Operator routes generated from wrangler.jsonc upstreams (scripts/regional-runtime.mjs). */
const DEFAULT_OPERATORS = [
  {
    origin: "https://ngspice.canvas-operator.invalid",
    binding: "NGSPICE_OPERATOR",
    prefixes: [""],
  },
  {
    origin: "https://vacask.canvas-operator.invalid",
    binding: "VACASK_OPERATOR",
    prefixes: [""],
  },
];

function operatorFor(destination, env) {
  const routes = env.OPERATORS ? JSON.parse(env.OPERATORS) : DEFAULT_OPERATORS;
  const route = routes.find((r) => r.origin === destination.origin);
  if (!route) return null;
  // Longest prefix first, so /sg13g2/run is not read as an unknown root path.
  const prefix = [...route.prefixes]
    .sort((a, b) => b.length - a.length)
    .find((p) => p === "" || destination.pathname.startsWith(`${p}/`));
  return {
    binding: route.binding,
    path:
      prefix === undefined ? null : destination.pathname.slice(prefix.length),
  };
}

export default {
  async fetch(request, env) {
    try {
      const destination = new URL(request.url);
      const route = operatorFor(destination, env);
      if (route) {
        const operator = route.binding;
        const allowed =
          !destination.search &&
          ((request.method === "GET" && route.path === "/health") ||
            (request.method === "POST" &&
              ["/run", "/cancel"].includes(route.path)));
        if (!allowed)
          return new Response("Operator destination refused", { status: 403 });
        if (!env[operator])
          return new Response("Operator unavailable", { status: 503 });
        // This binding reaches a loopback SSH forward, never the public internet.
        // A failed/uncertain run is returned once; there is no fallback execution.
        const response = await env[operator].fetch(
          new Request(request, {
            redirect: "manual",
            signal: AbortSignal.timeout(route.path === "/run" ? 150000 : 10000),
          }),
        );
        return response.status >= 300 && response.status < 400
          ? new Response("Operator redirect refused", { status: 502 })
          : response;
      }
      const peer = new URL(env.PEER_ORIGIN);
      const identity = new URL(env.IDENTITY_URL);
      const browserAuth =
        destination.origin === identity.origin &&
        isRegionalAuthorityBrowserRoute(request.method, destination.pathname);
      const resourceCatchup =
        destination.origin === peer.origin &&
        request.method === "GET" &&
        destination.pathname === "/api/resource-sync/gallery/changes" &&
        /^\?after=\d+$/.test(destination.search);
      const allowed = new Set([
        `POST ${new URL("/api/analytics-sync/seed", peer)}`,
        `POST ${new URL("/api/analytics-sync/receive", peer)}`,
        `GET ${new URL("/api/analytics-sync/summary", peer)}`,
        `GET ${new URL("/api/project-sync/status", peer)}`,
        `POST ${new URL("/api/project-sync/events", peer)}`,
        `POST ${new URL("/api/project-sync/quota", peer)}`,
        `POST ${new URL("/api/project-sync/pull", peer)}`,
        `POST ${identity}`,
        `POST ${new URL("/api/auth/regional/exchange", identity)}`,
        `POST ${new URL("/api/auth/regional/renew", identity)}`,
        `POST ${new URL("/api/auth/regional/deletions", identity)}`,
        `POST ${new URL("/api/auth/regional/account", identity)}`,
        `POST ${new URL("/api/auth/regional/owner-token", identity)}`,
        `POST ${new URL("/api/auth/regional/security", identity)}`,
        `POST ${new URL("/api/auth/regional/providers", identity)}`,
        `POST ${new URL("/api/auth/regional/action-authorize", identity)}`,
        `POST ${new URL("/api/auth/regional/action-verify", identity)}`,
        `POST ${new URL("/api/resource-actions/lifecycle", peer)}`,
      ]);
      if (
        peer.protocol !== "https:" ||
        identity.protocol !== "https:" ||
        (!browserAuth &&
          !resourceCatchup &&
          !allowed.has(`${request.method} ${request.url}`))
      )
        return new Response("Regional destination refused", { status: 403 });
      const headers = new Headers(request.headers);
      if (!headers.has("user-agent"))
        headers.set(
          "user-agent",
          "Analog-Canvas-Regional/1 (+https://analog-canvas.tokenzhang.com)",
        );
      const response = await fetch(
        new Request(request, {
          headers,
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        }),
      );
      return !browserAuth && response.status >= 300 && response.status < 400
        ? new Response("Regional redirect refused", { status: 502 })
        : response;
    } catch {
      return new Response("Regional service unavailable", { status: 502 });
    }
  },
};
