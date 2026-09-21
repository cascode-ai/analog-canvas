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
      groupCounts: { Amplifiers: 5, Buffers: 23 },
      selected: ["legacy tag", "bandgap"],
      onChange: () => {},
      search: "",
      onSearchChange: () => {},
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
  expect(markup).toContain(
    'Buffers</span><span class="gallery-sidebar-count" aria-hidden="true">23</span>',
  );
  expect(markup).toContain(
    'Amplifiers</span><span class="gallery-sidebar-count" aria-hidden="true">5</span>',
  );
  expect(markup).toContain(
    'role="checkbox" aria-label="Bias &amp; references" aria-checked="mixed"',
  );
  expect(markup).toContain(
    'role="checkbox" aria-label="Amplifiers" aria-checked="false"',
  );
  expect(markup).toContain(
    'aria-label="Collapse Bias &amp; references" aria-expanded="true"',
  );
  expect(markup).toContain("Conversion");
  expect(markup).toContain("Custom &amp; legacy");
  expect(markup).toContain("General Amplifier");
  expect(markup).toContain("ADC");
  expect(markup).toContain("Clear 2 selected");
  expect(markup).not.toContain("Browse");
  expect(markup).not.toContain("Tagged circuits");
  expect(markup).toContain('data-testid="gallery-search"');
  expect(markup).not.toContain('data-testid="gallery-tag-search"');
});
