// Publishing to the Gallery: the publish dialog, its tag suggestions, a
// published tab's saved state and updating an entry in place; the Shelf's
// publication journeys and its cards. Quality gates, the sign-in prompt and a
// reopened draft are the publish-gallery-dialog module tests.

import { expect, test } from "./gallery-test.js";
import { test as localTest } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import {
  serializeProject,
  parseProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "@icm/project-protocol";
import { hierarchicalSymbolId } from "@icm/symbols";
import {
  clickCommand,
  expectStatus,
  openProjectFile,
  placeComponentAt,
  placeResistors,
  openEditor,
  exampleProject,
  renameShelfProject,
} from "./editor-fixtures.js";
import {
  ENTRY,
  fulfillPreview,
  mockGallery,
  sessionUser,
  signIn,
} from "./gallery-fixtures.js";
import { placedInstance } from "./canvas-fixtures.js";

/** Open the publish dialog and wait for it. */
async function openPublishDialog(page: Page): Promise<Locator> {
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

function hierarchicalPublishProject() {
  const project = createEmptyProject("hierarchical-publish", "Hierarchical");
  const top = project.documents[0]!;
  const child = createEmptyDocument("document-child", "scdac_unit");
  const placed = (id: string, x: number, y: number) => ({
    ...placedInstance(id, "resistor", x, y),
    reference: id,
    netlist: { parameters: {} },
  });
  top.instances = [
    placed("R1", 0, 0),
    placed("R2", 200, 0),
    {
      ...placed("XU0", 100, 120),
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    },
  ];
  top.nets = ["1", "2"].map((pinName) => ({
    id: `n${pinName}`,
    terminals: ["R1", "R2"].map((instanceId) => ({ instanceId, pinName })),
  }));
  project.documents.push(child);
  return project;
}

test("a member publishes from a tab, which then counts as saved and updates its entry in place", async ({
  page,
}) => {
  await signIn(
    page,
    sessionUser({ displayName: "Token Zhang", email: "owner@example.com" }),
  );
  const posted: {
    authorization: string | null;
    hasAuthor: boolean;
    name: string;
    tags: string[];
    aiGenerated: boolean;
    schemaVersion: number;
  }[] = [];
  const updated: {
    name: string;
    aiGenerated: boolean;
    instanceCount: number;
  }[] = [];
  // The browser submits through /api/gallery/submissions/commit — the mock
  // matches it exactly so a client posting anywhere else fails this test.
  await page.route("**/api/gallery/submissions/commit", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as {
      author?: string;
      name: string;
      tags: string[];
      aiGenerated: boolean;
      projectText: string;
    };
    posted.push({
      authorization: route.request().headers()["authorization"] ?? null,
      hasAuthor: "author" in body,
      name: body.name,
      tags: body.tags,
      aiGenerated: body.aiGenerated,
      schemaVersion: (JSON.parse(body.projectText) as { schemaVersion: number })
        .schemaVersion,
    });
    return route.fulfill({ status: 201, json: { id: "entry-77" } });
  });
  await page.route("**/api/gallery/entry-77", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as {
      name: string;
      aiGenerated: boolean;
      projectText: string;
    };
    const project = JSON.parse(body.projectText) as {
      documents: { instances: unknown[] }[];
    };
    updated.push({
      name: body.name,
      aiGenerated: body.aiGenerated,
      instanceCount: project.documents[0]?.instances.length ?? 0,
    });
    return route.fulfill({ status: 200, json: { id: "entry-77" } });
  });

  await page.goto("/editor");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  const active = page.getByRole("tab", { selected: true });
  await placeResistors(page, [340]);
  await expect(active.getByLabel("Unsaved")).toBeVisible();
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();

  // The dialog's lazily loaded styles leave the editor's toolbar alone.
  const toolbar = page.locator(".toolbar-row").first();
  const toolbarStyle = () =>
    toolbar.evaluate((element) => {
      const { backgroundColor, borderTopColor, display } =
        getComputedStyle(element);
      return { backgroundColor, borderTopColor, display };
    });
  const toolbarBefore = await toolbarStyle();
  const dialog = await openPublishDialog(page);
  await expect.poll(toolbarStyle).toEqual(toolbarBefore);
  // One part trips the content check, live on the open Project: advice that
  // keeps Publish open, since the checker has false positives.
  const gates = dialog.getByTestId("publish-gallery-gates");
  await expect(gates).toContainText("publishing stays open");
  await expect(gates).toContainText("Too little content");
  await expect(dialog.getByText("Publishing as Token Zhang")).toBeVisible();
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  // The byline comes from the account, so there is no field to fill in.
  await expect(dialog.getByLabel("Author")).toHaveCount(0);

  await dialog.getByLabel("Circuit name").fill("Session Publish");
  // Five suggestions show; "+ …" opens the rest (#1385).
  const presets = dialog.locator('[data-testid^="publish-preset-"]');
  await expect(presets).toHaveCount(5);
  await dialog.getByTestId("publish-presets-more").click();
  await expect(dialog.getByTestId("publish-presets-more")).toHaveCount(0);
  await expect.poll(() => presets.count()).toBeGreaterThan(5);
  // A suggestion stays clickable while typing filters them, and takes the
  // typed text's place.
  const addTag = dialog.getByLabel("Add tag");
  await addTag.fill("amp");
  await dialog.getByTestId("publish-preset-amplifier").click();
  await expect(dialog.getByTestId("publish-tag-amplifier")).toBeVisible();
  await expect(dialog.getByTestId("publish-tag-amp")).toHaveCount(0);
  // A tag still being typed is published with the rest.
  await addTag.fill("custom label");
  // Drawn by hand, so the AI mark starts off; the publisher may still set it.
  await expect(dialog.getByLabel("AI-generated")).not.toBeChecked();
  await dialog.getByLabel("AI-generated").check();
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByTestId("status")).toHaveText(
    'Published "Session Publish" to the gallery',
  );
  // A publish says it landed where it cannot be missed, with the way there.
  const notice = page.getByTestId("gallery-published-notice");
  await expect(notice).toContainText(
    "Published “Session Publish” to the Gallery",
  );
  await expect(
    notice.getByRole("link", { name: "View in Gallery" }),
  ).toHaveAttribute("href", /^\/\?entry=[A-Za-z0-9-]+$/u);
  expect(posted).toEqual([
    {
      authorization: null,
      hasAuthor: false,
      name: "Session Publish",
      tags: ["amplifier", "custom label"],
      aiGenerated: true,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    },
  ]);
  // The Gallery holds exactly these bytes: nothing is unsaved.
  await expect(active.getByLabel("Unsaved")).toHaveCount(0);
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);

  // The live Project remains the source of this publication. After another
  // edit, Publish must update the item it just created rather than creating a
  // duplicate Gallery entry.
  await placeResistors(page, [460]);
  await expect(active.getByLabel("Unsaved")).toBeVisible();
  await page.getByTestId("publish-gallery-button").click();
  const mode = page.getByTestId("publish-mode");
  // The update option names exactly what it will replace, above the choice
  // of a new entry and the version history.
  await expect(mode).toContainText("Session Publish");
  await expect(dialog.getByText("updates the entry in place")).toBeVisible();
  const [updateBox, newBox, historyBox] = await Promise.all([
    mode
      .getByRole("radio", { name: /^Update /u })
      .locator("..")
      .boundingBox(),
    mode
      .getByRole("radio", { name: "Publish as a new entry", exact: true })
      .locator("..")
      .boundingBox(),
    page.getByTestId("publish-history").boundingBox(),
  ]);
  expect(newBox!.y).toBeGreaterThanOrEqual(updateBox!.y + updateBox!.height);
  expect(historyBox!.y).toBeGreaterThanOrEqual(newBox!.y + newBox!.height);
  // The update starts from the entry's own mark.
  await expect(dialog.getByLabel("AI-generated")).toBeChecked();
  await dialog.getByRole("button", { name: "Update entry" }).click();
  await expect(page.getByTestId("status")).toHaveText(
    'Updated "Session Publish" in the gallery',
  );
  await expect(page.getByTestId("gallery-published-notice")).toContainText(
    "Updated “Session Publish” in the Gallery",
  );
  expect(posted).toHaveLength(1);
  expect(updated).toEqual([
    { name: "Session Publish", aiGenerated: true, instanceCount: 2 },
  ]);
  await expect(active.getByLabel("Unsaved")).toHaveCount(0);

  // Closing it loses nothing, so it closes without asking.
  await active
    .locator("xpath=..")
    .getByRole("button", { name: /Close tab / })
    .click();
  await expect(page.getByTestId("project-tab-close-decision")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(1);
});

