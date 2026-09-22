import { expect, test, type Page } from "@playwright/test";
import {
  chooseComponent,
  downloadBytes,
  parseSavedProject,
} from "./editor-fixtures";
import type { CircuitProject } from "@icm/model";

async function insert(page: Page, symbol: string, x: number, y: number) {
  await chooseComponent(page, symbol);
  await page.getByTestId("schematic-canvas").click({ position: { x, y } });
  await page.keyboard.press("Escape");
}
async function saved(page: Page): Promise<CircuitProject> {
  return parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as CircuitProject;
}

test("project tabs append a partial selection and retain independent history, cameras and code drafts", async ({
  page,
  context,
}) => {
  // This journey opens multiple Projects and verifies copy, export, undo and
  // code editing. Keep per-action assertions bounded, but allow the complete
  // workflow more than 30 seconds on the shared CI runner.
  test.slow();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/editor?new=1");
  const canvas = page.getByTestId("schematic-canvas");
  await insert(page, "nmos", 240, 220);
  await insert(page, "nmos", 440, 220);
  await insert(page, "pmos", 650, 330);
  await page.keyboard.press("w");
  await page.getByTestId("terminal-M1-G").click();
  await page.getByTestId("terminal-M2-G").click();
  await page.keyboard.press("Escape");
  // Use an actual subset: two transistors and their one wire; leave the PMOS behind.
  const a = (await page.getByTestId("hit-M1").boundingBox())!;
  const b = (await page.getByTestId("hit-M2").boundingBox())!;
  await page.mouse.move(Math.min(a.x, b.x) - 25, Math.min(a.y, b.y) - 25);
  await page.mouse.down();
  await page.mouse.move(
    Math.max(a.x + a.width, b.x + b.width) + 25,
    Math.max(a.y + a.height, b.y + b.height) + 25,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.keyboard.press("c");
  await expect(page.getByTestId("status")).toContainText("Circuit copied");
  const fragment = await page.evaluate(() => navigator.clipboard.readText());
  expect(fragment).toContain("analog-canvas/clipboard");
  expect(JSON.parse(fragment).project.documents[0].instances).toHaveLength(2);
  expect(
    JSON.parse(fragment).project.documents[0].routes.length,
  ).toBeGreaterThan(0);
  const sourceView = await canvas.getAttribute("viewBox");
  const source = await saved(page);
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await insert(page, "resistor", 260, 400);
  const before = await saved(page);
  await page.keyboard.press("v");
  await expect(page.getByTestId("status")).toContainText("click to place");
  await canvas.click({ position: { x: 480, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  const target = await saved(page);
  const original = before.documents[0]!.instances[0]!;
  expect(
    target.documents[0]!.instances.find((item) => item.id === original.id),
  ).toEqual(original);
  expect(
    target.documents[0]!.instances.filter((item) => item.symbolId === "nmos"),
  ).toHaveLength(2);
  expect(target.documents[0]!.routes.length).toBeGreaterThan(0);
  expect(
    target.documents[0]!.instances.some((item) => item.symbolId === "pmos"),
  ).toBe(false);
  const targetView = await canvas.getAttribute("viewBox");
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  await expect(canvas).toHaveAttribute("viewBox", sourceView!);
  expect((await saved(page)).documents).toEqual(source.documents);
  await page.getByRole("tab").nth(1).click();
  await expect(canvas).toHaveAttribute("viewBox", targetView!);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  // A single component and native modifiers use the same append path.
  await page.getByRole("tab").first().click();
  await page.getByTestId("hit-M3").click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.getByRole("tab").nth(1).click();
  await page.keyboard.press("ControlOrMeta+v");
  await canvas.click({ position: { x: 660, y: 380 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("4");
  // Unapplied invalid text cannot be discarded by switching projects.
  await page.getByTestId("project-code-toggle").click();
  const code = page.getByRole("textbox", { name: "Project code", exact: true });
  await code.fill("invalid project");
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("status")).toContainText(
    "No work was discarded",
  );
  await expect(code).toHaveText("invalid project");
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: /Reload/ }).click();
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  await page.screenshot({ path: "plan/project-tabs.png" });
});

test("tab file opening is additive and closing unsaved projects can be cancelled", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await insert(page, "resistor", 300, 220);
  const exported = await saved(page);
  exported.name = "Second circuit";
  await page.getByTestId("tab-project-file").setInputFiles({
    name: "second.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(
    page.getByRole("tab", { name: "Second circuit" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab").nth(1).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab").first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await insert(page, "capacitor", 500, 260);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Close tab Second circuit" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Close tab Second circuit" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
});

test("Shelf tabs deduplicate an open draft and save back to their own Cloud identities", async ({
  page,
}) => {
  const { createEmptyProject } = await import("@icm/model");
  const records = ["Alpha", "Beta"].map((name, index) => {
    const project = createEmptyProject(`project-${index}`, name);
    return {
      id: `cloud-${index}`,
      name,
      revision: 1,
      schemaVersion: project.schemaVersion,
      updatedAt: "2026-09-21T08:00:00.000Z",
      projectText: JSON.stringify(project),
    };
  });
  const writes: string[] = [];
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Author",
          email: "author@example.com",
          provider: "github",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { projects: records } }),
  );
  await page.route("**/api/projects/cloud-*", (route) => {
    const item = records.find((item) =>
      route.request().url().endsWith(item.id),
    )!;
    if (route.request().method() !== "GET") {
      const body = route.request().postDataJSON();
      item.projectText = body.projectText;
      item.name = body.name;
      item.revision++;
      writes.push(item.id);
    }
    return route.fulfill({ json: { project: item } });
  });
  await page.goto("/editor?new=1");
  async function shelf(name: string) {
    await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
    await page
      .locator(".project-tabs-shelf")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: new RegExp(`${name}$`) }),
    ).toHaveAttribute("aria-selected", "true");
  }
  await shelf("Alpha");
  await insert(page, "nmos", 300, 240);
  await shelf("Beta");
  await insert(page, "resistor", 450, 240);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => writes).toEqual(["cloud-1"]);
  await shelf("Alpha");
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => writes).toEqual(["cloud-1", "cloud-0"]);
  expect(
    parseSavedProject(records[0]!.projectText).documents[0]!.instances[0]!
      .symbolId,
  ).toBe("nmos");
  expect(
    parseSavedProject(records[1]!.projectText).documents[0]!.instances[0]!
      .symbolId,
  ).toBe("resistor");
});

