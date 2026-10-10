import { describe, expect, it } from "vitest";

import { galleryEarlyFetch } from "./gallery-early-fetch";

const handler = (
  galleryEarlyFetch().transformIndexHtml as {
    handler: (html: string) => string;
  }
).handler;

describe("the early Gallery requests in index.html (#1592)", () => {
  it("are written just before the entry script, ahead of any stylesheet", () => {
    const page = handler(`<head>
    <script>/* theme */</script>
    <script type="module" crossorigin src="/assets/index-1.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-1.css">
  </head>`);
    const early = page.indexOf("__icmGalleryEarly");
    expect(early).toBeGreaterThan(page.indexOf("/* theme */"));
    expect(early).toBeLessThan(page.indexOf('type="module"'));
    expect(early).toBeLessThan(page.indexOf('rel="stylesheet"'));
  });

  it("refuses a page without an entry script", () => {
    expect(() => handler("<head></head>")).toThrow(/entry script/u);
  });
});
