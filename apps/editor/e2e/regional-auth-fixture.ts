import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AuthDO } from "../../../worker/auth-do";
import { RegionalSessionDO } from "../../../worker/regional-session";
import { build } from "vite";
import { fileURLToPath } from "node:url";

/** Two real Auth HTTP stores; only delivery to the external mail provider is replaced. */
export async function regionalAccounts(editorOrigin: string) {
  // The deployed Gallery imports JSON through the Worker bundler. Preserve that
  // loading boundary instead of substituting its authorization responses.
  const bundled = await build({
    configFile: false,
    logLevel: "silent",
    ssr: { noExternal: true },
    build: {
      ssr: fileURLToPath(
        new URL("../../../worker/gallery.ts", import.meta.url),
      ),
      write: false,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  });
  if (!("output" in bundled)) throw new Error("Expected one Gallery bundle");
  const chunk = bundled.output.find(
    (item) => item.type === "chunk" && item.isEntry,
  );
  if (!chunk || chunk.type !== "chunk")
    throw new Error("Missing Gallery bundle");
  const { GalleryDO, routeGalleryRequest } = (await import(
    "data:text/javascript;base64," + Buffer.from(chunk.code).toString("base64")
  )) as typeof import("../../../worker/gallery");
  const databases: DatabaseSync[] = [];
  const state = () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    let transaction = 0;
    return {
      storage: {
        sql: {
          exec<T>(query: string, ...bindings: (string | number | null)[]) {
            const statement = db.prepare(query);
            const rows = statement.columns().length
              ? (statement.all(...bindings) as T[])
              : (statement.run(...bindings), [] as T[]);
            return {
              toArray: () => rows,
              one: () => {
                if (rows.length !== 1) throw new Error("Expected one row");
                return rows[0]!;
              },
            };
          },
        },
        transactionSync<T>(run: () => T): T {
          const savepoint = `browser_tx_${++transaction}`;
          db.exec(`SAVEPOINT ${savepoint}`);
          try {
            const value = run();
            db.exec(`RELEASE ${savepoint}`);
            return value;
          } catch (error) {
            db.exec(`ROLLBACK TO ${savepoint}`);
            db.exec(`RELEASE ${savepoint}`);
            throw error;
          }
        },
        setAlarm: async () => {},
      },
    };
  };
  const authorityServer = await httpServer((request) =>
    authority.fetch(request),
  );
  const clientServer = await httpServer(async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/")) return region.fetch(request);
    if (
      url.pathname.startsWith("/api/gallery") ||
      url.pathname.startsWith("/api/projects")
    ) {
      const response = await routeGalleryRequest(request, {
        AUTH: {
          getByName: () => ({
            fetch: (input, init) => region.fetch(new Request(input, init)),
          }),
        },
        GALLERY: {
          getByName: () => ({
            fetch: (input, init) => gallery.fetch(new Request(input, init)),
          }),
        },
      });
      if (response) return response;
    }
    return fetch(
      new Request(new URL(url.pathname + url.search, editorOrigin), request),
      { redirect: "manual" },
    );
  });
  const origin = authorityServer.origin;
  const clientOrigin = clientServer.origin;
  const config = JSON.stringify({
    origin,
    clientOrigin,
    secret: "browser-acceptance-isolated-service-secret",
  });
  const authority = new AuthDO(state(), {
    AUTH: undefined as never,
    AUTH_REGIONAL_AUTHORITY: config,
    RESEND_API_KEY: "isolated-mail",
  });
  const region = new RegionalSessionDO(state(), {
    AUTH_REGIONAL_CLIENT: config,
  });
  const gallery = new GalleryDO(state());
  let time = Date.now();
  authority.now = () => new Date(time);
  region.now = () => time;
  let code = "";
  authority.fetchLike = async (input, init) => {
    if (String(input) !== "https://api.resend.com/emails")
      throw new Error("Unexpected provider request");
    const message = JSON.parse(String(init?.body)) as { text: string };
    code = /\b(\d{6})\b/u.exec(message.text)?.[1] ?? "";
    return Response.json({ id: "isolated-email" });
  };
  return {
    origin: clientOrigin,
    expireLease: () => {
      time += 60_001;
    },
    emailCode: () => code,
    close: async () => {
      await Promise.all([authorityServer.close(), clientServer.close()]);
      databases.forEach((db) => db.close());
    },
  };
}

/** Real HTTP is necessary: browser routing substitutes do not follow every redirect. */
async function httpServer(handle: (request: Request) => Promise<Response>) {
  let origin = "";
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      try {
        const parts: Buffer[] = [];
        for await (const part of incoming) parts.push(Buffer.from(part));
        const headers = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2)
          headers.append(incoming.rawHeaders[i]!, incoming.rawHeaders[i + 1]!);
        const response = await handle(
          new Request(new URL(incoming.url!, origin), {
            method: incoming.method ?? "GET",
            headers,
            ...(parts.length ? { body: Buffer.concat(parts) } : {}),
          }),
        );
        outgoing.statusCode = response.status;
        for (const [key, value] of response.headers)
          if (
            !["set-cookie", "content-encoding", "content-length"].includes(key)
          )
            outgoing.setHeader(key, value);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) outgoing.setHeader("set-cookie", cookies);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        outgoing.statusCode = 500;
        outgoing.end("Isolated Auth HTTP server failed");
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
