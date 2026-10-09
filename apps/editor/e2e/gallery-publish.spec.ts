// Publishing to the Gallery: the publish dialog, its quality gates and tag
// suggestions, and updating an opened entry in place.

import { expect, test } from "@playwright/test";
import { createEmptyDocument, createEmptyProject } from "@icm/model";
import {
  serializeProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "@icm/project-protocol";
import { hierarchicalSymbolId } from "@icm/symbols";
import { awaitEditorReady, chooseComponent } from "./editor-fixtures.js";
import { ENTRY, mockGallery } from "./gallery-fixtures.js";

function hierarchicalPublishProject() {
  const project = createEmptyProject("hierarchical-publish", "Hierarchical");
  const top = project.documents[0]!;
  const child = createEmptyDocument("document-child", "scdac_unit");
  top.instances = [
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
        position: { x: 200, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "R2",
      netlist: { parameters: {} },
    },
    {
      id: "XU0",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      placement: {
        position: { x: 100, y: 120 },
        rotation: 0,
        mirror: "none",
      },
      reference: "XU0",
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    },
  ];
  top.nets = [
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
  project.documents.push(child);
  return project;
}

test("a signed-in member publishes directly, bylined by the account", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
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
  // The real submissions endpoint is /api/gallery/submissions — the mock
  // matches it exactly so a client posting anywhere else fails this test.
  await page.route("**/api/gallery/submissions", (route) => {
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
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Publishing as Token Zhang")).toBeVisible();
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  // The byline comes from the account, so there is no field to fill in.
  await expect(dialog.getByLabel("Author")).toHaveCount(0);

  await dialog.getByLabel("Circuit name").fill("Session Publish");
  await dialog.getByTestId("publish-preset-amplifier").click();
  // Five suggestions show; "+ …" opens the rest (#1385).
  const presets = dialog.locator('[data-testid^="publish-preset-"]');
  await expect(presets).toHaveCount(5);
  await dialog.getByTestId("publish-presets-more").click();
  await expect(dialog.getByTestId("publish-presets-more")).toHaveCount(0);
  await expect.poll(() => presets.count()).toBeGreaterThan(5);
  await dialog.getByLabel("Add tag").fill("Latch");
  await dialog.getByLabel("Add tag").press("Enter");
  await expect(dialog.getByTestId("publish-tag-latch")).toBeVisible();
  // Drawn by hand, so the AI mark starts off; the publisher may still set it.
  await expect(dialog.getByLabel("AI-generated")).not.toBeChecked();
  await dialog.getByLabel("AI-generated").check();
  await dialog.getByRole("button", { name: "Publish" }).click();
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
      tags: ["amplifier", "latch"],
      aiGenerated: true,
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    },
  ]);

  // The live Project remains the source of this publication. After another
  // edit, Publish must update the item it just created rather than creating a
  // duplicate Gallery entry.
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 340, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("publish-gallery-button").click();
  await expect(page.getByTestId("publish-mode")).toContainText(
    "Session Publish",
  );
  // The update starts from the entry's own mark.
  await expect(
    page.getByTestId("publish-gallery-dialog").getByLabel("AI-generated"),
  ).toBeChecked();
  await page
    .getByTestId("publish-gallery-dialog")
    .getByRole("button", { name: "Update entry" })
    .click();
  await expect(page.getByTestId("status")).toHaveText(
    'Updated "Session Publish" in the gallery',
  );
  await expect(page.getByTestId("gallery-published-notice")).toContainText(
    "Updated “Session Publish” in the Gallery",
  );
  expect(posted).toHaveLength(1);
  expect(updated).toEqual([
    { name: "Session Publish", aiGenerated: true, instanceCount: 1 },
  ]);
});

test("a published tab counts as saved until its next edit", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route("**/api/gallery/submissions", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 201, json: { id: "entry-88" } })
      : route.fallback(),
  );
  await page.route("**/api/gallery/entry-88", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 200, json: { id: "entry-88" } })
      : route.fallback(),
  );
  const place = async (x: number) => {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  };

  await page.goto("/editor");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  const active = page.getByRole("tab", { selected: true });
  await place(340);
  await expect(active.getByLabel("Unsaved")).toBeVisible();
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();

  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await dialog.getByLabel("Circuit name").fill("Published tab");
  await dialog.getByTestId("publish-preset-amplifier").click();
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("status")).toHaveText(
    'Published "Published tab" to the gallery',
  );
  // The Gallery holds exactly these bytes: nothing is unsaved.
  await expect(active.getByLabel("Unsaved")).toHaveCount(0);
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);

  // The next edit is unsaved again, until it is published too.
  await place(460);
  await expect(active.getByLabel("Unsaved")).toBeVisible();
  await page.getByTestId("publish-gallery-button").click();
  await page
    .getByTestId("publish-gallery-dialog")
    .getByRole("button", { name: "Update entry" })
    .click();
  await expect(page.getByTestId("status")).toHaveText(
    'Updated "Published tab" in the gallery',
  );
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
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          isAdmin: true,
        },
      },
    }),
  );

  await page.goto("/editor");
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Circuit name").fill("Folded Cascode");
  await dialog
    .getByLabel("Description")
    .fill("Gain boosted, 1.2 V supply, trimmed offset.");
  await dialog.getByLabel("Add tag").fill("Cascode");
  await dialog.getByLabel("Add tag").press("Enter");
  await expect(dialog.getByTestId("publish-tag-cascode")).toBeVisible();

  // A stray press on the backdrop beside a form being written in is a miss,
  // not a decision to throw the writing away.
  const viewport = page.viewportSize()!;
  await page.mouse.click(8, viewport.height - 8);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Circuit name")).toHaveValue("Folded Cascode");

  // Cancelling is a decision, and it still closes — but reopening comes back
  // to the draft rather than to an empty form.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId("publish-gallery-button").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Circuit name")).toHaveValue("Folded Cascode");
  await expect(dialog.getByLabel("Description")).toHaveValue(
    "Gain boosted, 1.2 V supply, trimmed offset.",
  );
  await expect(dialog.getByTestId("publish-tag-cascode")).toBeVisible();
});

