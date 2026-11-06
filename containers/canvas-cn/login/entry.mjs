import page from "./page.html";
export { AuthDO } from "./worker/index.js";

const origin = "http://localhost:18081";
const routes = new Set([
  "GET /api/auth/providers",
  "GET /api/auth/me",
  "GET /api/auth/github/start",
  "GET /api/auth/github/callback",
  "POST /api/auth/email/start",
  "POST /api/auth/email/verify",
  "POST /api/auth/logout",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== origin)
      return new Response("Invalid host", { status: 421 });
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (!routes.has(`${request.method} ${url.pathname}`)) {
      return Response.json({ error: "login-probe-only" }, { status: 404 });
    }
    if (request.method === "POST" && request.headers.get("origin") !== origin) {
      return new Response("Invalid origin", { status: 403 });
    }
    // A login probe always returns to its own result page, never to Arena.
    if (url.pathname.endsWith("/start")) url.searchParams.delete("return");
    const response = await env.AUTH.getByName("auth").fetch(
      new Request(url, request),
    );
    const result = new Response(response.body, response);
    result.headers.set("cache-control", "no-store");
    result.headers.set("referrer-policy", "no-referrer");
    if (url.pathname.endsWith("/callback")) {
      const location = result.headers.get("location");
      if (location && new URL(location, origin).origin !== origin)
        result.headers.set("location", "/");
    }
    return result;
  },
};
