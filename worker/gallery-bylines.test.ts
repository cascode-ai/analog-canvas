// Bylines: AI accounts' names and take-overs, and contributor renames.

import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { GalleryDO } from "./gallery";
import { AI_SEATS } from "./auth";
import {
  ORIGIN,
  environment,
  makerOf,
  projectText,
  route,
  seatOf,
  sqliteState,
  submitOne,
} from "./gallery.test-support";

describe("AI account bylines", () => {
  it("gives an AI account's circuits and versions its listed name and the AI mark when the Gallery starts", () => {
    const state = sqliteState();
    new GalleryDO(state);
    const sql = state.storage.sql;
    const seat = AI_SEATS[0]!;
    const at = "2026-10-01T00:00:00.000Z";
    const second = AI_SEATS[1]!;
    for (const [id, owner, author] of [
      ["seat-entry", seat.userId, seat.formerName!],
      ["person-entry", "person", seat.formerName!],
      // A person's account under a listed id, which AuthDO leaves alone.
      ["unconverted-entry", second.userId, "Someone"],
    ])
      sql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          owner_user_id, project_text, svg_text)
         VALUES (?, ?, ?, '', ?, ?, 'public', ?, ?, '<svg/>')`,
        id,
        id,
        author,
        at,
        CURRENT_PROJECT_FILE_VERSION,
        owner,
        projectText(id),
      );
    sql.exec(
      `INSERT INTO gallery_entry_versions
       (id, entry_id, version_no, name, author, description,
        schema_version, project_text, svg_text, created_at)
       VALUES ('seat-v1', 'seat-entry', 1, 'seat-entry', ?, '', ?, ?,
         '<svg/>', ?)`,
      seat.formerName,
      CURRENT_PROJECT_FILE_VERSION,
      projectText("seat-entry"),
      at,
    );
    new GalleryDO(state);
    const authors = (table: string) =>
      sql
        .exec<{ id: string; author: string }>(
          `SELECT id, author FROM ${table} ORDER BY id`,
        )
        .toArray();
    expect(authors("gallery_entries")).toEqual([
      // A person who happens to use the same byline keeps it.
      { id: "person-entry", author: seat.formerName },
      { id: "seat-entry", author: seat.displayName },
      { id: "unconverted-entry", author: "Someone" },
    ]);
    // An AI account's circuits carry the AI mark too.
    expect(
      sql
        .exec<{ id: string; ai_generated: number }>(
          "SELECT id, ai_generated FROM gallery_entries ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      { id: "person-entry", ai_generated: 0 },
      { id: "seat-entry", ai_generated: 1 },
      { id: "unconverted-entry", ai_generated: 0 },
    ]);
    expect(authors("gallery_entry_versions")).toEqual([
      { id: "seat-v1", author: seat.displayName },
    ]);
  });
});

describe("AI accounts taking over each other's circuits (#1499)", () => {
  it("moves an AI account's circuit to the AI account whose update takes it over, never a person's", async () => {
    const env = environment();
    const [claude, , sol] = AI_SEATS;
    const solCookie = await seatOf(env, 2);
    const claudeCookie = await seatOf(env, 0);
    const id = await submitOne(env, "Wien bridge", { cookie: solCookie });
    const update = (entryId: string, cookie: string, takeOver?: boolean) =>
      route(
        env,
        new Request(`${ORIGIN}/api/gallery/${entryId}`, {
          method: "PUT",
          headers: {
            Origin: ORIGIN,
            Cookie: cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Wien bridge",
            description: "Redone",
            projectText: projectText("Wien bridge"),
            ...(takeOver === undefined ? {} : { takeOver }),
          }),
        }),
      );
    // Without a take-over, another account's circuit stays its own.
    expect((await update(id, claudeCookie)).status).toBe(403);
    const taken = await update(id, claudeCookie, true);
    expect(taken.status).toBe(200);
    expect(await taken.json()).toMatchObject({
      id,
      ownerUserId: claude!.userId,
      author: claude!.displayName,
    });
    const entry = () =>
      env.gallerySql
        .exec<{ owner_user_id: string; author: string; ai_generated: number }>(
          "SELECT owner_user_id, author, ai_generated FROM gallery_entries WHERE id = ?",
          id,
        )
        .toArray()[0];
    expect(entry()).toEqual({
      owner_user_id: claude!.userId,
      author: claude!.displayName,
      ai_generated: 1,
    });
    // The version it replaced keeps the account that made it.
    expect(
      env.gallerySql
        .exec<{ author: string }>(
          "SELECT author FROM gallery_entry_versions WHERE entry_id = ?",
          id,
        )
        .toArray(),
    ).toEqual([{ author: sol!.displayName }]);
    // The new owner updates it as its own; the former one no longer can.
    expect((await update(id, claudeCookie)).status).toBe(200);
    expect((await update(id, solCookie)).status).toBe(403);

    // A person's circuit is never taken over, and a person takes over none.
    const person = await makerOf(env);
    const mine = await submitOne(env, "Mine", { cookie: person });
    const refused = await update(mine, claudeCookie, true);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "take-over-forbidden" });
    expect((await update(id, person, true)).status).toBe(403);
    expect(entry()!.owner_user_id).toBe(claude!.userId);
  });

  it("keeps the AI account that made each earlier version when the Gallery starts", () => {
    const state = sqliteState();
    new GalleryDO(state);
    const sql = state.storage.sql;
    const [claude, , sol] = AI_SEATS;
    const at = "2026-10-08T00:00:00.000Z";
    sql.exec(
      `INSERT INTO gallery_entries
       (id, name, author, description, created_at, schema_version, status,
        owner_user_id, project_text, svg_text)
       VALUES ('taken', 'taken', ?, '', ?, ?, 'public', ?, ?, '<svg/>')`,
      claude!.displayName,
      at,
      CURRENT_PROJECT_FILE_VERSION,
      claude!.userId,
      projectText("taken"),
    );
    for (const [id, author] of [
      ["v1", sol!.displayName],
      ["v2", claude!.formerName!],
    ])
      sql.exec(
        `INSERT INTO gallery_entry_versions
         (id, entry_id, version_no, name, author, description,
          schema_version, project_text, svg_text, created_at)
         VALUES (?, 'taken', ?, 'taken', ?, '', ?, ?, '<svg/>', ?)`,
        id,
        id === "v1" ? 1 : 2,
        author,
        CURRENT_PROJECT_FILE_VERSION,
        projectText("taken"),
        at,
      );
    new GalleryDO(state);
    expect(
      sql
        .exec<{ id: string; author: string }>(
          "SELECT id, author FROM gallery_entry_versions ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      // Another AI account's version keeps its name; this account's former
      // byline still becomes its listed name.
      { id: "v1", author: sol!.displayName },
      { id: "v2", author: claude!.displayName },
    ]);
  });
});

describe("gallery contributor renames", () => {
  it("moves every current and historical byline by owner id", async () => {
    const env = environment();
    for (const [id, status, ownerUserId] of [
      ["owned-public", "public", "owner-1"],
      ["owned-recycled", "recycled", "owner-1"],
      ["same-name-other-owner", "public", "owner-2"],
    ] as const) {
      env.gallerySql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          owner_user_id, project_text, svg_text)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, '<svg/>')`,
        id,
        id,
        "Old Public Name",
        "2026-09-19T00:00:00.000Z",
        CURRENT_PROJECT_FILE_VERSION,
        status,
        ownerUserId,
        projectText(id),
      );
      env.gallerySql.exec(
        `INSERT INTO gallery_entry_versions
         (id, entry_id, version_no, name, author, description, schema_version,
          project_text, svg_text, created_at)
         VALUES (?, ?, 1, ?, ?, '', ?, ?, '<svg/>', ?)`,
        `${id}-version`,
        id,
        id,
        "Old Public Name",
        CURRENT_PROJECT_FILE_VERSION,
        projectText(id),
        "2026-09-19T00:00:00.000Z",
      );
    }

    const response = await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/rename-owner",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerUserId: "owner-1",
          displayName: "Current Public Name",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ownerUserId: "owner-1",
      displayName: "Current Public Name",
      entries: 2,
      versions: 2,
    });
    expect(
      env.gallerySql
        .exec<{ id: string; author: string }>(
          "SELECT id, author FROM gallery_entries ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      { id: "owned-public", author: "Current Public Name" },
      { id: "owned-recycled", author: "Current Public Name" },
      { id: "same-name-other-owner", author: "Old Public Name" },
    ]);
    expect(
      env.gallerySql
        .exec<{ entry_id: string; author: string }>(
          `SELECT entry_id, author FROM gallery_entry_versions
           ORDER BY entry_id`,
        )
        .toArray(),
    ).toEqual([
      { entry_id: "owned-public", author: "Current Public Name" },
      { entry_id: "owned-recycled", author: "Current Public Name" },
      { entry_id: "same-name-other-owner", author: "Old Public Name" },
    ]);
  });

  it("restores historical content without restoring its stale byline", async () => {
    const env = environment();
    env.gallerySql.exec(
      `INSERT INTO gallery_entries
       (id, name, author, description, created_at, schema_version, status,
        owner_user_id, project_text, svg_text)
       VALUES (?, ?, ?, '', ?, ?, 'public', ?, ?, '<svg/>')`,
      "restore-current-byline",
      "Current",
      "Current Public Name",
      "2026-09-19T00:00:00.000Z",
      CURRENT_PROJECT_FILE_VERSION,
      "owner-1",
      projectText("Current"),
    );
    env.gallerySql.exec(
      `INSERT INTO gallery_entry_versions
       (id, entry_id, version_no, name, author, description, schema_version,
        project_text, svg_text, created_at)
       VALUES (?, ?, 1, ?, ?, '', ?, ?, '<svg/>', ?)`,
      "stale-byline-version",
      "restore-current-byline",
      "Historical Content",
      "Old Public Name",
      CURRENT_PROJECT_FILE_VERSION,
      projectText("Historical Content"),
      "2026-09-18T00:00:00.000Z",
    );

    const response = await env.GALLERY.getByName("gallery").fetch(
      "https://gallery/restore-version",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryId: "restore-current-byline",
          versionId: "stale-byline-version",
          at: "2026-09-19T01:00:00.000Z",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(
      env.gallerySql
        .exec<{ name: string; author: string }>(
          `SELECT name, author FROM gallery_entries
           WHERE id = 'restore-current-byline'`,
        )
        .one(),
    ).toEqual({
      name: "Historical Content",
      author: "Current Public Name",
    });
  });
});
