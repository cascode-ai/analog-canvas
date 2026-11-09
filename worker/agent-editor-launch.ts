import { agentSiteSessionId } from "@icm/agent-adapter";
import {
  AGENT_SESSION_RECOVERY_STORAGE_KEY,
  BROWSER_LAUNCH_GRANT_PREFIX,
  BROWSER_LAUNCH_PATH,
} from "@icm/agent-adapter/browser-launch";
import type { AgentSessionRouterEnv } from "./agent-session-runtime";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** A loopback navigation shows the prompt; a same-origin approval uses the grant. */
export async function editorLaunchPage(
  request: Request,
  form: URLSearchParams,
  env: AgentSessionRouterEnv,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const reject = (status: number) =>
    new Response("This Canvas launch is invalid or has already been used.", {
      status,
      headers,
    });
  const origin = new URL(request.url).origin;
  const sessionId = form.get("sessionId") ?? "";
  const grant = form.get("grant") ?? "";
  const id = sessionId.slice(9);
  if (
    !UUID.test(id) ||
    sessionId !== agentSiteSessionId(origin, id) ||
    !grant.startsWith(BROWSER_LAUNCH_GRANT_PREFIX) ||
    !UUID.test(grant.slice(BROWSER_LAUNCH_GRANT_PREFIX.length))
  )
    return reject(400);

  const requestOrigin = request.headers.get("origin") ?? "";
  const mode = request.headers.get("sec-fetch-mode");
  const contentType = request.headers.get("content-type");
  if (
    mode === "same-origin" &&
    requestOrigin === origin &&
    request.headers.get("sec-fetch-site") === "same-origin" &&
    contentType?.startsWith("application/x-www-form-urlencoded")
  ) {
    return env.AGENT_SESSION.getByName(sessionId).fetch(
      "https://agent-session.internal/approve-editor-launch",
      { method: "POST", body: grant },
    );
  }
  if (
    !/^http:\/\/127\.0\.0\.1:\d{1,5}$/u.test(requestOrigin) ||
    mode !== "navigate" ||
    request.headers.get("sec-fetch-dest") !== "document" ||
    contentType !== "application/x-www-form-urlencoded"
  )
    return reject(403);

  const nonce = crypto.randomUUID();
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set(
    "content-security-policy",
    `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  );
  return new Response(
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Connect Agent to Analog Canvas</title>
<main>
  <h1>Connect Agent to Analog Canvas</h1>
  <p>Allow the local Agent to read and edit a new Canvas tab through this site's Agent relay.
  The connection also grants available file, simulation, and publishing tools.
  You can pause or disconnect from the editor's Agent panel.</p>
  <button type="button" id="allow">Allow Agent access</button>
  <p id="status" role="status"></p>
</main>
<script nonce="${nonce}">
  const button = document.getElementById("allow");
  button.addEventListener("click", async (event) => {
    if (!event.isTrusted || button.disabled) return;
    button.disabled = true;
    try {
      if (sessionStorage.length !== 0) throw new Error();
      const response = await fetch(${JSON.stringify(BROWSER_LAUNCH_PATH)}, {
        method: "POST",
        mode: "same-origin",
        referrerPolicy: "same-origin",
        body: new URLSearchParams(${JSON.stringify({ sessionId, grant })}),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok || sessionStorage.length !== 0) throw new Error();
      sessionStorage.setItem(${JSON.stringify(AGENT_SESSION_RECOVERY_STORAGE_KEY)},
        JSON.stringify(await response.json()));
      location.replace("/editor");
    } catch {
      document.getElementById("status").textContent =
        "This launch needs a fresh browser tab and may have expired. Open Canvas again from the Agent.";
    }
  });
</script>
</html>`,
    { headers },
  );
}
