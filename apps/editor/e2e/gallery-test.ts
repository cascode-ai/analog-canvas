import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";

/** Hosted Gallery scenarios explicitly select the same mode as dev:replica. */
export const test = base.extend({
  page: async ({ page }, providePage) => {
    await page.route("**/api/gallery/**/intent", (route) =>
      route.fulfill({ json: { key: `cn_${crypto.randomUUID()}` } }),
    );
    await page.addInitScript(() => {
      Object.assign(window, { __icmLocalGalleryReplica: true });
    });
    await providePage(page);
  },
});
