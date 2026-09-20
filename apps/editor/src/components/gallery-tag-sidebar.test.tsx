import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GalleryTagSidebar } from "./gallery-tag-sidebar";

it("keeps every original tag and a removed tag from a saved filter reachable", () => {
  const markup = renderToStaticMarkup(
    createElement(GalleryTagSidebar, {
      tags: [
        { tag: "amplifier", count: 6 },
        { tag: "buffer", count: 3 },
        { tag: "adc", count: 2 },
        { tag: "new custom tag", count: 1 },
      ],
      selected: ["legacy tag", "bandgap"],
      onChange: () => {},
      quickFilters: null,
    }),
  );
  for (const tag of [
    "amplifier",
    "buffer",
    "adc",
    "new-custom-tag",
    "legacy-tag",
    "bandgap",
  ])
    expect(
      markup.split(`data-testid="gallery-tag-option-${tag}"`),
    ).toHaveLength(2);
  expect(markup).toContain("Amplifiers");
  expect(markup).toContain("Buffers");
  expect(markup).toContain("Conversion");
  expect(markup).toContain("Custom &amp; legacy");
  expect(markup).toContain("General Amplifier");
  expect(markup).toContain("ADC");
  expect(markup).toContain("Clear 2 selected");
  expect(markup).not.toContain("Browse");
  expect(markup).not.toContain("Tagged circuits");
});
