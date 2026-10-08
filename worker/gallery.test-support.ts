// The harness the Gallery's tests share: a Gallery and an Auth Durable Object
// as the Worker deploys them, signed-in accounts, and Project fixtures.

import {
  CURRENT_MODEL_SCHEMA_VERSION,
  createEmptyProject,
  createRoutePath,
} from "@icm/model";
import { DatabaseSync } from "node:sqlite";
import { expect } from "vitest";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { routeGalleryRequest } from "./gallery";
import { type GalleryEnv } from "./gallery-store";
import { AI_SEATS, AuthDO, OWNER_ACCOUNT_IDS, type AuthEnv } from "./auth";
import {
  AuthDO as DeployedAuthDO,
  GalleryDO as DeployedGalleryDO,
} from "./index";

export function sqliteState(queries?: string[]) {
  const db = new DatabaseSync(":memory:");
  let transactionId = 0;
  return {
    storage: {
      sql: {
        exec<T>(query: string, ...bindings: unknown[]) {
          queries?.push(query);
          const statement = db.prepare(query);
          if (/^\s*(select|with|pragma|explain)/iu.test(query)) {
            const rows = statement.all(
              ...(bindings as (string | number | null)[]),
            ) as T[];
            return {
              toArray: () => rows,
              one: () => {
                if (rows.length !== 1) throw new Error("expected one row");
                return rows[0]!;
              },
            };
          }
          statement.run(...(bindings as (string | number | null)[]));
          return {
            toArray: () => [] as T[],
            one: () => {
              throw new Error("no rows");
            },
          };
        },
      },
      transactionSync<T>(callback: () => T): T {
        const savepoint = `test_transaction_${++transactionId}`;
        db.exec(`SAVEPOINT ${savepoint}`);
        try {
          const result = callback();
          db.exec(`RELEASE ${savepoint}`);
          return result;
        } catch (error) {
          db.exec(`ROLLBACK TO ${savepoint}`);
          db.exec(`RELEASE ${savepoint}`);
          throw error;
        }
      },
    },
  };
}

export type Harness = GalleryEnv & {
  authDurable: AuthDO;
  /** The accounts' storage, for an account a route cannot create. */
  authSql: ReturnType<typeof sqliteState>["storage"]["sql"];
  /** The gallery's own storage, for seeding rows a route cannot create. */
  gallerySql: ReturnType<typeof sqliteState>["storage"]["sql"];
  galleryQueries: string[];
};

/**
 * One harness for every test: a gallery DO plus the auth DO that is now the
 * only way to publish anything, both as the Worker deploys them.
 */
export function environment(): Harness {
  const galleryQueries: string[] = [];
  const galleryState = sqliteState(galleryQueries);
  const durable = new DeployedGalleryDO(galleryState);
  // Each store by its name, as the Worker binds them: the community wall's,
  // and each reference dataset's of its own (#1510).
  const stores = new Map<string, InstanceType<typeof DeployedGalleryDO>>([
    ["gallery", durable],
  ]);
  const store = (name: string) => {
    let found = stores.get(name);
    if (!found)
      stores.set(name, (found = new DeployedGalleryDO(sqliteState())));
    return found;
  };
  const authState = sqliteState();
  const authDurable = new DeployedAuthDO(authState, {
    RESEND_API_KEY: "rk",
    ADMIN_EMAILS: "owner@example.com",
  } as AuthEnv);
  return {
    GALLERY_BACKUP_TOKEN: READER_TOKEN,
    GALLERY: {
      getByName: (name: string) => ({
        fetch: (input: string, init?: RequestInit) =>
          store(name).fetch(new Request(input, init)),
      }),
    },
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          authDurable.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
    authDurable,
    authSql: authState.storage.sql,
    gallerySql: galleryState.storage.sql,
    galleryQueries,
  };
}

export const ORIGIN = "https://gallery.test";

/**
 * A `schema-restore` payload assembled from the one-row backup pages, as an
 * administrator assembles one now that no single response holds the store;
 * `page` reads one page.
 */
