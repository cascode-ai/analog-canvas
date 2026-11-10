import { agentSiteSessionId } from "@icm/agent-adapter";
import {
  BROWSER_LAUNCH_GRANT_PREFIX,
  BROWSER_LAUNCH_PATH,
} from "@icm/agent-adapter/browser-launch";
import { AGENT_SESSION_RECOVERY_STORAGE_KEY } from "../apps/editor/src/agent/session-recovery-presence";
import type { AgentSessionRouterEnv } from "./agent-session-runtime";
import {
  deviceLabel,
  deviceTrustDirectory,
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
    return session.fetch(
      "https://agent-session.internal/approve-editor-launch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant,
          device: {
            directory,
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
    `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  );
  return new Response(
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Connect Agent to Analog Canvas</title>
<main>
  <h1>Connect Agent to Analog Canvas</h1>
  <p id="account"></p>
  <p>Allow the local Agent to read and edit a new Canvas tab through this site's Agent relay.
  The connection also grants available file, simulation, and publishing tools.
  You can pause or disconnect from the editor's Agent panel.</p>
  <button type="button" id="allow">Allow Agent access</button>
  ${
    hasDevice
      ? `<p>Trust <strong id="device">this device</strong> to open future review tabs for this account without asking.
  Trusted tasks can read and edit local review copies. Cloud and Gallery actions use Canvas controls.
  Stop trusting it from the editor's Agent panel or Account settings.</p>
  <button type="button" id="trust">Trust this device</button>`
      : ""
  }
  <p id="status" role="status"></p>
</main>
<script nonce="${nonce}">
  const button = document.getElementById("allow");
  const trust = document.getElementById("trust");
  const status = document.getElementById("status");
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
  fetch("/api/auth/me", { cache: "no-store", signal: AbortSignal.timeout(8000) })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      const name = body && body.user && body.user.displayName;
      document.getElementById("account").textContent =
        typeof name === "string"
          ? "Signed in to Canvas as " + name + "."
          : "Not signed in to Canvas.";
    })
    .catch(() => {});
  async function approve(approval) {
    button.disabled = true;
    if (trust) trust.disabled = true;
    try {
      if (sessionStorage.length !== 0) throw new Error();
      const fields = launch.fields;
      const response = await fetch(${scriptJson(BROWSER_LAUNCH_PATH)}, {
        method: "POST",
        mode: "same-origin",
        referrerPolicy: "same-origin",
        body: new URLSearchParams({ ...fields, approval }),
        signal: AbortSignal.timeout(8000),
      });
      if (approval === "auto" && !response.ok) return;
      if (approval === "trust" && response.status === 403) {
        status.textContent = "Sign in to Canvas to trust this device, or allow access for this task.";
        return;
      }
      if (!response.ok || sessionStorage.length !== 0) throw new Error();
      sessionStorage.setItem(${scriptJson(AGENT_SESSION_RECOVERY_STORAGE_KEY)},
        JSON.stringify(await response.json()));
      location.replace("/editor");
      return true;
    } catch {
      if (approval !== "auto") status.textContent =
        "This launch needs a fresh browser tab and may have expired. Open Canvas again from the Agent.";
    }
  }
  async function attempt(approval) {
    if (await approve(approval)) return;
    button.disabled = false;
    if (trust) trust.disabled = false;
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