test("plain C/V works between internal tabs when system clipboard permission is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
        readText: async () => {
          throw new Error("denied");
        },
      },
    });
  });
  await page.goto("/editor?new=1");
  await insert(page, "nmos", 300, 220);
  await insert(page, "nmos", 470, 220);
  await insert(page, "nmos", 630, 220);
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("c");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  // Unsaved work in an inactive tab continues protecting browser close/reload.
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      // Model BeforeUnloadEvent's string returnValue, not Event's legacy cancel setter.
      Object.defineProperty(event, "returnValue", {
        value: "",
        writable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.keyboard.press("v");
  await expect(page.getByTestId("status")).toContainText("click to place");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 500, y: 240 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
});

test("refresh restores every unsaved tab and active view without crossing browser windows", async ({
  page,
  context,
}) => {
  // Four complete circuit exports before and after reload, plus another
  // browser window, are a longer journey than the single-edit checks.
  test.slow();
  await page.goto("/editor?new=1");
  const expected: CircuitProject[] = [];
  const views: (string | null)[] = [];
  for (const symbol of ["nmos", "pmos", "resistor", "capacitor"]) {
    if (expected.length)
      await page
        .getByRole("button", { name: "New project tab", exact: true })
        .click();
    await insert(page, symbol, 240 + expected.length * 30, 250);
    expected.push(await saved(page));
    views.push(
      await page.getByTestId("schematic-canvas").getAttribute("viewBox"),
    );
  }
  await page.getByRole("tab").nth(1).click();
  // A different browser window starts independent, even on the same URL.
  const other = await context.newPage();
  await other.goto("/editor?new=1");
  await expect(other.getByRole("tab")).toHaveCount(1);
  await insert(other, "inductor", 260, 230);
  other.on("dialog", (dialog) => dialog.accept());
  await other.reload();
  await expect(other.getByTestId("active-instance-count")).toHaveText("1");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(4);
  await expect(page.getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (let index = 0; index < expected.length; index++) {
    await page.getByRole("tab").nth(index).click();
    await expect(page.getByTestId("active-instance-count")).toHaveText("1");
    await expect(page.getByTestId("schematic-canvas")).toHaveAttribute(
      "viewBox",
      views[index]!,
    );
    expect((await saved(page)).documents).toEqual(expected[index]!.documents);
  }
  // A closed tab stays closed across the next refresh.
  await page
    .getByRole("button", { name: /Close tab / })
    .last()
    .click();
  await page.reload();
  await expect(page.getByRole("tab")).toHaveCount(3);
  await other.close();
});

for (const modifier of ["Control", "Meta", "plain"]) {
  test(`${modifier} C/V copies a wired subset into an existing project`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/editor?new=1");
    await insert(page, "nmos", 260, 200);
    await insert(page, "nmos", 450, 200);
    await insert(page, "resistor", 600, 400);
    await page.keyboard.press("w");
    await page.getByTestId("terminal-M1-S").click();
    await page.getByTestId("terminal-M2-S").click();
    await page.keyboard.press("Escape");
    // Box-select both transistors and their wire, leaving the resistor behind.
    const a = (await page.getByTestId("hit-M1").boundingBox())!;
    const b = (await page.getByTestId("hit-M2").boundingBox())!;
    await page.mouse.move(Math.min(a.x, b.x) - 25, Math.min(a.y, b.y) - 25);
    await page.mouse.down();
    await page.mouse.move(
      Math.max(a.x + a.width, b.x + b.width) + 25,
      Math.max(a.y + a.height, b.y + b.height) + 25,
      { steps: 5 },
    );
    await page.mouse.up();
    const key = (letter: string) =>
      modifier === "plain" ? letter : `${modifier}+${letter}`;
    // A leftover browser selection in the header must not take ownership
    // once the canvas has focus again.
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("h1")!);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await page.getByTestId("schematic-canvas").focus();
    await page.keyboard.press(key("c"));
    await expect(page.getByTestId("status")).toContainText("Circuit copied");
    if (modifier === "plain") {
      await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
    } else {
      await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
    }
    const encoded = await page.evaluate(() => navigator.clipboard.readText());
    const source = JSON.parse(encoded).project.documents[0];
    expect(source.instances).toHaveLength(2);
    expect(source.routes.length).toBeGreaterThan(0);
    await page
      .getByRole("button", { name: "New project tab", exact: true })
      .click();
    await insert(page, "capacitor", 300, 400);
    await page.keyboard.press(key("v"));
    await expect(page.getByTestId("status")).toContainText("click to place");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x: 380, y: 200 } });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("active-instance-count")).toHaveText("3");
    await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(
      source.routes.length,
    );
    const result = (await saved(page)).documents[0]!;
    expect(
      result.instances.filter((item) => item.symbolId === "nmos"),
    ).toHaveLength(2);
    expect(
      result.instances.filter((item) => item.symbolId === "capacitor"),
    ).toHaveLength(1);
    expect(result.instances.some((item) => item.symbolId === "resistor")).toBe(
      false,
    );
    // A single undo removes the appended group, keeping the target capacitor.
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByTestId("active-instance-count")).toHaveText("1");
    await page.getByRole("tab").first().click();
    await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  });
}