export async function pagedStoreBackup(
  page: (query: {
    scope: string;
    table: string;
    after?: string;
  }) => Promise<any>,
) {
  const tables: Record<string, unknown[]> = {};
  for (const table of [
    "galleryEntries",
    "galleryEntryVersions",
    "galleryLikes",
    "cloudProjects",
    "cloudProjectVersions",
  ]) {
    const rows: unknown[] = [];
    let after: string | undefined;
    do {
      const result = await page({
        scope: "store",
        table,
        ...(after ? { after } : {}),
      });
      rows.push(...result.rows);
      after = result.nextCursor ?? undefined;
    } while (after);
    tables[table] = rows;
  }
  return { format: "analog-canvas-gallery-schema-backup-v1", tables };
}

/** Save a new private Cloud Project for the signed-in `cookie`. */
export function saveRequest(cookie: string, name: string): Request {
  return new Request(`${ORIGIN}/api/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Origin: ORIGIN,
      Cookie: cookie,
    },
    body: JSON.stringify({ name, projectText: projectText(name) }),
  });
}

export function submissionRequest(
  body: unknown,
  overrides: {
    ip?: string;
    origin?: string | null;
    cookie?: string;
  } = {},
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (overrides.origin !== null) {
    headers.set("Origin", overrides.origin ?? ORIGIN);
  }
  if (overrides.cookie) headers.set("Cookie", overrides.cookie);
  headers.set("CF-Connecting-IP", overrides.ip ?? "203.0.113.7");
  return new Request(`${ORIGIN}/api/gallery/submissions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export function projectText(name = "Fixture"): string {
  return serializeProject(createEmptyProject("gallery-fixture", name));
}

export function formulaProjectText(
  latex = String.raw`\frac{1}{\sqrt{L_1C_1}}`,
): string {
  const project = createEmptyProject("formula-fixture", "Formula circuit");
  project.documents[0]!.drafting!.objects.push({
    id: "formula-note",
    kind: "text",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 100, y: 100 } },
    alignment: "middle",
    rotation: 0,
    content: {
      runs: [
        {
          kind: "math",
          latex,
          display: "block",
        },
      ],
    },
  });
  return serializeProject(project);
}

export function previousVersionText(): string {
  const raw = JSON.parse(JSON.stringify(parseProject(projectText())));
  raw.schemaVersion = CURRENT_MODEL_SCHEMA_VERSION;
  if (raw.schemaVersion < 50) {
    raw.simulationSetups = raw.simulationFolders;
    delete raw.simulationFolders;
  }
  return JSON.stringify(raw);
}

