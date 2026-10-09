// The Shelf: publication journeys from a draft, and Shelf cards that
// duplicate, rename, export and keep account favourites.

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createEmptyProject } from "@icm/model";
import {
  serializeProject,
  parseProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "@icm/project-protocol";
import {
  awaitEditorReady,
  chooseComponent,
  openMenu,
} from "./editor-fixtures.js";
import { mockGallery } from "./gallery-fixtures.js";

for (const scenario of [
  "reopen and metadata",
  "source replacement",
  "publish before Save",
] as const) {
  test(`Shelf publication: ${scenario}`, async ({ page }) => {
    // Independent user journeys avoid accumulating reload time into one timeout.
    // They share the mock service contract, not browser or saved-draft state.
    test.setTimeout(60_000);
    const user = {
      id: "shelf-owner",
      displayName: "Author",
      email: "author@example.test",
      provider: "github",
      role: "user",
      isAdmin: false,
    };
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({ json: { user } }),
    );
    await mockGallery(page, []);
    type Saved = {
      id: string;
      name: string;
      updatedAt: string;
      revision: number;
      schemaVersion: number;
      projectText: string;
      galleryEntryId: string | null;
    };
    const drafts = new Map<string, Saved>();
    const publications = new Map<
      string,
      { name: string; projectText: string; description: string; tags: string[] }
    >();
    const requests: { method: string; id: string; body: any }[] = [];
    let failDetail = false;
    await page.route(/\/api\/projects(?:\/[^/?]+)?$/, async (route) => {
      const request = route.request();
      const id = new URL(request.url()).pathname.split("/")[3];
      if (request.method() === "GET")
        return route.fulfill({
          json: id
            ? { project: drafts.get(id) }
            : { projects: [...drafts.values()] },
        });
      const body = request.postDataJSON();
      const previous = id ? drafts.get(id) : null;
      const saved: Saved = {
        ...body,
        id: id ?? `draft-${drafts.size + 1}`,
        updatedAt: new Date().toISOString(),
        revision: (previous?.revision ?? 0) + 1,
        schemaVersion: CURRENT_PROJECT_FILE_VERSION,
        galleryEntryId: previous?.galleryEntryId ?? body.galleryEntryId ?? null,
      };
      drafts.set(saved.id, saved);
      return route.fulfill({
        status: previous ? 200 : 201,
        json: { project: saved },
      });
    });
    await page.route(
      /\/api\/gallery\/(?:submissions|published-\d+)(?:\?summary=1)?$/,
      async (route) => {
        const req = route.request();
        let id = new URL(req.url()).pathname.split("/")[3]!;
        if (req.method() === "GET") {
          if (failDetail)
            return route.fulfill({
              status: 503,
              json: { error: "unreachable" },
            });
          const stored = publications.get(id)!;
          return route.fulfill({
            json: {
              entry: { id, ...stored, author: "Author" },
              ownerUserId: user.id,
              projectText: stored.projectText,
            },
          });
        }
        const body = req.postDataJSON();
        if (id === "submissions") id = `published-${publications.size + 1}`;
        requests.push({ method: req.method(), id, body });
        publications.set(id, body);
        if (body.cloudProjectId) {
          const draft = drafts.get(body.cloudProjectId)!;
          expect(body.expectedGalleryEntryId).toBe(draft.galleryEntryId);
          for (const other of drafts.values())
            if (other.id !== draft.id && other.galleryEntryId === id)
              other.galleryEntryId = null;
          draft.galleryEntryId = id;
        }
        return route.fulfill({
          status: req.method() === "POST" ? 201 : 200,
          json: { id },
        });
      },
    );
    const save = async () => {
      await (
        await openMenu(page, "File")
      )
        .getByRole("button", { name: "Save", exact: true })
        .click();
      await expect(page.getByTestId("status")).toContainText("Saved");
    };
    const publishDialog = async () => {
      await page.getByTestId("publish-gallery-button").click();
      const dialog = page.getByTestId("publish-gallery-dialog");
      await expect(dialog).toBeVisible();
      return dialog;
    };
    if (scenario === "publish before Save") {
      let dialog;
      // First publication can also precede the first private Save.
      await page.goto("/editor?new=1");
      await awaitEditorReady(page);
      dialog = await publishDialog();
      await dialog.getByLabel("Circuit name").fill("Publish before Save");
      await dialog
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await save();
      expect(drafts.get("draft-1")!.galleryEntryId).toBe("published-1");
      await page.goto("/editor?project=draft-1");
      await awaitEditorReady(page);
      dialog = await publishDialog();
      await expect(
        dialog.getByRole("button", { name: "Update entry" }),
      ).toBeEnabled();
      await expect(dialog.getByLabel("Circuit name")).toHaveValue(
        "Publish before Save",
      );
      await page.screenshot({ path: "plan/shelf-publication-local.png" });
      return;
    }
    if (scenario === "reopen and metadata") {
      await page.goto("/editor?new=1");
      await awaitEditorReady(page);
      await chooseComponent(page, "resistor");
      await page
        .getByTestId("schematic-canvas")
        .click({ position: { x: 340, y: 230 } });
      await page.keyboard.press("Escape");
      await save();
      const originalPrivateText = drafts.get("draft-1")!.projectText;
      let dialog = await publishDialog();
      await dialog.getByLabel("Circuit name").fill("Public title");
      await dialog
        .getByLabel("Description", { exact: true })
        .fill("Original description");
      await dialog.getByLabel("Add tag").fill("resistor");
      await dialog.getByLabel("Add tag").press("Enter");
      await dialog
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      expect(drafts.get("draft-1")!.galleryEntryId).toBe("published-1");
      expect(drafts.get("draft-1")!.projectText).toBe(originalPrivateText);
      await page.goto("/editor?project=draft-1");
      await awaitEditorReady(page);
      await expect(page.getByTestId("status")).toContainText(
        "Opened Cloud Project",
      );
      await chooseComponent(page, "capacitor");
      await page
        .getByTestId("schematic-canvas")
        .click({ position: { x: 410, y: 260 } });
      await page.keyboard.press("Escape");
      dialog = await publishDialog();
      await expect(
        dialog.getByRole("button", { name: "Update entry" }),
      ).toBeEnabled();
      await dialog.getByRole("button", { name: "Update entry" }).click();
      await expect(dialog).toHaveCount(0);
      expect(requests).toHaveLength(2);
      expect(requests[1]!.method).toBe("PUT");
      expect(
        parseProject(requests[1]!.body.projectText).documents[0]!.instances,
      ).toHaveLength(2);
      expect(drafts.get("draft-1")!.projectText).toBe(originalPrivateText);
      await save();
      // A transient metadata failure must not turn Update into an accidental new publication.
      failDetail = true;
      await page.goto("/editor?project=draft-1");
      await awaitEditorReady(page);
      dialog = await publishDialog();
      await expect(dialog.getByRole("alert")).toContainText("Retry");
      await expect(
        dialog.getByRole("button", { name: "Publish", exact: true }),
      ).toBeDisabled();
      failDetail = false;
      await dialog.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        dialog.getByRole("button", { name: "Update entry" }),
      ).toBeEnabled();
      // Target changes follow that publication's metadata, even after reopening
      // the dialog, while deliberate edits (including empty fields) remain intact.
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      dialog = await publishDialog();
      publications.set("published-999", {
        name: "Another publication",
        projectText: originalPrivateText,
        description: "Another description",
        tags: ["capacitor"],
      });
      await dialog
        .getByText("Use an existing Gallery publication…", { exact: true })
        .click();
      const choosePublication = async (id: string) => {
        await dialog.getByLabel("Existing Gallery link").fill(id);
        await dialog
          .getByRole("button", { name: "Use this publication", exact: true })
          .click();
        await expect(
          dialog.getByRole("radio", { name: /^Update /u }),
        ).toBeChecked();
      };
      await choosePublication("published-999");
      await expect(dialog.getByLabel("Circuit name")).toHaveValue(
        "Another publication",
      );
      await expect(
        dialog.getByLabel("Description", { exact: true }),
      ).toHaveValue("Another description");
      await expect(dialog.getByTestId("publish-tag-capacitor")).toBeVisible();
      await expect(dialog.getByTestId("publish-tag-resistor")).toHaveCount(0);
      await dialog.getByLabel("Description", { exact: true }).fill("");
      await dialog.getByTestId("publish-tag-capacitor").click();
      await choosePublication("published-1");
      await expect(dialog.getByLabel("Circuit name")).toHaveValue(
        "Public title",
      );
      await expect(
        dialog.getByLabel("Description", { exact: true }),
      ).toHaveValue("");
      await expect(dialog.locator(".publish-gallery-tag-chips")).toHaveCount(0);
      expect(drafts.get("draft-1")!.galleryEntryId).toBe("published-1");
      publications.delete("published-999");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      return;
    }
    const original = createEmptyProject("original", "Original draft");
    original.documents[0]!.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
      netlist: { parameters: { value: "1k" } },
    });
    const originalPrivateText = serializeProject(original);
    drafts.set("draft-1", {
      id: "draft-1",
      name: original.name,
      updatedAt: new Date().toISOString(),
      revision: 1,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      projectText: originalPrivateText,
      galleryEntryId: "published-1",
    });
    publications.set("published-1", {
      name: "Public title",
      projectText: originalPrivateText,
      description: "Original description",
      tags: ["resistor"],
    });
    let dialog;
    // A different saved draft deliberately takes over the existing public address.
    const replacement = createEmptyProject("replacement", "Replacement draft");
    drafts.set("draft-2", {
      id: "draft-2",
      name: replacement.name,
      updatedAt: new Date().toISOString(),
      revision: 1,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
      projectText: serializeProject(replacement),
      galleryEntryId: null,
    });
    const oldDraft = drafts.get("draft-1")!.projectText;
    await page.goto("/editor?project=draft-2");
    await awaitEditorReady(page);
    dialog = await publishDialog();
    await dialog
      .getByText("Use an existing Gallery publication…", { exact: true })
      .click();
    await dialog
      .getByLabel("Existing Gallery link")
      .fill("https://analog-canvas.tokenzhang.com/g/published-1");
    await page.screenshot({ path: "plan/shelf-change-source-local.png" });
    await dialog
      .getByRole("button", { name: "Use this publication", exact: true })
      .click();
    await expect(
      dialog.getByRole("radio", { name: /^Update /u }),
    ).toBeChecked();
    await dialog.getByRole("button", { name: "Update entry" }).click();
    await expect(dialog).toHaveCount(0);
    expect(drafts.get("draft-1")!.projectText).toBe(oldDraft);
    expect(drafts.get("draft-1")!.galleryEntryId).toBeNull();
    expect(drafts.get("draft-2")!.galleryEntryId).toBe("published-1");
    expect(publications.size).toBe(1);
    await page.goto("/editor?project=draft-2");
    await awaitEditorReady(page);
    dialog = await publishDialog();
    await expect(
      dialog.getByRole("button", { name: "Update entry" }),
    ).toBeEnabled();
    await dialog
      .getByRole("radio", { name: "Publish as a new entry", exact: true })
      .check();
    await dialog.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(publications.size).toBe(2);
    expect(drafts.get("draft-2")!.galleryEntryId).toBe("published-2");
  });
}