test("Project menu keeps long names out of the header and switches checked projects", async ({
  page,
}) => {
  await page.goto("/editor?new=1");
  await insert(page, "resistor", 260, 220);
  const toggle = page.getByTestId("project-menu-toggle");
  const menu = page.getByRole("region", {
    name: "Project details",
    exact: true,
  });
  const longName =
    "Voltage regulator with a very long circuit name for temperature and supply characterization";
  await expect(menu).toBeHidden();
  await toggle.click();
  const name = page.getByTestId("project-name-input");
  await name.fill(longName);
  await name.press("Enter");
  await expect(menu).toBeHidden();
  await expect(toggle).toHaveAttribute("title", longName);
  await expect(toggle).not.toContainText(longName);
  for (const width of [1360, 720]) {
    await page.setViewportSize({ width, height: 900 });
    const brand = (await page.locator(".gallery-home-link").boundingBox())!;
    const trigger = (await toggle.boundingBox())!;
    expect(trigger.x).toBeGreaterThanOrEqual(brand.x + brand.width);
    expect(trigger.width).toBeLessThan(120);
    await toggle.click();
    await expect(name).toHaveValue(longName);
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `plan/project-menu-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await insert(page, "capacitor", 340, 260);
  await toggle.click();
  const current = menu.getByRole("menuitemradio", { checked: true });
  await expect(current).toContainText("New Circuit");
  const first = menu.getByRole("menuitemradio").filter({ hasText: longName });
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(current).toBeFocused();
  await first.click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(page.getByTestId("hit-C1")).toHaveCount(0);
  await toggle.click();
  await expect(first).toHaveAttribute("aria-checked", "true");
  await name.fill("Uncommitted rename");
  await name.press("Escape");
  await expect(menu).toBeHidden();
  await expect(toggle).toHaveAttribute("title", longName);
});

for (const kind of ["port", "net"] as const) {
  test(`copies a styled ${kind} with identical name and overbar using C, Ctrl+C/V and project tabs`, async ({
    page,
    context,
  }) => {
    const { createEmptyProject, createRoutePath } = await import("@icm/model");
    const { resolveDocumentLogicalNets } = await import("@icm/derived");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const project = createEmptyProject("copy-names", "Copy names");
    const document = project.documents[0]!;
    document.nets.push({
      id: "input-net",
      terminals: kind === "port" ? [{ instanceId: "P1", pinName: "P" }] : [],
    });
    if (kind === "port") {
      document.instances.push({
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      });
      document.netlist = {
        name: "dut",
        formalParameters: [],
        terminals: [
          {
            id: "input-port",
            name: "IN_1_bar",
            netId: "input-net",
            direction: "input",
            interfaceInstanceIds: ["P1"],
          },
        ],
      };
    } else {
      document.junctions.push(
        {
          id: "a",
          netId: "input-net",
          position: { x: 100, y: 100 },
          role: "route-anchor",
        },
        {
          id: "b",
          netId: "input-net",
          position: { x: 250, y: 100 },
          role: "route-anchor",
        },
      );
      document.routes.push(
        createRoutePath({
          id: "wire",
          netId: "input-net",
          start: { kind: "junction", junctionId: "a" },
          end: { kind: "junction", junctionId: "b" },
          bends: [],
          modes: ["manual"],
        }),
      );
      document.connectivityEvidence.push({
        id: "input-name",
        kind: "name-claim",
        netId: "input-net",
        name: "IN_1_bar",
        scope: "local",
        owner: { kind: "net-label", annotationId: "input-label" },
      });
    }
    document.annotations.push({
      id: "input-label",
      kind: kind === "port" ? "instance-label" : "net-label",
      ...(kind === "net" ? { netId: "input-net" } : {}),
      binding:
        kind === "port"
          ? { kind: "cell-terminal-name", terminalId: "input-port" }
          : { kind: "net-name", netId: "input-net" },
      anchor:
        kind === "port"
          ? {
              kind: "object",
              objectId: "P1",
              localOffset: { x: -25, y: -10 },
              fallbackPosition: { x: 75, y: 90 },
            }
          : { kind: "free", position: { x: 160, y: 75 } },
      alignment: "end",
      rotation: 0,
      locked: false,
      textColor: "#be123c",
      sizeScale: 1.25,
      formatOverride: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [
              {
                kind: "span",
                style: "italic",
                children: [
                  {
                    kind: "span",
                    style: "overbar",
                    children: [
                      { kind: "text", value: "IN" },
                      {
                        kind: "span",
                        style: "subscript",
                        children: [{ kind: "text", value: "1" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    await page.goto("/editor?new=1");
    await page.getByTestId("project-file").setInputFiles({
      name: "copy-names.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    const canvas = page.getByTestId("schematic-canvas");
    const labels = page.locator(
      '[data-layer="annotations"] [data-object-id^="input-label"]',
    );
    await expect(labels).toHaveCount(1);
    const originalText = await labels.first().textContent();
    const sourceLabel = structuredClone(document.annotations[0]!);
    const select = async () => {
      if (kind === "port") await page.getByTestId("hit-P1").click();
      else await page.getByTestId("annotation-hit-input-label").click();
    };
    const verify = async (count: number) => {
      await expect(labels).toHaveCount(count);
      for (const label of await labels.all()) {
        await expect(label).toHaveText(originalText!);
        await expect(
          label.locator("..").locator('[data-text-decoration="overbar"]'),
        ).toHaveCount(1);
        await expect(label.locator('[data-text-run="subscript"]')).toHaveCount(
          1,
        );
      }
      const result = await saved(page);
      const target = result.documents[0]!;
      for (const label of target.annotations) {
        expect(label).toMatchObject({
          formatOverride: sourceLabel.formatOverride,
          textColor: sourceLabel.textColor,
          sizeScale: sourceLabel.sizeScale,
          alignment: sourceLabel.alignment,
          rotation: sourceLabel.rotation,
        });
        if (kind === "port")
          expect(label.anchor).toMatchObject({
            kind: "object",
            localOffset: { x: -25, y: -10 },
          });
      }
      const logical = resolveDocumentLogicalNets(target).groups;
      expect(logical).toHaveLength(1);
      expect(logical[0]!.name).toBe("IN_1_bar");
      expect(logical[0]!.baseNetIds).toHaveLength(count);
      if (kind === "port") {
        expect(
          target.netlist!.terminals.every(
            (terminal) => terminal.name === "IN_1_bar",
          ),
        ).toBe(true);
        const netlist = page.getByLabel("Netlist code", { exact: true });
        await expect(netlist).toContainText("IN_1_bar");
        await expect(netlist).not.toContainText("copy");
      }
      return result;
    };
    await select();
    await page.keyboard.press("c");
    const ghost = page.getByTestId("copy-placement-preview");
    await expect(ghost).toBeVisible();
    await expect(ghost).not.toContainText("copy");
    await expect(ghost.locator('[data-text-decoration="overbar"]')).toHaveCount(
      1,
    );
    await canvas.click({ position: { x: 390, y: 280 } });
    await page.keyboard.press("Escape");
    await verify(2);
    await canvas.focus();
    await page.keyboard.press("Control+z");
    await expect(labels).toHaveCount(1);
    await page.keyboard.press("Control+Shift+z");
    await verify(2);

    await select();
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect(ghost).toBeVisible();
    await canvas.click({ position: { x: 420, y: 420 } });
    await page.keyboard.press("Escape");
    const repeated = await verify(3);
    await page
      .getByRole("button", { name: "New project tab", exact: true })
      .click();
    await page.keyboard.press("v");
    await expect(ghost).toBeVisible();
    await canvas.click({ position: { x: 350, y: 260 } });
    await page.keyboard.press("Escape");
    await verify(1);
    await page.getByRole("tab").first().click();
    await verify(3);
    await page.getByTestId("project-file").setInputFiles({
      name: "reopened.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(repeated)),
    });
    await verify(3);
  });
}