test("a mistaken click beside the publish form keeps what was written", async ({
  page,
}) => {
  await signIn(page, sessionUser({ displayName: "Token Zhang" }));
  await page.goto("/editor");
  const dialog = await openPublishDialog(page);
  await dialog.getByLabel("Circuit name").fill("Folded Cascode");
  await dialog
    .getByLabel("Description")
    .fill("Gain boosted, 1.2 V supply, trimmed offset.");

  // A stray press on the backdrop beside a form being written in is a miss,
  // not a decision to throw the writing away.
  const viewport = page.viewportSize()!;
  await page.mouse.click(8, viewport.height - 8);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Circuit name")).toHaveValue("Folded Cascode");
  // Cancelling closes it, and reopening comes back to the draft.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId("publish-gallery-button").click();
  await expect(dialog.getByLabel("Circuit name")).toHaveValue("Folded Cascode");
  await expect(dialog.getByLabel("Description")).toHaveValue(
    "Gain boosted, 1.2 V supply, trimmed offset.",
  );
});

localTest(
  "replacing the project retires the stale update offer and resolves the new one's Cells",
  async ({ page }) => {
    await mockGallery(page, [ENTRY]);
    await signIn(
      page,
      sessionUser({ displayName: "Token Zhang", isAdmin: true }),
    );

    await openEditor(page, `/g/${ENTRY.id}`);
    await expectStatus(page, `Opened gallery circuit: ${ENTRY.name}`);

    // Sanity: while the entry is the active Project, updating is offered.
    await page.getByTestId("publish-gallery-button").click();
    await expect(page.getByTestId("publish-mode")).toBeVisible();
    await page
      .getByTestId("publish-gallery-dialog")
      .getByRole("button", { name: "Cancel" })
      .click();

    // Import a different Project over it: the gallery entry is no longer
    // active, so publishing must NOT offer updating it any more.
    await openProjectFile(
      page,
      serializeProject(hierarchicalPublishProject()),
      "hierarchical-publish.icproj.json",
    );
    // The fixture may pass through the rolling schema upgrade; either status
    // still proves that this different Project replaced the gallery entry.
    await expectStatus(page, "hierarchical-publish.icproj.json");

    const dialog = await openPublishDialog(page);
    await expect(page.getByTestId("publish-mode")).toHaveCount(0);
    // Its internal Cell resolves from the open Project: no gate trips.
    await expect(dialog.getByTestId("publish-gallery-gates")).toHaveCount(0);
    await expect(dialog).not.toContainText("ERC_UNRESOLVED_SYMBOL");
    await expect(dialog.getByRole("button", { name: "Publish" })).toBeEnabled();
  },
);