test("Shelf cards duplicate, rename, export and keep account favorites without entering the canvas", async ({
  page,
}) => {
  const source = parseProject(
    serializeProject(
      parseProject(
        readFileSync(
          new URL(
            "../src/examples/five-transistor-ota-sky130.icproj.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    ),
  );
  type Saved = {
    id: string;
    name: string;
    revision: number;
    updatedAt: string;
    schemaVersion: number;
    projectText: string;
    galleryEntryId: string | null;
    favorite: boolean;
  };
  const original: Saved = {
    id: "original",
    name: source.name,
    revision: 2,
    updatedAt: "2026-09-21T08:00:00Z",
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    projectText: serializeProject(source),
    galleryEntryId: "public-original",
    favorite: false,
  };
  const saved = new Map<string, Saved>([[original.id, original]]);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "owner",
          displayName: "Author",
          isAdmin: false,
          role: "user",
        },
      },
    }),
  );
  await page.route("**/api/gallery**", (route) =>
    route.fulfill({
      json: { entries: [], tags: [], nextCursor: null, total: 0 },
    }),
  );
  await page.route("**/api/projects**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"><path d="M20 60H90L95 50L105 70L115 50L125 70L130 60H220" fill="none" stroke="black" stroke-width="2"/></svg>',
      });
    const id = url.pathname.split("/")[3];
    if (req.method() === "GET")
      return route.fulfill({
        json: id
          ? { project: saved.get(id) }
          : { projects: [...saved.values()] },
      });
    if (req.method() === "DELETE") {
      saved.delete(id!);
      return route.fulfill({ json: { deleted: true } });
    }
    const fields = req.postDataJSON();
    if (req.method() === "PATCH") {
      saved.get(id!)!.favorite = fields.favorite;
      return route.fulfill({ json: { project: saved.get(id!) } });
    }
    if (req.method() === "POST") {
      expect(fields.galleryEntryId).toBeUndefined();
      const copy = {
        ...original,
        ...fields,
        id: "copy",
        revision: 1,
        galleryEntryId: null,
        favorite: false,
      };
      saved.set(copy.id, copy);
      return route.fulfill({ status: 201, json: { project: copy } });
    }
    expect(req.method()).toBe("PUT");
    const previous = saved.get(id!)!;
    expect(req.headers()["if-match"]).toBe(`revision-${previous.revision}`);
    const updated = { ...previous, ...fields, revision: previous.revision + 1 };
    saved.set(id!, updated);
    return route.fulfill({ json: { project: updated } });
  });
  await page.goto("/?view=shelf");
  const tile = page.getByTestId("shelf-tile-original");
  await expect(tile).toBeVisible();
  const actions = page.getByTestId("shelf-actions-original");
  await expect(actions).toBeVisible();
  await tile.click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // The card no longer cancels the browser's context-menu event.
  expect(
    await tile.evaluate((element) =>
      element.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    ),
  ).toBe(true);
  await actions.click();
  await expect(actions).toHaveAttribute("aria-expanded", "true");
  await actions.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(actions).toHaveAttribute("aria-expanded", "false");
  await actions.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await actions.click();
  await expect(
    page.getByRole("menuitem", { name: "Open in new tab" }),
  ).toHaveAttribute("target", "_blank");
  await page.getByRole("menuitem", { name: "Duplicate", exact: true }).click();
  await expect(page.getByTestId("shelf-tile-copy")).toBeVisible();
  const duplicate = parseProject(saved.get("copy")!.projectText);
  expect(duplicate.id).not.toBe(source.id);
  expect({ ...duplicate, id: source.id, name: source.name }).toEqual(source);
  await page.getByTestId("shelf-actions-copy").click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await expect(page.locator(".shelf-rename-form")).toHaveAttribute(
    "autocomplete",
    "off",
  );
  await expect(
    page.getByRole("textbox", { name: "Project name", exact: true }),
  ).toHaveAttribute("autocomplete", "off");
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("Experiment B");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.getByTestId("shelf-tile-copy")).toContainText(
    "Experiment B",
  );
  await page.getByTestId("shelf-actions-copy").click();
  await page.getByRole("menuitem", { name: "Favorite", exact: true }).click();
  await expect(
    page.getByTestId("shelf-tile-copy").getByLabel("Favorite"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByTestId("shelf-tile-copy").getByLabel("Favorite"),
  ).toBeVisible();
  await page.getByTestId("shelf-actions-copy").click();
  await page.screenshot({ path: "plan/shelf-card-actions.png" });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Experiment B.icproj.json");
  expect(readFileSync((await download.path())!, "utf8")).toBe(
    saved.get("copy")!.projectText,
  );
  expect(saved.get("original")).toEqual(original);
  // Holding a card on touch also leaves native browser gestures alone.
  await tile.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: 120,
    clientY: 220,
  });
  await page.waitForTimeout(600);
  await tile.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page).toHaveURL(/view=shelf/);
  await page.setViewportSize({ width: 360, height: 600 });
  await page.getByTestId("shelf-actions-copy").click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("VeryLongCircuitName".repeat(6));
  expect(
    await page
      .locator(".shelf-rename-form")
      .evaluate((form) => form.scrollWidth <= form.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "plan/inline-shelf-rename-narrow.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shelf-actions-copy")).toBeFocused();
  expect(saved.get("copy")!.name).toBe("Experiment B");
  await page.getByTestId("shelf-delete-copy").click();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(page.getByTestId("shelf-delete-copy")).toBeFocused();
  expect(saved.has("copy")).toBe(true);
  await page.getByTestId("shelf-delete-copy").click();
  await page.screenshot({ path: "plan/inline-shelf-delete-narrow.png" });
  await page
    .getByRole("button", { name: "Really delete", exact: true })
    .click();
  await expect(page.getByTestId("shelf-tile-copy")).toHaveCount(0);
  expect(saved.has("copy")).toBe(false);
});
