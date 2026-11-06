const destinations = new Set([
  "POST https://github.com/login/oauth/access_token",
  "GET https://api.github.com/user",
  "GET https://api.github.com/user/emails",
  "POST https://api.resend.com/emails",
]);

export default {
  async fetch(request) {
    if (!destinations.has(`${request.method} ${request.url}`)) {
      return new Response("Provider request denied", { status: 403 });
    }
    try {
      // Redirects must never carry login credentials to another destination.
      const response = await fetch(
        new Request(request, {
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        }),
      );
      if (response.status >= 300 && response.status < 400) {
        return new Response("Provider redirect refused", { status: 502 });
      }
      return response;
    } catch {
      return new Response("Provider unavailable", { status: 502 });
    }
  },
};