for (const scenario of [
  "reopen and metadata",
  "publish before Save",
  "source replacement",
  "unrelated Shelf rename",
] as const) {
  test(`Shelf publication: ${scenario}`, async ({ page }) => {
    // Independent user journeys avoid accumulating reload time into one timeout.
    // They share the mock service contract, not browser or saved-draft state.
    test.setTimeout(60_000);
    const user = sessionUser({ id: "shelf-owner", displayName: "Author" });
    await signIn(page, user);
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
      /\/api\/gallery\/(?:submissions\/commit|published-\d+)(?:\?summary=1)?$/,
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
      await clickCommand(page, "File", "Save");
      await expectStatus(page, "Saved");
    };
    // Each step reopens the one publish dialog, so these find it every time.
    const dialog = page.getByTestId("publish-gallery-dialog");
    const publish = dialog.getByRole("button", {
      name: "Publish",
      exact: true,
    });
    const update = dialog.getByRole("button", { name: "Update entry" });
    const choosePublication = async (id: string) => {
      await dialog.getByLabel("Existing Gallery link").fill(id);
      await dialog
        .getByRole("button", { name: "Use this publication", exact: true })
        .click();
      await expect(
        dialog.getByRole("radio", { name: /^Update /u }),
      ).toBeChecked();
    };
    if (scenario === "publish before Save") {
      // A first publication before the first private Save is bound by that
      // Save, so the reopened draft offers its Update, not a new entry.
      await openEditor(page, "/editor?new=1");
      await openPublishDialog(page);
      await dialog.getByLabel("Circuit name").fill("Publish before Save");
      await publish.click();
      await expect(dialog).toHaveCount(0);
      await save();
      expect(drafts.get("draft-1")!.galleryEntryId).toBe("published-1");
      await openEditor(page, "/editor?project=draft-1");
      await openPublishDialog(page);
      await expect(update).toBeEnabled();
      return;
    }
    if (scenario === "reopen and metadata") {
      await openEditor(page, "/editor?new=1");
      await placeResistors(page, [340]);
      await save();
      const originalPrivateText = drafts.get("draft-1")!.projectText;
      await openPublishDialog(page);
      await dialog.getByLabel("Circuit name").fill("Public title");
      await dialog
        .getByLabel("Description", { exact: true })
        .fill("Original description");
      await dialog.getByLabel("Add tag").fill("resistor");
      await dialog.getByLabel("Add tag").press("Enter");
      await publish.click();
      await expect(dialog).toHaveCount(0);
      expect(drafts.get("draft-1")!.galleryEntryId).toBe("published-1");
      expect(drafts.get("draft-1")!.projectText).toBe(originalPrivateText);
      await openEditor(page, "/editor?project=draft-1");
      // A restored Cloud tab is selected without downloading it again. Assert
      // its actual circuit before editing, rather than the download's status.
      await expect(page.getByTestId("active-instance-count")).toHaveText("1");
      await placeComponentAt(page, "capacitor", { x: 410, y: 260 });
      await openPublishDialog(page);
      await expect(update).toBeEnabled();
      await update.click();
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
      await openEditor(page, "/editor?project=draft-1");
      await openPublishDialog(page);
      await expect(dialog.getByRole("alert")).toContainText("Retry");
      await expect(publish).toBeDisabled();
      failDetail = false;
      await dialog.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(update).toBeEnabled();
      // Target changes follow that publication's metadata, even after reopening
      // the dialog, while deliberate edits (including empty fields) remain intact.
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await openPublishDialog(page);
      publications.set("published-999", {
        name: "Another publication",
        projectText: originalPrivateText,
        description: "Another description",
        tags: ["capacitor"],
      });
      await dialog
        .getByText("Use an existing Gallery publication…", { exact: true })
        .click();
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
      ...placedInstance("R1", "resistor", 200, 200),
      reference: "R1",
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
    if (scenario === "unrelated Shelf rename") {
      await openEditor(page, "/g/published-1");
      await openPublishDialog(page);
      await expect(update).toBeEnabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await renameShelfProject(page, "Replacement draft", "Unrelated renamed");
      await page
        .getByLabel("Open Shelf project in tab", { exact: true })
        .click();
      await openPublishDialog(page);
      await expect(update).toBeEnabled();
      await update.click();
      await expect(dialog).toHaveCount(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.method).toBe("PUT");
      expect(requests[0]!.id).toBe("published-1");
      return;
    }
    const oldDraft = drafts.get("draft-1")!.projectText;
    await openEditor(page, "/editor?project=draft-2");
    await openPublishDialog(page);
    await dialog
      .getByText("Use an existing Gallery publication…", { exact: true })
      .click();
    await choosePublication(
      "https://analog-canvas.tokenzhang.com/g/published-1",
    );
    await update.click();
    await expect(dialog).toHaveCount(0);
    expect(drafts.get("draft-1")!.projectText).toBe(oldDraft);
    expect(drafts.get("draft-1")!.galleryEntryId).toBeNull();
    expect(drafts.get("draft-2")!.galleryEntryId).toBe("published-1");
    expect(publications.size).toBe(1);
    await openEditor(page, "/editor?project=draft-2");
    await openPublishDialog(page);
    await expect(update).toBeEnabled();
    await dialog
      .getByRole("radio", { name: "Publish as a new entry", exact: true })
      .check();
    await publish.click();
    await expect(dialog).toHaveCount(0);
    expect(publications.size).toBe(2);
    expect(drafts.get("draft-2")!.galleryEntryId).toBe("published-2");
  });
}

