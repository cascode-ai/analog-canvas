import { isRegionalAuthorityBrowserRoute } from "../../../worker/regional-auth-contract.ts";

const operators = new Map([
  ["https://ngspice.canvas-operator.invalid", "NGSPICE_OPERATOR"],
  ["https://vacask.canvas-operator.invalid", "VACASK_OPERATOR"],
]);

export default {
  async fetch(request, env) {
    try {
      const destination = new URL(request.url);
      const operator = operators.get(destination.origin);
      if (operator) {
        const allowed =
          !destination.search &&
          ((request.method === "GET" && destination.pathname === "/health") ||
            (request.method === "POST" &&
              ["/run", "/cancel"].includes(destination.pathname)));
        if (!allowed)
          return new Response("Operator destination refused", { status: 403 });
        if (!env[operator])
          return new Response("Operator unavailable", { status: 503 });
        // This binding reaches a loopback SSH forward, never the public internet.
        // A failed/uncertain run is returned once; there is no fallback execution.
        const response = await env[operator].fetch(
          new Request(request, {
            redirect: "manual",
            signal: AbortSignal.timeout(
              destination.pathname === "/run" ? 150000 : 10000,
            ),
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
      const allowed = new Set([
        `GET ${new URL("/api/project-sync/status", peer)}`,
        `POST ${new URL("/api/project-sync/events", peer)}`,
        `POST ${new URL("/api/project-sync/quota", peer)}`,
        `POST ${new URL("/api/project-sync/pull", peer)}`,
        `POST ${identity}`,
        `POST ${new URL("/api/auth/regional/exchange", identity)}`,
        `POST ${new URL("/api/auth/regional/renew", identity)}`,
        `POST ${new URL("/api/auth/regional/account", identity)}`,
        `POST ${new URL("/api/auth/regional/owner-token", identity)}`,
        `POST ${new URL("/api/auth/regional/security", identity)}`,
        `POST ${new URL("/api/auth/regional/providers", identity)}`,
      ]);
      if (
        peer.protocol !== "https:" ||
        identity.protocol !== "https:" ||
        (!browserAuth && !allowed.has(`${request.method} ${request.url}`))
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
