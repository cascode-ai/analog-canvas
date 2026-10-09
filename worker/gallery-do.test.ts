// The Gallery store's one-time data migrations as the Durable Object starts.

import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import { GalleryDO } from "./gallery";
import { AI_SEATS } from "./auth";
import {
  pagedStoreBackup,
  projectText,
  sqliteState,
} from "./gallery.test-support";

describe("gallery data migrations", () => {
  it("backfills intrinsic preview dimensions for existing entries once", () => {
    const state = sqliteState();
    new GalleryDO(state);
    state.storage.sql.exec(
      `INSERT INTO gallery_entries
       (id, name, author, description, created_at, schema_version, status,
        project_text, svg_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "legacy-preview",
      "Legacy preview",
      "Author",
      "",
      "2026-08-01T00:00:00.000Z",
      CURRENT_PROJECT_FILE_VERSION,
      "public",
      projectText("Legacy preview"),
      '<svg viewBox="-10 -20 320 180"></svg>',
    );
    state.storage.sql.exec(
      "DELETE FROM data_migrations WHERE id LIKE '%preview-dimensions%'",
    );

    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ preview_width: number; preview_height: number }>(
          `SELECT preview_width, preview_height FROM gallery_entries
           WHERE id = 'legacy-preview'`,
        )
        .one(),
    ).toEqual({ preview_width: 320, preview_height: 180 });
  });

  it("renames tokenzhang across entries and restorable versions once", () => {
    const state = sqliteState();
    new GalleryDO(state);
    state.storage.sql.exec(
      `INSERT INTO gallery_entries
       (id, name, author, description, created_at, schema_version, status,
        project_text, svg_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "legacy-entry",
      "Legacy",
      "tokenzhang",
      "",
      "2026-08-01T00:00:00.000Z",
      CURRENT_PROJECT_FILE_VERSION,
      "public",
      projectText("Legacy"),
      "<svg/>",
      "other-entry",
      "Other",
      "Other Author",
      "",
      "2026-08-01T00:00:00.000Z",
      CURRENT_PROJECT_FILE_VERSION,
      "recycled",
      projectText("Other"),
      "<svg/>",
    );
    state.storage.sql.exec(
      `INSERT INTO gallery_entry_versions
       (id, entry_id, version_no, name, author, description, schema_version,
        project_text, svg_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "legacy-version",
      "legacy-entry",
      1,
      "Legacy",
      "Token Zhang",
      "",
      CURRENT_PROJECT_FILE_VERSION,
      projectText("Legacy"),
      "<svg/>",
      "2026-08-01T00:00:00.000Z",
    );
    state.storage.sql.exec("DELETE FROM data_migrations");

    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ id: string; author: string }>(
          "SELECT id, author FROM gallery_entries ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      { id: "legacy-entry", author: "Zhishuai Zhang" },
      { id: "other-entry", author: "Other Author" },
    ]);
    expect(
      state.storage.sql
        .exec<{ author: string }>(
          "SELECT author FROM gallery_entry_versions WHERE id = 'legacy-version'",
        )
        .one().author,
    ).toBe("Zhishuai Zhang");

    state.storage.sql.exec(
      "UPDATE gallery_entries SET author = 'Token Zhang' WHERE id = 'legacy-entry'",
    );
    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ author: string }>(
          "SELECT author FROM gallery_entries WHERE id = 'legacy-entry'",
        )
        .one().author,
    ).toBe("Token Zhang");
  });

  it("renames the Magic Li byline across entries and restorable versions once", () => {
    const state = sqliteState();
    new GalleryDO(state);
    state.storage.sql.exec(
      `INSERT INTO gallery_entries
       (id, name, author, description, created_at, schema_version, status,
        project_text, svg_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "magic-li-entry",
      "Magic Li circuit",
      " 3187863239-NETIZEN ",
      "",
      "2026-09-19T00:00:00.000Z",
      CURRENT_PROJECT_FILE_VERSION,
      "public",
      projectText("Magic Li circuit"),
      "<svg/>",
      "unrelated-entry",
      "Unrelated",
      "Another Contributor",
      "",
      "2026-09-19T00:00:00.000Z",
      CURRENT_PROJECT_FILE_VERSION,
      "recycled",
      projectText("Unrelated"),
      "<svg/>",
    );
    state.storage.sql.exec(
      `INSERT INTO gallery_entry_versions
       (id, entry_id, version_no, name, author, description, schema_version,
        project_text, svg_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "magic-li-version",
      "magic-li-entry",
      1,
      "Magic Li circuit",
      "3187863239-netizen",
      "",
      CURRENT_PROJECT_FILE_VERSION,
      projectText("Magic Li circuit"),
      "<svg/>",
      "2026-09-19T00:00:00.000Z",
    );
    state.storage.sql.exec(
      "DELETE FROM data_migrations WHERE id LIKE '%magic-li%'",
    );

    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ id: string; author: string }>(
          "SELECT id, author FROM gallery_entries ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      { id: "magic-li-entry", author: "Magic Li" },
      { id: "unrelated-entry", author: "Another Contributor" },
    ]);
    expect(
      state.storage.sql
        .exec<{ author: string }>(
          "SELECT author FROM gallery_entry_versions WHERE id = 'magic-li-version'",
        )
        .one().author,
    ).toBe("Magic Li");

    state.storage.sql.exec(
      "UPDATE gallery_entries SET author = '3187863239-netizen' WHERE id = 'magic-li-entry'",
    );
    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ author: string }>(
          "SELECT author FROM gallery_entries WHERE id = 'magic-li-entry'",
        )
        .one().author,
    ).toBe("3187863239-netizen");
  });

  it("moves GPT-6 Astra's circuits after its 25th to GPT-6.1 Sol, once and after a restore", async () => {
    const state = sqliteState();
    const gallery = new GalleryDO(state);
    const [astra, sol] = ["ai-designer-2", "ai-designer-3"].map((seat) =>
      AI_SEATS.find((item) => item.seat === seat)!,
    );
    const sql = state.storage.sql;
    const insert = (
      id: string,
      owner: string,
      author: string,
      createdAt: string,
      status = "public",
    ) =>
      sql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          owner_user_id, project_text, svg_text, ai_generated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        id,
        id,
        author,
        "",
        createdAt,
        CURRENT_PROJECT_FILE_VERSION,
        status,
        owner,
        projectText(id),
        "<svg/>",
      );
    const version = (entryId: string) =>
      sql.exec(
        `INSERT INTO gallery_entry_versions
         (id, entry_id, version_no, name, author, description, schema_version,
          project_text, svg_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `${entryId}-v1`,
        entryId,
        1,
        entryId,
        "GPT-6 Astra",
        "",
        CURRENT_PROJECT_FILE_VERSION,
        projectText(entryId),
        "<svg/>",
        "2026-10-07T21:00:00.000Z",
      );
    const draft = (id: string, entryId: string | null) =>
      sql.exec(
        `INSERT INTO cloud_projects
         (id, user_id, name, created_at, updated_at, schema_version,
          project_text, gallery_entry_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        astra!.userId,
        id,
        "2026-10-07T21:00:00.000Z",
        "2026-10-07T21:00:00.000Z",
        CURRENT_PROJECT_FILE_VERSION,
        projectText(id),
        entryId,
      );
    // GPT-6 Astra's 25th circuit, the 26th, a later withdrawn one, another
    // account's from the same evening, saved versions, and GPT-6 Astra's
    // Cloud Projects behind the 25th, the 26th and nothing.
    insert(
      "astra-25th",
      astra!.userId,
      "GPT-6 Astra",
      "2026-10-07T21:37:12.000Z",
    );
    insert(
      "sol-26th",
      astra!.userId,
      "GPT-6 Astra",
      "2026-10-07T22:05:40.000Z",
    );
    insert(
      "sol-withdrawn",
      astra!.userId,
      "GPT-6 Astra",
      "2026-10-08T09:44:00.000Z",
      "recycled",
    );
    insert("someone-else", "member-1", "Member", "2026-10-07T23:00:00.000Z");
    version("astra-25th");
    version("sol-26th");
    draft("draft-25th", "astra-25th");
    draft("draft-26th", "sol-26th");
    draft("draft-loose", null);
    const maintenance = async (action: string, body: unknown) =>
      (
        await gallery.fetch(
          new Request(`https://gallery/${action}`, {
            method: "POST",
            body: JSON.stringify(body),
          }),
        )
      ).json();
    const before = await pagedStoreBackup((query) =>
      maintenance("schema-backup", query),
    );
    sql.exec("DELETE FROM data_migrations WHERE id LIKE '%gpt-6-1-sol%'");

    const moved = () => ({
      entries: sql
        .exec<{
          id: string;
          owner_user_id: string;
          author: string;
          ai_generated: number;
        }>(
          "SELECT id, owner_user_id, author, ai_generated FROM gallery_entries ORDER BY id",
        )
        .toArray(),
      versions: sql
        .exec<{ id: string; author: string }>(
          "SELECT id, author FROM gallery_entry_versions ORDER BY id",
        )
        .toArray(),
      drafts: sql
        .exec<{ id: string; user_id: string }>(
          "SELECT id, user_id FROM cloud_projects ORDER BY id",
        )
        .toArray(),
    });
    const expected = {
      entries: [
        {
          id: "astra-25th",
          owner_user_id: astra!.userId,
          author: "GPT-6 Astra",
          ai_generated: 1,
        },
        {
          id: "sol-26th",
          owner_user_id: sol!.userId,
          author: "GPT-6.1 Sol",
          ai_generated: 1,
        },
        {
          id: "sol-withdrawn",
          owner_user_id: sol!.userId,
          author: "GPT-6.1 Sol",
          ai_generated: 1,
        },
        {
          id: "someone-else",
          owner_user_id: "member-1",
          author: "Member",
          ai_generated: 0,
        },
      ],
      versions: [
        { id: "astra-25th-v1", author: "GPT-6 Astra" },
        { id: "sol-26th-v1", author: "GPT-6.1 Sol" },
      ],
      drafts: [
        { id: "draft-25th", user_id: astra!.userId },
        { id: "draft-26th", user_id: sol!.userId },
        { id: "draft-loose", user_id: astra!.userId },
      ],
    };
    const migrated = new GalleryDO(state);
    expect(moved()).toEqual(expected);

    // A backup from before the move, restored, moves again.
    await (
      await migrated.fetch(
        new Request("https://gallery/schema-restore", {
          method: "POST",
          body: JSON.stringify({ backup: before }),
        }),
      )
    ).json();
    expect(moved()).toEqual(expected);

    // Once: what GPT-6 Astra publishes after the move stays its own.
    insert(
      "astra-later",
      astra!.userId,
      "GPT-6 Astra",
      "2099-01-01T00:00:00.000Z",
    );
    new GalleryDO(state);
    expect(
      moved().entries.find((row) => row.id === "astra-later"),
    ).toMatchObject({ owner_user_id: astra!.userId, author: "GPT-6 Astra" });
  });

  it("migrates histories to three versions and removes orphaned data", () => {
    const state = sqliteState();
    new GalleryDO(state);
    for (const entryId of ["entry-a", "entry-b"]) {
      state.storage.sql.exec(
        `INSERT INTO gallery_entries
         (id, name, author, description, created_at, schema_version, status,
          project_text, svg_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entryId,
        entryId,
        "Author",
        "",
        "2026-08-01T00:00:00.000Z",
        CURRENT_PROJECT_FILE_VERSION,
        "public",
        projectText(entryId),
        "<svg/>",
      );
    }
    for (const [entryId, versionNo] of [
      ["entry-a", 1],
      ["entry-a", 2],
      ["entry-a", 3],
      ["entry-a", 4],
      ["entry-b", 1],
      ["entry-b", 2],
      ["entry-b", 3],
      ["missing-entry", 1],
    ] as const) {
      state.storage.sql.exec(
        `INSERT INTO gallery_entry_versions
         (id, entry_id, version_no, name, author, description,
          schema_version, project_text, svg_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `${entryId}-${versionNo}`,
        entryId,
        versionNo,
        `${entryId} v${versionNo}`,
        "Author",
        "",
        CURRENT_PROJECT_FILE_VERSION,
        projectText(`${entryId} v${versionNo}`),
        "<svg/>",
        `2026-08-${String(versionNo).padStart(2, "0")}T00:00:00.000Z`,
      );
    }
    state.storage.sql.exec(
      `INSERT INTO gallery_likes(entry_id, user_id, liked_at)
       VALUES ('missing-entry', 'legacy-user', '2026-08-01T00:00:00.000Z')`,
    );
    state.storage.sql.exec("DELETE FROM data_migrations");

    new GalleryDO(state);
    expect(
      state.storage.sql
        .exec<{ entry_id: string; version_no: number }>(
          `SELECT entry_id, version_no FROM gallery_entry_versions
           ORDER BY entry_id, version_no DESC`,
        )
        .toArray(),
    ).toEqual([
      { entry_id: "entry-a", version_no: 4 },
      { entry_id: "entry-a", version_no: 3 },
      { entry_id: "entry-a", version_no: 2 },
      { entry_id: "entry-b", version_no: 3 },
      { entry_id: "entry-b", version_no: 2 },
      { entry_id: "entry-b", version_no: 1 },
    ]);
    expect(
      state.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM gallery_likes")
        .one().count,
    ).toBe(0);
  });
});
