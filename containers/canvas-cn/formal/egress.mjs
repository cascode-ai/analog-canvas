import { isRegionalAuthorityBrowserRoute } from "../../../worker/regional-auth-contract.ts";

export default {
  async fetch(request, env) {
    try {
      const peer = new URL(env.PEER_ORIGIN);
      const identity = new URL(env.IDENTITY_URL);
      const destination = new URL(request.url);
      const browserAuth =
        destination.origin === identity.origin &&
        isRegionalAuthorityBrowserRoute(request.method, destination.pathname);
      const allowed = new Set([
        `GET ${new URL("/api/project-sync/status", peer)}`,
        `POST ${new URL("/api/project-sync/events", peer)}`,
        `POST ${new URL("/api/project-sync/quota", peer)}`,
        `POST ${identity}`,
        `POST ${new URL("/api/auth/regional/exchange", identity)}`,
        `POST ${new URL("/api/auth/regional/renew", identity)}`,
      ]);
      if (
        peer.protocol !== "https:" ||
        identity.protocol !== "https:" ||
        (!browserAuth && !allowed.has(`${request.method} ${request.url}`))
      )
        return new Response("Regional destination refused", { status: 403 });
      const response = await fetch(
        new Request(request, {
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
