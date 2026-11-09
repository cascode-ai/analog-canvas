import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { GalleryDownloadMenu } from "./gallery-download-menu";

const render = (props: Parameters<typeof GalleryDownloadMenu>[0]) =>
  renderToStaticMarkup(createElement(GalleryDownloadMenu, props));

it("offers a filtered wall's results and everything, an unfiltered wall's everything alone", () => {
  const filtered = render({
    query: { source: "circuitthink", parts: ["6-10"], order: "random" },
  });
  expect(filtered).toContain("These results");
  expect(filtered).toContain('data-testid="gallery-download-results"');
  expect(filtered).toContain("Everything");
  expect(filtered).toContain('data-testid="gallery-download-all"');

  // Its order alone narrows nothing.
  const whole = render({ query: { order: "likes" } });
  expect(whole).not.toContain('data-testid="gallery-download-results"');
  expect(whole).toContain("All public circuits");
  expect(whole).toContain('data-testid="gallery-download-all"');
});

it("stays out of sight off the community wall while nothing runs", () => {
  expect(render({ query: {}, hidden: true })).toMatch(
    /<details[^>]*hidden=""/u,
  );
  expect(render({ query: {} })).not.toMatch(/<details[^>]*hidden/u);
});
