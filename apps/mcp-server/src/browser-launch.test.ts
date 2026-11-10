import { request } from "node:http";
import { expect, it } from "vitest";
import { handOffToBrowser } from "./browser-launch.js";

/** The page a system browser receives when it navigates to the hand-off URL. */
function navigate(url: string) {
  return new Promise<string>((resolve, reject) => {
    const target = new URL(url);
    const outgoing = request(
      {
        host: target.hostname,
        port: target.port,
        path: target.pathname,
        headers: {
          "sec-fetch-site": "none",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () =>
          response.statusCode === 200
            ? resolve(body)
            : reject(Error(`HTTP ${response.statusCode}`)),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

const launch = {
  sessionId: "abcd1234_00000000-0000-4000-8000-000000000000",
  launchGrant: "launch-00000000-0000-4000-8000-000000000001",
};

it("posts the launch, naming a proven installation as inert text", async () => {
  const open = async (device?: Parameters<typeof handOffToBrowser>[3]) => {
    let page = "";
    await handOffToBrowser(
      "https://editor.example",
      launch,
      async (url) => {
        page = await navigate(url);
      },
      device,
    );
    return page;
  };
  const proven = await open({
    publicKey: "k".repeat(43),
    signature: "s".repeat(86),
    name: 'Lab "PC" <1> & co (Windows)',
  });
  expect(proven).toContain(
    'action="https://editor.example/api/agent/editor-launch"',
  );
  expect(proven).toContain(`value="${launch.launchGrant}"`);
  expect(proven).toContain('name="deviceKey"');
  expect(proven).toContain(
    'name="deviceName" value="Lab &#34;PC&#34; &#60;1&#62; &#38; co (Windows)"',
  );
  expect(proven).not.toContain("<1>");
  // A one-time approval sends no device, so the browser offers no trust.
  const once = await open();
  expect(once).toContain(`value="${launch.launchGrant}"`);
  expect(once).not.toContain("device");
});
