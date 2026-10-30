// Selection boards (docs/specs/selection-boards.md): read by link, made by an
// administrator, changed by signed-in accounts with every change recorded.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createEmptyProject } from "@icm/model";
import {
  CURRENT_PROJECT_FILE_VERSION,
  serializeProject,
} from "@icm/project-protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthEnv } from "./auth";
import { entryIdOf, routeBoardsRequest } from "./boards";
import {
  environment,
  ORIGIN,
  projectText,
  signIn,
  sqliteState,
  type Harness,
} from "./gallery.test-support";
import { AuthDO as DeployedAuthDO } from "./index";

/** A one-Cell drawing of the given parts, none of them wired. */
function partsProjectText(name: string, symbols: string[]): string {
  const project = createEmptyProject("parts", name);
  project.documents[0]!.instances = symbols.map((symbolId, index) => ({
    id: `P${index}`,
    symbolId,
    placement: {
      position: { x: index * 100, y: 0 },
      rotation: 0,
      mirror: "none",
    },
    reference: `P${index}`,
    netlist: { parameters: {} },
  }));
  return serializeProject(project);
}

function seed(
  env: Harness,
  id: string,
  name: string,
  status = "public",
  extra: { project?: string; tags?: string } = {},
) {
  env.gallerySql.exec(
    `INSERT INTO gallery_entries
       (id, name, author, description, created_at, schema_version, status,
        project_text, svg_text, preview_revision, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    `${name} author`,
    "",
    "2026-10-01T00:00:00.000Z",
    CURRENT_PROJECT_FILE_VERSION,
    status,
    extra.project ?? projectText(name),
    `<svg viewBox="0 0 10 10"><title>${name}</title></svg>`,
    `rev-${id}`,
    extra.tags ?? "",
  );
}

async function call(
  env: Harness,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    cookie?: string;
    origin?: string | null;
  } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.origin !== null) headers.set("Origin", init.origin ?? ORIGIN);
  const response = await routeBoardsRequest(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? null : JSON.stringify(init.body),
    }),
    env,
  );
  if (!response) throw new Error(`no board route for ${path}`);
  return response;
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

describe("selection boards", () => {
  let env: Harness;
  let admin: string;
  let collaborator: string;

  beforeEach(async () => {
    env = environment();
    for (const [id, name] of [
      ["entry-a", "Five-transistor OTA"],
      ["entry-b", "Bandgap"],
      ["entry-c", "Comparator"],
      ["entry-d", "LDO"],
    ])
      seed(env, id!, name!);
    seed(env, "entry-hidden", "Recycled circuit", "recycled");
    admin = await signIn(env.authDurable, "owner@example.com");
    collaborator = await signIn(env.authDurable, "friend@example.com");
  });

  async function makeBoard(
    entries = ["entry-a", `${ORIGIN}/g/entry-b`],
    slots = 3,
  ) {
    const response = await call(env, "/api/boards", {
      method: "POST",
      cookie: admin,
      body: { title: "Season 1", slots, entries },
    });
    expect(response.status).toBe(200);
    return (await json(response)).board.id as string;
  }

  it("lets an administrator make a board that anyone with its link reads", async () => {
    const id = await makeBoard();
    expect(id).toMatch(/^[A-Za-z0-9]{24}$/u);
    const read = await json(
      await call(env, `/api/boards/${id}`, { origin: null }),
    );
    expect(read.board).toMatchObject({
      title: "Season 1",
      slots: 3,
      lockedAt: null,
    });
    expect(read.board.createdById).toBeUndefined();
    expect(
      read.items.map((item: any) => [
        item.entryId,
        item.entry.name,
        item.entry.author,
      ]),
    ).toEqual([
      ["entry-a", "Five-transistor OTA", "Five-transistor OTA author"],
      ["entry-b", "Bandgap", "Bandgap author"],
    ]);
    expect(read.viewer).toMatchObject({ signedIn: false, canEdit: false });
    expect(read.events.map((event: any) => event.action)).toEqual([
      "add",
      "add",
      "create",
    ]);

    const page = await call(env, `/boards/${id}`, { origin: null });
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("x-robots-tag")).toBe("noindex");
    expect(
      (
        await call(env, "/api/boards/NotABoardIdAtAll12345678", {
          origin: null,
        })
      ).status,
    ).toBe(404);
  });

  it("refuses to make a board for anyone but an administrator", async () => {
    const body = { title: "Mine", slots: 5 };
    expect(
      (await call(env, "/api/boards", { method: "POST", body })).status,
    ).toBe(401);
    const refused = await call(env, "/api/boards", {
      method: "POST",
      cookie: collaborator,
      body,
    });
    expect(refused.status).toBe(403);
    expect(await json(refused)).toEqual({ error: "admin-only" });
  });

  it("records who adds, replaces, notes, moves and removes", async () => {
    const id = await makeBoard();
    const change = async (changes: unknown[]) =>
      call(env, `/api/boards/${id}/changes`, {
        method: "POST",
        cookie: collaborator,
        body: { changes },
      });

    let board = await json(
      await change([
        { kind: "add", entry: `${ORIGIN}/g/entry-c`, note: "fast comparator" },
      ]),
    );
    const [first, second, third] = board.items;
    expect(third).toMatchObject({
      entryId: "entry-c",
      note: "fast comparator",
      addedBy: "friend",
    });
    expect(board.viewer).toMatchObject({
      signedIn: true,
      canEdit: true,
      canUnlock: false,
    });

    board = await json(
      await change([{ kind: "replace", itemId: second.id, entry: "entry-d" }]),
    );
    expect(board.items[1]).toMatchObject({
      id: second.id,
      entryId: "entry-d",
      addedBy: "friend",
    });
    board = await json(
      await change([{ kind: "note", itemId: first.id, note: "keep" }]),
    );
    board = await json(
      await change([{ kind: "move", itemId: third.id, to: 0 }]),
    );
    expect(board.items.map((item: any) => item.entryId)).toEqual([
      "entry-c",
      "entry-a",
      "entry-d",
    ]);
    board = await json(await change([{ kind: "remove", itemId: first.id }]));
    expect(
      board.items.map((item: any) => [item.position, item.entryId]),
    ).toEqual([
      [0, "entry-c"],
      [1, "entry-d"],
    ]);
    expect(
      board.events
        .slice(0, 5)
        .map((event: any) => [
          event.actor,
          event.action,
          event.entryId,
          event.previousEntryId,
        ]),
    ).toEqual([
      ["friend", "remove", null, "entry-a"],
      ["friend", "move", "entry-c", null],
      ["friend", "note", "entry-a", null],
      ["friend", "replace", "entry-d", "entry-b"],
      ["friend", "add", "entry-c", null],
    ]);
    expect(board.entryNames).toMatchObject({
      "entry-b": "Bandgap",
      "entry-d": "LDO",
    });
  });

  it("takes only public entries, each once, within the slots, all or none", async () => {
    const id = await makeBoard();
    const change = async (changes: unknown[]) =>
      call(env, `/api/boards/${id}/changes`, {
        method: "POST",
        cookie: collaborator,
        body: { changes },
      });
    const before = (await json(await call(env, `/api/boards/${id}`))).board
      .revision;

    let refused = await change([{ kind: "add", entry: "entry-hidden" }]);
    expect(refused.status).toBe(404);
    expect(await json(refused)).toEqual({
      error: "entry-not-public",
      entryId: "entry-hidden",
    });
    refused = await change([{ kind: "add", entry: "entry-a" }]);
    expect(await json(refused)).toEqual({
      error: "entry-already-on-board",
      entryId: "entry-a",
    });
    refused = await change([
      { kind: "add", entry: "entry-c" },
      { kind: "add", entry: "entry-d" },
    ]);
    expect(await json(refused)).toEqual({ error: "board-full" });
    expect((await change([{ kind: "add", entry: "not a link" }])).status).toBe(
      400,
    );

    const after = await json(await call(env, `/api/boards/${id}`));
    expect(after.board.revision).toBe(before);
    expect(after.items).toHaveLength(2);
  });

  it("refuses changes from signed-out readers and other sites", async () => {
    const id = await makeBoard();
    const body = { changes: [{ kind: "add", entry: "entry-c" }] };
    expect(
      (await call(env, `/api/boards/${id}/changes`, { method: "POST", body }))
        .status,
    ).toBe(401);
    expect(
      (
        await call(env, `/api/boards/${id}/changes`, {
          method: "POST",
          cookie: collaborator,
          origin: "https://elsewhere.example",
          body,
        })
      ).status,
    ).toBe(403);
  });

  it("locks a board until its maker or an administrator unlocks it", async () => {
    const id = await makeBoard();
    const change = async (cookie: string, changes: unknown[]) =>
      call(env, `/api/boards/${id}/changes`, {
        method: "POST",
        cookie,
        body: { changes },
      });
    expect((await change(collaborator, [{ kind: "lock" }])).status).toBe(200);
    expect(
      await json(
        await change(collaborator, [{ kind: "add", entry: "entry-c" }]),
      ),
    ).toEqual({ error: "board-locked" });
    expect(
      await json(await change(collaborator, [{ kind: "unlock" }])),
    ).toEqual({ error: "not-allowed" });
    const unlocked = await json(await change(admin, [{ kind: "unlock" }]));
    expect(unlocked.board.lockedAt).toBeNull();
    expect(unlocked.viewer.canUnlock).toBe(true);
  });

  it("serves previews only of the entries on the board, and exports the list", async () => {
    const id = await makeBoard();
    const shown = await call(
      env,
      `/api/boards/${id}/preview/entry-a?v=rev-entry-a`,
      { origin: null },
    );
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/svg+xml");
    expect(await shown.text()).toMatch(/^<svg/u);
    expect(
      (await call(env, `/api/boards/${id}/preview/entry-c`, { origin: null }))
        .status,
    ).toBe(404);

    const exported = await json(
      await call(env, `/api/boards/${id}/export`, { origin: null }),
    );
    expect(
      exported.items.map((item: any) => [
        item.position,
        item.entryId,
        item.url,
        item.name,
      ]),
    ).toEqual([
      [1, "entry-a", `${ORIGIN}/g/entry-a`, "Five-transistor OTA"],
      [2, "entry-b", `${ORIGIN}/g/entry-b`, "Bandgap"],
    ]);
  });

  it("forgets a deleted account's name on every board", async () => {
    const id = await makeBoard();
    const me = await env
      .AUTH!.getByName("auth")
      .fetch(
        new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: admin } }),
      );
    const userId = ((await me.json()) as { user: { id: string } }).user.id;
    await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/delete-account",
      {
        method: "POST",
        body: JSON.stringify({ userId }),
      },
    );
    const read = await json(await call(env, `/api/boards/${id}`));
    expect(read.board.createdBy).toBe("(deleted account)");
    expect(new Set(read.events.map((event: any) => event.actor))).toEqual(
      new Set(["(deleted account)"]),
    );
  });

  it("names an entry by its id or any Canvas link to it", () => {
    expect(entryIdOf("tzded8fs4r")).toBe("tzded8fs4r");
    expect(entryIdOf("https://analog-canvas.tokenzhang.com/g/tzded8fs4r")).toBe(
      "tzded8fs4r",
    );
    expect(
      entryIdOf(
        "https://analog-canvas.tokenzhang.com/api/gallery/tzded8fs4r/preview.svg",
      ),
    ).toBe("tzded8fs4r");
    expect(entryIdOf("https://example.com/")).toBeNull();
    expect(entryIdOf("two words")).toBeNull();
  });

  it("returns a sign-in started on a board to that board", async () => {
    const auth = new DeployedAuthDO(sqliteState(), {
      GH_OAUTH_CLIENT_ID: "client",
      GH_OAUTH_CLIENT_SECRET: "secret",
    } as AuthEnv);
    const started = await auth.fetch(
      new Request(
        `${ORIGIN}/api/auth/github/start?return=${encodeURIComponent("/boards/AbCdEfGhIjKlMnOpQrStUvWx")}`,
      ),
    );
    const state = new URL(started.headers.get("location")!).searchParams.get(
      "state",
    )!;
    expect(decodeURIComponent(state.split(".")[1]!)).toBe(
      "/boards/AbCdEfGhIjKlMnOpQrStUvWx",
    );
  });

  it("reaches the Worker before the asset layer answers with the shell", () => {
    // Without these, Production serves the editor shell at /boards/<id>.
    const wrangler = readFileSync(
      resolve(process.cwd(), "wrangler.jsonc"),
      "utf8",
    );
    expect(wrangler).toContain(`"/boards",`);
    expect(wrangler).toContain(`"/boards/*",`);
  });

  it("draws each entry plain: no colour, no frames or notes", async () => {
    const raw = JSON.parse(partsProjectText("Coloured", ["nmos", "resistor"]));
    raw.documents[0].instances[0].color = "#dc2626";
    raw.documents[0].drafting = {
      ...(raw.documents[0].drafting ?? {}),
      objects: [
        {
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          center: { x: 0, y: 0 },
          height: 100,
          id: "rectangle-1",
          kind: "rectangle",
          lineStyle: "solid",
          locked: false,
          rotation: 0,
          styleOverride: { color: "#2563eb", lineStyle: "dashed" },
          width: 100,
          zIndex: 0,
        },
      ],
    };
    seed(env, "entry-coloured", "Coloured", "public", {
      project: JSON.stringify(raw),
    });
    const id = await makeBoard(["entry-coloured"]);
    const svg = await (
      await call(
        env,
        `/api/boards/${id}/preview/entry-coloured?v=rev-entry-coloured`,
        { origin: null },
      )
    ).text();
    expect(svg).toMatch(/^<svg/u);
    expect(svg.toLowerCase()).not.toContain("#dc2626");
    expect(svg.toLowerCase()).not.toContain("#2563eb");
  });

  it("counts transistors and levels, and types each entry by its tags or by hand", async () => {
    seed(env, "entry-flat", "Flat pair", "public", {
      project: partsProjectText("Flat pair", [
        "nmos",
        "nmos",
        "pmos",
        "resistor",
      ]),
      tags: ",two stage,cmfb,",
    });
    seed(env, "entry-block", "With an op-amp", "public", {
      project: partsProjectText("With an op-amp", ["opamp", "pnp", "resistor"]),
      tags: ",bandgap,",
    });
    const id = await makeBoard(["entry-flat", "entry-block"]);
    let board = await json(await call(env, `/api/boards/${id}`));
    expect(board.types).toContain("Amplifiers");
    expect(board.types).not.toContain("Design Attributes");
    expect(
      board.items.map((item: any) => [
        item.entryId,
        item.type,
        item.entry.tagType,
        item.entry.transistors,
        item.entry.levels,
      ]),
    ).toEqual([
      ["entry-flat", null, "Amplifiers", 3, "single"],
      ["entry-block", null, "Bias & references", 1, "multi"],
    ]);

    const change = async (changes: unknown[]) =>
      call(env, `/api/boards/${id}/changes`, {
        method: "POST",
        cookie: collaborator,
        body: { changes },
      });
    board = await json(
      await change([
        { kind: "type", itemId: board.items[1].id, type: "Power" },
      ]),
    );
    expect(board.items[1].type).toBe("Power");
    expect(board.events[0]).toMatchObject({
      actor: "friend",
      action: "type",
      entryId: "entry-block",
      detail: "Power",
    });
    expect(
      await json(
        await change([
          {
            kind: "type",
            itemId: board.items[1].id,
            type: "Design Attributes",
          },
        ]),
      ),
    ).toEqual({
      error: "bad-type",
    });
    const exported = await json(await call(env, `/api/boards/${id}/export`));
    expect(
      exported.items.map((item: any) => [
        item.type,
        item.transistors,
        item.levels,
      ]),
    ).toEqual([
      ["Amplifiers", 3, "single"],
      ["Power", 1, "multi"],
    ]);
  });
});
