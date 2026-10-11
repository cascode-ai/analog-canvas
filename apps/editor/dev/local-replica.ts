import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin, ProxyOptions } from "vite";
import type { Unstable_DevWorker } from "wrangler";
import { LOCAL_GALLERY_REPLICA } from "../src/gallery-source";

type ReplicaRole = "owner" | "moderator" | "user";

interface ReplicaAccount {
  id: string;
  name: string;
  provider: string;
  role: ReplicaRole;
  published: number;
  withdrawn: number;
  rejected: number;
  token: string;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const SESSION_COOKIE = "icm_session";
/** Set by Sign out, so the next page stays signed out. */
const SIGNED_OUT_COOKIE = "icm_replica_signed_out";

function cookies(header: string | undefined): Map<string, string> {
  return new Map(
    (header ?? "")
      .split(";")
      .map((part) => part.trim().split("=") as [string, string])
      .filter(([name]) => name),
  );
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

function replicaDirectory(): string {
  return resolve(
    process.env.ICM_LOCAL_REPLICA_DIR ??
      join(
        homedir(),
        "Library",
        "Application Support",
        "Analog Canvas",
        "local-replica",
      ),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const ROLES: { role: ReplicaRole; badge: string; heading: string }[] = [
  { role: "owner", badge: "Owner", heading: "Owner" },
  { role: "moderator", badge: "Moderator", heading: "Moderators" },
  { role: "user", badge: "User", heading: "Users" },
];

function accountsPage(
  accounts: ReplicaAccount[],
  source: { backup: string },
): string {
  const row = (account: ReplicaAccount, badge: string) => {
    const total = account.published + account.withdrawn + account.rejected;
    const extra = [
      account.withdrawn ? `${account.withdrawn} withdrawn` : "",
      account.rejected ? `${account.rejected} rejected` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return `<li data-name="${escapeHtml(account.name.toLowerCase())}"><a href="/__dev/login?user=${encodeURIComponent(account.id)}"><span class="role role-${account.role}">${badge}</span><strong>${escapeHtml(account.name)}</strong><span class="meta">${escapeHtml(account.provider)} · ${total} circuit${total === 1 ? "" : "s"}${extra ? ` (${extra})` : ""}</span></a></li>`;
  };
  const sections = ROLES.map(({ role, badge, heading }) => {
    const members = accounts.filter((account) => account.role === role);
    return members.length
      ? `<section><h2>${heading} <span>${members.length}</span></h2><ul>${members.map((account) => row(account, badge)).join("")}</ul></section>`
      : "";
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local replica · switch account</title><style>
body{margin:0;font:14px/1.45 system-ui,sans-serif;color:#1f2328;background:#f6f8fa}
main{max-width:40rem;margin:0 auto;padding:24px 16px 48px}
h1{margin:0 0 4px;font-size:20px}p{margin:0 0 16px;color:#59636e}
h2{margin:18px 0 8px;font-size:13px;font-weight:650;color:#59636e;text-transform:uppercase;letter-spacing:.04em}h2 span{font-weight:400}
input{box-sizing:border-box;width:100%;height:36px;margin:0 0 4px;padding:0 10px;border:1px solid #d1d9e0;border-radius:6px;font:inherit}
ul{margin:0;padding:0;list-style:none;border:1px solid #d1d9e0;border-radius:10px;background:#fff;overflow:hidden}
li+li{border-top:1px solid #eef1f4}
a{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:10px 14px;color:inherit;text-decoration:none}
a:hover{background:#f3f6fa}.meta{color:#59636e;font-size:13px}
.role{min-width:4.6rem;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;text-align:center;text-transform:uppercase}
.role-owner{color:#0969da;background:#ddf4ff}.role-moderator{color:#1a7f37;background:#dafbe1}.role-user{color:#59636e;background:#eef1f4}
</style></head><body><main><h1>Switch account</h1><p>Only on this computer: the local replica of ${escapeHtml(source.backup)}. Pick whose view to see; nothing here reaches the live site. The backup holds no roles, so the Owners are the accounts that reviewed circuits.</p><input type="search" placeholder="Filter by name" autofocus oninput="const q = this.value.trim().toLowerCase(); for (const row of document.querySelectorAll('li')) row.hidden = !row.dataset.name.includes(q); for (const section of document.querySelectorAll('section')) section.hidden = !section.querySelector('li:not([hidden])')">${sections}</main></body></html>`;
}

/**
 * Local trial only, opt-in with ICM_LOCAL_REPLICA=1 after
 * `pnpm replica:import`: the real Worker runs on the private replica, every
 * /api/ request the other dev plugins leave goes to it, and /__dev/accounts
 * signs in as any of its accounts. Signing in leads there; signing out keeps
 * the account's local session for next time.
 */
export function localReplica(enabled = process.env.ICM_LOCAL_REPLICA): Plugin {
  const directory = replicaDirectory();
  let worker: Promise<Unstable_DevWorker> | undefined;
  let proxyOptions: ProxyOptions;
  let closing = false;

  function start(): Promise<Unstable_DevWorker> {
    if (closing) return Promise.reject(new Error("Local replica is closing"));
    worker ??= import("wrangler")
      .then(({ unstable_dev }) =>
        unstable_dev(
          fileURLToPath(new URL("../../../worker/index.ts", import.meta.url)),
          {
            config: fileURLToPath(
              new URL("./replica-wrangler.json", import.meta.url),
            ),
            envFiles: [],
            local: true,
            ip: "127.0.0.1",
            port: 0,
            inspectorPort: 0,
            persist: true,
            persistTo: join(directory, "state"),
            logLevel: "error",
            experimental: {
              disableExperimentalWarning: true,
              disableDevRegistry: true,
              showInteractiveDevSession: false,
              watch: true,
            },
          },
        ),
      )
      .catch((error: unknown) => {
        worker = undefined;
        throw error;
      });
    return worker;
  }

  const accounts = (): ReplicaAccount[] => {
    try {
      return JSON.parse(
        readFileSync(join(directory, "accounts.json"), "utf8"),
      ) as ReplicaAccount[];
    } catch {
      return [];
    }
  };
  const source = (): { backup: string } => {
    try {
      return JSON.parse(
        readFileSync(join(directory, "source.json"), "utf8"),
      ) as { backup: string };
    } catch {
      return { backup: "no backup" };
    }
  };

  const replicaProxy: ProxyOptions = {
    // Keep the editor's Host, so the Worker answers for this origin.
    changeOrigin: false,
    configure(_server, options) {
      proxyOptions = options;
    },
    async bypass(request, response) {
      try {
        const runtime = await start();
        proxyOptions.target = `http://${runtime.address}:${runtime.port}`;
      } catch (error) {
        console.error("Local replica could not start:", error);
        response?.writeHead(503, { "content-type": "application/json" });
        response?.end(JSON.stringify({ error: "local-replica-unavailable" }));
        return request.url ?? "/api/";
      }
    },
  };

  const json = (response: ServerResponse, payload: unknown) => {
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(payload));
  };
  const redirect = (
    response: ServerResponse,
    location: string,
    setCookies: string[] = [],
  ) => {
    response.writeHead(302, {
      location,
      "cache-control": "no-store",
      ...(setCookies.length ? { "set-cookie": setCookies } : {}),
    });
    response.end();
  };

  function answer(request: IncomingMessage, response: ServerResponse): boolean {
    const url = new URL(request.url ?? "/", "http://replica");
    const method = request.method ?? "GET";
    // The replica offers the live site's ways in. GitHub and Google lead to
    // the account switcher; an emailed code, any code, signs in as the Owner.
    if (url.pathname === "/api/auth/providers" && method === "GET") {
      json(response, { github: true, google: true, email: true });
      return true;
    }
    if (
      url.pathname === "/api/auth/github/start" ||
      url.pathname === "/api/auth/google/start"
    ) {
      redirect(response, "/__dev/accounts");
      return true;
    }
    if (url.pathname === "/api/auth/email/start" && method === "POST") {
      request.resume();
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return true;
    }
    if (url.pathname === "/api/auth/email/verify" && method === "POST") {
      request.resume();
      const owner = accounts().find((account) => account.role === "owner");
      if (!owner) return false;
      response.setHeader("set-cookie", [
        sessionCookie(owner.token),
        `${SIGNED_OUT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
      ]);
      json(response, { ok: true });
      return true;
    }
    // Signing out forgets the browser's cookie but keeps the account's
    // replica session, so the switcher can sign in as it again.
    if (url.pathname === "/api/auth/logout" && method === "POST") {
      response.setHeader("set-cookie", [
        `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        `${SIGNED_OUT_COOKIE}=1; Path=/; SameSite=Lax`,
      ]);
      json(response, { ok: true });
      return true;
    }
    if (!url.pathname.startsWith("/__dev/")) {
      // A page opened with no session is the Owner's, as the operator sees
      // the live site, until Sign out; the switcher is for anyone else.
      const held = cookies(request.headers.cookie);
      const known = accounts();
      // A session from before a re-import that is gone counts as none.
      const session = held.get(SESSION_COOKIE);
      if (
        method === "GET" &&
        (request.headers.accept ?? "").includes("text/html") &&
        !url.pathname.startsWith("/api/") &&
        !known.some((account) => account.token === session) &&
        !held.has(SIGNED_OUT_COOKIE)
      ) {
        const owner = known.find((account) => account.role === "owner");
        if (owner) response.setHeader("set-cookie", sessionCookie(owner.token));
      }
      return false;
    }
    if (!LOOPBACK.has(request.socket.remoteAddress ?? "")) {
      response.writeHead(403).end();
      return true;
    }
    if (url.pathname === "/__dev/accounts") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(accountsPage(accounts(), source()));
      return true;
    }
    if (url.pathname === "/__dev/login") {
      const account = accounts().find(
        (candidate) => candidate.id === url.searchParams.get("user"),
      );
      if (!account) {
        redirect(response, "/__dev/accounts");
        return true;
      }
      redirect(response, "/account", [
        sessionCookie(account.token),
        `${SIGNED_OUT_COOKIE}=; Path=/; SameSite=Lax; Max-Age=0`,
      ]);
      return true;
    }
    return false;
  }

  return {
    name: "local-replica",
    apply: "serve",
    transformIndexHtml() {
      return enabled
        ? [
            {
              tag: "script",
              children: `window.${LOCAL_GALLERY_REPLICA}=true;`,
              injectTo: "head-prepend" as const,
            },
          ]
        : [];
    },
    config() {
      if (!enabled) return;
      return { server: { proxy: { "/api/": replicaProxy } } };
    },
    configureServer(server) {
      if (!enabled) return;
      if (!existsSync(join(directory, "accounts.json")))
        server.config.logger.warn(
          "No local replica yet: run pnpm replica:import first.",
        );
      // Start at once, so the first page does not wait for it.
      void start().catch((error: unknown) =>
        console.error("Local replica could not start:", error),
      );
      server.middlewares.use((request, response, next) => {
        if (!answer(request, response)) next();
      });
    },
    async closeBundle() {
      closing = true;
      await worker?.then(
        (runtime) => runtime.stop(),
        () => undefined,
      );
    },
  };
}