test("Shelf reviews regional conflicts and requires an explicit choice of the observed heads", async ({
  page,
}) => {
  const projectText = serializeProject(
    exampleProject("five-transistor-ota-sky130.icproj.json"),
  );
  const saved = {
    id: "regional",
    name: "Regional circuit",
    revision: 2,
    updatedAt: "2026-11-06T08:00:00Z",
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    saveToken: "head-cn",
    conflicted: true,
  };
  const conflicts = [
    {
      head: "head-cn",
      origin: "cn",
      name: "Domestic edit",
      updatedAt: saved.updatedAt,
      projectText,
    },
    {
      head: "head-overseas",
      origin: "overseas",
      name: "Overseas edit",
      updatedAt: saved.updatedAt,
      projectText,
    },
  ];
  let writes = 0;
  await signIn(page, sessionUser({ id: "owner", displayName: "Author" }));
  await page.route("**/api/gallery**", (route) =>
    route.fulfill({
      json: { entries: [], tags: [], nextCursor: null, total: 0 },
    }),
  );
  await page.route("**/api/projects**", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname.endsWith("/preview.svg")) return fulfillPreview(route);
    if (request.method() === "PUT") {
      expect(request.headers()["if-match"]).toBe("head-cn");
      expect(request.postDataJSON().resolveHeads).toEqual([
        "head-cn",
        "head-overseas",
      ]);
      writes++;
      saved.conflicted = false;
      return route.fulfill({ json: { project: saved } });
    }
    return url.pathname === "/api/projects"
      ? route.fulfill({ json: { projects: [saved] } })
      : route.fulfill({
          status: 409,
          json: { error: "revision-conflict", conflicts },
        });
  });
  await page.goto("/?view=shelf");
  await page
    .getByRole("button", { name: "Review conflicting versions" })
    .click();
  await expect(page.getByLabel("Conflicting Project versions")).toContainText(
    "Overseas edit",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download version 2" }).click();
  expect((await download).suggestedFilename()).toBe("conflict-2.icproj.json");
  await page
    .getByRole("button", { name: "Choose version 1", exact: true })
    .click();
  expect(writes).toBe(0);
  await page
    .getByRole("button", { name: "Use version 1 as current", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review conflicting versions" }),
  ).toHaveCount(0);
  expect(writes).toBe(1);
});