test("an ordinary user sees blocking quality gates on an empty project", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u9",
          displayName: "Visitor",
          email: "visitor@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );

  await page.goto("/editor");
  const toolbar = page.locator(".toolbar-row").first();
  const toolbarStyleBeforeDialog = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopColor: style.borderTopColor,
      display: style.display,
    };
  });
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      toolbar.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          display: style.display,
        };
      }),
    )
    .toEqual(toolbarStyleBeforeDialog);

  // The empty canvas trips the content check — listed as advice, never as a
  // hard gate: the checker has false positives and sketches are shareable.
  const gates = page.getByTestId("publish-gallery-gates");
  await expect(gates).toBeVisible();
  await expect(gates).toContainText("publishing stays open");
  await expect(gates).toContainText("Too little content");
  const tags = dialog.getByTestId("publish-tags");
  await expect(tags).toHaveCSS("display", "flex");
  await expect(tags).toHaveCSS("flex-direction", "column");
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeEnabled();
});

test("the publish dialog resolves internal Cell instances from the open Project", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u9",
          displayName: "Visitor",
          email: "visitor@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "hierarchical-publish.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(hierarchicalPublishProject())),
  });
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("publish-gallery-gates")).toHaveCount(0);
  await expect(dialog).not.toContainText("ERC_UNRESOLVED_SYMBOL");
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeEnabled();
});

test("an opened gallery entry offers updating in place", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  const updates: { method: string; body: { name: string } }[] = [];
  await page.route(`**/api/gallery/${ENTRY.id}`, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    updates.push({
      method: route.request().method(),
      body: route.request().postDataJSON() as { name: string },
    });
    return route.fulfill({ json: { id: ENTRY.id, status: "public" } });
  });

  await page.goto(`/g/${ENTRY.id}`);
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  const publishMode = page.getByTestId("publish-mode");
  await expect(publishMode).toBeVisible();
  await expect(publishMode).toHaveCSS("display", "flex");
  await expect(publishMode).toHaveCSS("flex-direction", "column");
  const updateChoice = publishMode
    .getByRole("radio", { name: /^Update /u })
    .locator("..");
  const newChoice = publishMode
    .getByRole("radio", { name: "Publish as a new entry", exact: true })
    .locator("..");
  const [updateBox, newBox, historyBox] = await Promise.all([
    updateChoice.boundingBox(),
    newChoice.boundingBox(),
    page.getByTestId("publish-history").boundingBox(),
  ]);
  expect(updateBox).not.toBeNull();
  expect(newBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(newBox!.y).toBeGreaterThanOrEqual(updateBox!.y + updateBox!.height);
  expect(historyBox!.y).toBeGreaterThanOrEqual(newBox!.y + newBox!.height);
  // The update option names exactly what it will replace.
  await expect(publishMode).toContainText(ENTRY.name);
  await expect(dialog.getByText("updates the entry in place")).toBeVisible();

  await dialog.getByRole("button", { name: "Update entry" }).click();
  await expect(page.getByTestId("status")).toContainText(
    `Updated "${ENTRY.name}" in the gallery`,
  );
  expect(updates).toHaveLength(1);
  expect(updates[0]!.body.name).toBe(ENTRY.name);
});

test("replacing the project retires the stale update offer", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/gallery?limit=60", (route) =>
    // The panel sees an empty gallery, so it offers the bundled examples
    // — opening one replaces the Project with a non-gallery one.
    route.fulfill({ json: { entries: [], nextCursor: null } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );

  await page.goto(`/g/${ENTRY.id}`);
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );

  // Sanity: while the entry is the active Project, updating is offered.
  await page.getByTestId("publish-gallery-button").click();
  await expect(page.getByTestId("publish-mode")).toBeVisible();
  await page
    .getByTestId("publish-gallery-dialog")
    .getByRole("button", { name: "Cancel" })
    .click();

  // Import a different Project over it: the gallery entry is no longer
  // active, so publishing must NOT offer updating it any more.
  await page.getByTestId("project-file").setInputFiles({
    name: "fresh.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      serializeProject(createEmptyProject("fresh-project", "Fresh Start")),
    ),
  });
  // The fixture may pass through the rolling schema upgrade; either status
  // still proves that this different Project replaced the gallery entry.
  await expect(page.getByTestId("status")).toContainText("fresh.icproj.json");

  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("publish-mode")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeVisible();
});

test("publish tag suggestions remain clickable after filtering and save pending tags", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "tag-author",
          displayName: "Author",
          isAdmin: false,
          role: "user",
        },
      },
    }),
  );
  await mockGallery(page, []);
  let submitted: { tags: string[] } | undefined;
  await page.route("**/api/gallery/submissions", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { id: "tag-test" } });
  });
  await page.goto("/editor?new=1");
  await awaitEditorReady(page);
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await dialog.getByLabel("Add tag").fill("amp");
  await dialog.getByTestId("publish-preset-amplifier").click();
  await expect(dialog.getByTestId("publish-tag-amplifier")).toBeVisible();
  await expect(dialog.getByTestId("publish-tag-amp")).toHaveCount(0);
  await dialog.getByLabel("Add tag").fill("custom label");
  await dialog.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted?.tags).toEqual(["amplifier", "custom label"]);
});
