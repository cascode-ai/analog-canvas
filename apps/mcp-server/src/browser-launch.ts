import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { BROWSER_LAUNCH_PATH } from "@icm/agent-adapter/browser-launch";

export type BrowserOpener = (url: string) => Promise<void>;

export const openSystemBrowser: BrowserOpener = (url) =>
  new Promise<void>((resolve, reject) => {
    if (process.platform === "win32") {
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Start-Process -FilePath $env:ICM_BROWSER_LAUNCH_URL -WindowStyle Normal -ErrorAction Stop",
        ],
        {
          env: { ...process.env, ICM_BROWSER_LAUNCH_URL: url },
          timeout: 8_000,
          windowsHide: true,
        },
        (error) => (error ? reject(error) : resolve()),
      );
      return;
    }
    const command = process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

/** Deliver the editor proof in a POST body from a fresh system-browser tab. */
export async function handOffToBrowser(
  origin: string,
  session: { sessionId: string; launchGrant: string },
  openBrowser: BrowserOpener,
): Promise<void> {
  const path = `/${randomUUID()}`;
  const action = new URL(BROWSER_LAUNCH_PATH, origin).href;
  const nonce = randomUUID();
  let used = false;
  const server = createServer((request, response) => {
    const local = server.address();
    if (
      used ||
      request.method !== "GET" ||
      request.url !== path ||
      !local ||
      typeof local === "string" ||
      request.headers.host !== `127.0.0.1:${local.port}` ||
      request.headers["sec-fetch-site"] !== "none" ||
      request.headers["sec-fetch-mode"] !== "navigate" ||
      request.headers["sec-fetch-dest"] !== "document"
    ) {
      response.writeHead(404, { "cache-control": "no-store" }).end();
      return;
    }
    used = true;
    response.writeHead(200, {
      "cache-control": "no-store",
      "referrer-policy": "strict-origin",
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; form-action ${origin}; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
      "x-content-type-options": "nosniff",
      connection: "close",
    });
    response.end(`<!doctype html>
<meta charset="utf-8">
<title>Opening Analog Canvas</title>
<form action="${action}" method="post">
  <input type="hidden" name="sessionId" value="${session.sessionId}">
  <input type="hidden" name="grant" value="${session.launchGrant}">
  <noscript><button>Continue to Analog Canvas</button></noscript>
</form>
<script nonce="${nonce}">document.forms[0].submit()</script>`);
    server.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  server.unref();
  const deadline = setTimeout(() => server.close(), 30_000);
  deadline.unref();
  server.once("close", () => clearTimeout(deadline));
  const address = server.address();
  try {
    if (!address || typeof address === "string") throw new Error();
    await openBrowser(`http://127.0.0.1:${address.port}${path}`);
  } catch {
    server.close();
    throw new Error("The system browser could not be started.");
  }
}
