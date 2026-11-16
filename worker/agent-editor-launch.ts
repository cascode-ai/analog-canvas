import { agentSiteSessionId } from "@icm/agent-adapter";
import {
  BROWSER_LAUNCH_GRANT_PREFIX,
  BROWSER_LAUNCH_PATH,
} from "@icm/agent-adapter/browser-launch";
import { AgentSessionScopeSchema } from "@icm/agent-adapter/session-scope";
import { AGENT_SESSION_RECOVERY_STORAGE_KEY } from "../apps/editor/src/agent/session-recovery-presence";
import type { AgentSessionRouterEnv } from "./agent-session-runtime";
import {
  deviceLabel,
  deviceTrustDirectory,
  existingDeviceTrustDirectory,
  verifyLaunchDevice,
} from "./agent-device-trust";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** JSON for an inline script: no markup or line separators survive. */
function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

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
  const deviceKey = form.get("deviceKey") ?? "";
  const deviceProof = form.get("deviceProof") ?? "";
  const deviceName = deviceLabel(form.get("deviceName"));
  const hasDevice =
    /^[A-Za-z0-9_-]{43}$/u.test(deviceKey) &&
    /^[A-Za-z0-9_-]{86}$/u.test(deviceProof);
  if (
    mode === "same-origin" &&
    requestOrigin === origin &&
    request.headers.get("sec-fetch-site") === "same-origin" &&
    contentType?.startsWith("application/x-www-form-urlencoded")
  ) {
    const session = env.AGENT_SESSION.getByName(sessionId);
    const approval = form.get("approval") ?? "once";
    if (approval === "once")
      return session.fetch(
        "https://agent-session.internal/approve-editor-launch",
        {
          method: "POST",
          body: grant,
        },
      );
    if (!hasDevice || (approval !== "auto" && approval !== "trust"))
      return reject(400);
    const [directory, deviceId] = await Promise.all([
      deviceTrustDirectory(request, env),
      verifyLaunchDevice(origin, sessionId, grant, deviceKey, deviceProof),
    ]);
    if (!directory || !deviceId) return reject(403);
    let owningDirectory = directory;
    if (approval === "auto") {
      try {
        const existing = await existingDeviceTrustDirectory(
          directory,
          deviceId,
          env.AGENT_SESSION,
        );
        if (!existing) return reject(403);
        owningDirectory = existing;
      } catch {
        return reject(503);
      }
    }
    return session.fetch(
      "https://agent-session.internal/approve-editor-launch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant,
          device: {
            directory: owningDirectory,
            deviceId,
            action: approval,
            ...(deviceName ? { label: deviceName } : {}),
          },
        }),
      },
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
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  );
  return new Response(
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Agent to Analog Canvas</title>
<style nonce="${nonce}">
  :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #37352f; background: #f7f6f3; }
  * { box-sizing: border-box; }
  body { margin: 0; }
  header { display: flex; align-items: center; gap: 12px; padding: 16px 24px; background: #fff; border-bottom: 1px solid #e9e9e7; font-size: 14px; font-weight: 600; }
  header svg { width: 24px; height: 24px; }
  main { max-width: 560px; margin: 48px auto; padding: 28px; background: #fff; border: 1px solid #e9e9e7; border-radius: 12px; }
  h1 { margin: 0 0 12px; font-size: 24px; font-weight: 600; letter-spacing: -.4px; }
  h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }
  p { font-size: 14px; line-height: 1.6; margin: 8px 0 16px; overflow-wrap: anywhere; }
  #account { color: #787774; }
  section { border-top: 1px solid #e9e9e7; padding-top: 20px; margin-top: 20px; }
  button { min-height: 40px; padding: 8px 16px; font: inherit; font-size: 14px; font-weight: 500; border: 1px solid #dfdfde; border-radius: 6px; background: #fff; color: #37352f; cursor: pointer; }
  button:hover { background: #f1f1ef; }
  #allow { background: #2383e2; border-color: #2383e2; color: #fff; }
  #allow:hover { background: #1b6fc4; }
  button:focus-visible { outline: 3px solid #2383e2; outline-offset: 3px; }
  button:disabled { opacity: .55; cursor: wait; }
  #status { margin: 20px 0 0; }
  #status:empty { display: none; }
  @media (max-width: 600px) { main { margin: 24px 16px; padding: 24px; } button { width: 100%; } }
</style>
<header><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 4v16M12 7v10M12 8h6V3M12 16h6v5M3 12h5" /></svg>Analog Canvas</header>
<main>
  <h1>Connect your Agent</h1>
  <p id="account" role="status">Checking your Canvas account…</p>
  <section aria-labelledby="once-heading">
  <h2 id="once-heading">Allow this task</h2>
  <p>Allow the local Agent to read and edit a new Canvas tab through this site's Agent relay.
  The connection also grants available file, simulation, and publishing tools.
  You can pause or disconnect from the editor's Agent panel.</p>
  <button type="button" id="allow">Allow Agent access</button>
  <p id="status" role="status"></p>
  </section>
  ${
    hasDevice
      ? `<section aria-labelledby="trust-heading"><h2 id="trust-heading">Future review tasks</h2>
  <p>Trust <strong id="device">this device</strong> to open future review tabs for this account without asking.
  Trusted tasks can read and edit local review copies. Cloud and Gallery actions use Canvas controls.
  Stop trusting it from the editor's Agent panel or Account settings.</p>
  <button type="button" id="trust">Trust this device</button></section>`
      : ""
  }
</main>
<script nonce="${nonce}">
  const button = document.getElementById("allow");
  const trust = document.getElementById("trust");
  const status = document.getElementById("status");
  const account = document.getElementById("account");
  const newLaunch = "Ask the Agent to open a new Canvas task.";
  const sessionScopes = new Set(${scriptJson(AgentSessionScopeSchema.options)});
  const launch = ${scriptJson({
    fields: {
      sessionId,
      grant,
      ...(hasDevice
        ? { deviceKey, deviceProof, ...(deviceName ? { deviceName } : {}) }
        : {}),
    },
    deviceName: deviceName ?? null,
  })};
  if (launch.deviceName && trust)
    document.getElementById("device").textContent = launch.deviceName;
  async function requestJson(path, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(path, { ...options, signal: controller.signal });
      return { response, body: response.ok ? await response.json() : null };
    } catch {
      return { response, timedOut: controller.signal.aborted };
    } finally {
      clearTimeout(timer);
    }
  }
  requestJson("/api/auth/me", { cache: "no-store" })
    .then(({ response, body }) => {
      const name = body && body.user && body.user.displayName;
      if (typeof name === "string") account.textContent = "Signed in to Canvas as " + name + ".";
      else if ((response?.ok && body !== undefined) || response?.status === 401 || response?.status === 403)
        account.textContent = "Not signed in to Canvas.";
      else account.textContent = "Canvas account status is unavailable.";
    })
    .catch(() => { account.textContent = "Canvas account status is unavailable."; });
  function storageProblem() {
    try {
      return sessionStorage.length === 0 ? null : "This tab already contains Canvas session data.";
    } catch {
      return "Canvas could not access browser storage in this tab. Check your browser settings.";
    }
  }
  async function approve(approval) {
    const problem = storageProblem();
    if (problem) {
      status.textContent = problem + " " + newLaunch;
      return false;
    }
    const automatic = approval === "auto";
    status.textContent = automatic ? "Checking device trust…" : "Requesting Agent access…";
    const { response, body, timedOut } = await requestJson(${scriptJson(BROWSER_LAUNCH_PATH)}, {
      method: "POST",
      mode: "same-origin",
      referrerPolicy: "same-origin",
      body: new URLSearchParams({ ...launch.fields, approval }),
    });
    if (!response?.ok) {
      if (automatic && response?.status === 403) status.textContent = "";
      else if (approval === "trust" && response?.status === 403)
        status.textContent = "Canvas could not trust this device. You can allow access for this task.";
      else if (response?.status === 409)
        status.textContent = "Approval was unavailable (HTTP 409). It may have expired, been used, or still be in progress. " + newLaunch;
      else if (response)
        status.textContent = "Canvas could not approve this request (HTTP " + response.status + "). " + newLaunch;
      else
        status.textContent = (timedOut ? "The approval request timed out. " : "The approval request failed. ") + newLaunch;
      return false;
    }
    try {
      // The editor reads a v1 AgentSessionRecoveryRecord in the same tab.
      if (body?.version !== 1 || body.sessionId !== launch.fields.sessionId ||
          ![body.editorSecret, body.projectId, body.projectSessionId].every((value) => typeof value === "string" && value.length > 0) ||
          !Array.isArray(body.scopes) || !body.scopes.every((scope) => sessionScopes.has(scope)) ||
          !Number.isFinite(body.expiresAt))
        throw new Error("Invalid approval response");
      if (sessionStorage.length !== 0) throw new Error("Tab storage changed during approval");
      sessionStorage.setItem(${scriptJson(AGENT_SESSION_RECOVERY_STORAGE_KEY)}, JSON.stringify(body));
      status.textContent = "Agent access approved. Opening Canvas…";
      location.replace("/editor");
      return true;
    } catch {
      status.textContent = "This tab could not open the editor after the approval response. " + newLaunch;
      return false;
    }
  }
  async function attempt(approval) {
    button.disabled = true;
    if (trust) trust.disabled = true;
    let opening = false;
    try {
      opening = await approve(approval);
    } catch {
      status.textContent = "The browser could not complete approval. " + newLaunch;
    } finally {
      if (!opening) {
        button.disabled = false;
        if (trust) trust.disabled = false;
      }
    }
  }
  button.addEventListener("click", (event) => {
    if (event.isTrusted && !button.disabled) void attempt("once");
  });
  if (trust) {
    trust.addEventListener("click", (event) => {
      if (event.isTrusted && !trust.disabled) void attempt("trust");
    });
    void attempt("auto");
  }
</script>
</html>`,
    { headers },
  );
}