test("Shelf cards leave native gestures alone, open their menu from the keyboard and export the saved text", async ({
  page,
}) => {
  // Duplicating, renaming and favouriting are the cloud-projects
  // "Shelf card operations" tests.
  const source = exampleProject("five-transistor-ota-sky130.icproj.json");
  const saved = {
    id: "original",
    name: "Folded OTA",
    revision: 2,
    updatedAt: "2026-09-21T08:00:00Z",
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    projectText: serializeProject(source),
    galleryEntryId: null,
    favorite: false,
  };
  let deleted = false;
  await signIn(page, sessionUser({ id: "owner", displayName: "Author" }));
  await page.route("**/api/gallery**", (route) =>
    route.fulfill({
      json: { entries: [], tags: [], nextCursor: null, total: 0 },
    }),
  );
  await page.route("**/api/projects**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/preview.svg")) return fulfillPreview(route);
    if (request.method() === "DELETE") {
      deleted = true;
      return route.fulfill({ json: { deleted: true } });
    }
    return route.fulfill({
      json: url.pathname.split("/")[3]
        ? { project: saved }
        : { projects: deleted ? [] : [saved] },
    });
  });
  await page.goto("/?view=shelf");
  const tile = page.getByTestId("shelf-tile-original");
  const actions = page.getByTestId("shelf-actions-original");
  await expect(tile).toBeVisible();
  // The card no longer cancels the browser's context menu, and holding it on
  // touch leaves native gestures alone too.
  await tile.click({ button: "right" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(
    await tile.evaluate((element) =>
      element.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    ),
  ).toBe(true);
  await tile.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: 120,
    clientY: 220,
  });
  await page.waitForTimeout(600);
  await tile.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page).toHaveURL(/view=shelf/);
  // The actions button toggles its menu, opens it from the keyboard and
  // takes focus back when it closes.
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
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Folded OTA.icproj.json");
  expect(readFileSync((await download.path())!, "utf8")).toBe(
    saved.projectText,
  );
  // At phone width the inline rename fits, and Escape gives focus back.
  await page.setViewportSize({ width: 360, height: 600 });
  await actions.click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Project name", exact: true })
    .fill("VeryLongCircuitName".repeat(6));
  expect(
    await page
      .locator(".shelf-rename-form")
      .evaluate((form) => form.scrollWidth <= form.clientWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  // Deleting asks first; keeping it gives focus back to the button.
  const remove = page.getByTestId("shelf-delete-original");
  await remove.click();
  await page.getByRole("button", { name: "Keep it", exact: true }).click();
  await expect(remove).toBeFocused();
  expect(deleted).toBe(false);
  await remove.click();
  await page
    .getByRole("button", { name: "Really delete", exact: true })
    .click();
  await expect(tile).toHaveCount(0);
  expect(deleted).toBe(true);
});