export function previousRouteVersionText(): string {
  // A structurally valid previous-window document. Route legs already use
  // the current shape, so the bounded upgrade is a version stamp — the
  // assertions protect the leg and anchor round-trip.
  const project = createEmptyProject("gallery-fixture", "Legacy Route");
  const document = project.documents[0]! as any;
  document.nets.push({ id: "net-route", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net-route", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net-route", position: { x: 100, y: 100 } },
  );
  const legacy = createRoutePath({
    id: "route-legacy",
    netId: "net-route",
    start: { kind: "junction", junctionId: "J1" },
    end: { kind: "junction", junctionId: "J2" },
    bends: [{ x: 100, y: 0 }],
    modes: ["manual", "trunk"],
  });
  document.routes.push(legacy);
  document.annotations.push({
    id: "label-route",
    kind: "net-label",
    netId: "net-route",
    binding: { kind: "net-name", netId: "net-route" },
    anchor: {
      kind: "route",
      routeId: "route-legacy",
      legId: legacy.legs[1]!.id,
      t: 0.5,
      normalOffset: -10,
      direction: "forward",
      orientation: "follow",
      fallbackPosition: { x: 100, y: 50 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  const raw = JSON.parse(JSON.stringify(project)) as any;
  raw.schemaVersion = CURRENT_MODEL_SCHEMA_VERSION;
  if (raw.schemaVersion < 50) {
    raw.simulationSetups = raw.simulationFolders;
    delete raw.simulationFolders;
  }
  return JSON.stringify(raw);
}

/**
 * The Gallery answers only signed-in readers or the read-only credential. A
 * test that reads without a session means "no account": it reads with the
 * credential, which the Gallery treats exactly like that.
 */
export const READER_TOKEN = "gallery-reader-test-token";

export function asReader(request: Request): Request {
  if (
    (request.method !== "GET" && request.method !== "HEAD") ||
    !new URL(request.url).pathname.startsWith("/api/gallery") ||
    request.headers.get("Cookie") ||
    request.headers.get("Authorization")
  )
    return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${READER_TOKEN}`);
  return new Request(request, { headers });
}

export async function route(env: GalleryEnv, request: Request) {
  const response = await routeGalleryRequest(asReader(request), env);
  if (!response) throw new Error("gallery route did not match");
  return response;
}

export function cookieHeaders(cookie: string): HeadersInit {
  return { Cookie: cookie };
}

/** A curator session: exempt from the gates and the daily quota. */
export function adminOf(env: Harness): Promise<string> {
  return signIn(env.authDurable, "owner@example.com");
}

/** An ordinary member: gated and quota-limited, but publishes directly. */
export function makerOf(env: Harness): Promise<string> {
  return signIn(env.authDurable, "maker@example.com");
}

/** One of the Owner's own accounts (OWNER_ACCOUNT_IDS), signed in. */
export async function ownerAccountOf(env: Harness): Promise<string> {
  const cookie = await signIn(env.authDurable, "zhishuai@example.com");
  const [user] = env.authSql
    .exec<{ id: string }>(
      "SELECT id FROM users WHERE email = ?",
      "zhishuai@example.com",
    )
    .toArray();
  const owner = OWNER_ACCOUNT_IDS[1]!;
  env.authSql.exec("UPDATE users SET id = ? WHERE id = ?", owner, user!.id);
  env.authSql.exec(
    "UPDATE sessions SET user_id = ? WHERE user_id = ?",
    owner,
    user!.id,
  );
  return cookie;
}

/** A browser the Owner switched to an AI account (seat). */
export async function seatOf(env: Harness, seat = 0): Promise<string> {
  const admin = await adminOf(env);
  return (
    await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/ai-accounts/switch`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: admin },
        body: JSON.stringify({ userId: AI_SEATS[seat]!.userId }),
      }),
    )
  ).headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("icm_session="))!
    .split(";")[0]!;
}

export async function submitOne(
  env: Harness,
  name: string,
  overrides: { ip?: string; text?: string; cookie?: string } = {},
): Promise<string> {
  const response = await route(
    env,
    submissionRequest(
      {
        name,
        description: "d",
        projectText: overrides.text ?? projectText(name),
      },
      {
        ip: overrides.ip ?? "203.0.113.7",
        cookie: overrides.cookie ?? (await adminOf(env)),
      },
    ),
  );
  expect(response.status).toBe(201);
  const payload = (await response.json()) as {
    id: string;
    previewRevision: string;
  };
  expect(payload.previewRevision).toMatch(/^[a-f0-9]{64}$/u);
  return payload.id;
}

export async function signIn(
  authDurable: AuthDO,
  email: string,
): Promise<string> {
  const sent: string[] = [];
  authDurable.fetchLike = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    void input;
    sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return Response.json({ id: "email-1" });
  }) as typeof fetch;
  await authDurable.fetch(
    new Request(`${ORIGIN}/api/auth/email/start`, {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  const code = /\b(\d{6})\b/u.exec(sent[0]!)![1]!;
  const verified = await authDurable.fetch(
    new Request(`${ORIGIN}/api/auth/email/verify`, {
      method: "POST",
      headers: { Origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    }),
  );
  return verified.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("icm_session="))!
    .split(";")[0]!;
}

export function wiredProjectText(
  name = "Wired",
  secondResistorX = 200,
): string {
  const project = createEmptyProject("g3", name);
  const document = project.documents[0]!;
  document.instances = [
    {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "R1",
      netlist: { parameters: {} },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: {
        position: { x: secondResistorX, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "R2",
      netlist: { parameters: {} },
    },
  ];
  document.nets = [
    {
      id: "n1",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    },
    {
      id: "n2",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "2" },
      ],
    },
  ];
  return serializeProject(project);
}
