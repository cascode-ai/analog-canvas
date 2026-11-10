import { expect, it } from "vitest";

import { analyticsBackLink } from "./AnalyticsPage";

const origin = "https://analog-canvas.tokenzhang.com";

it("goes back to the editor page it came from, else to the Gallery (#2188)", () => {
  expect(analyticsBackLink(`${origin}/editor?project=p1`, origin)).toEqual({
    href: "/editor?project=p1",
    label: "Back to editor",
  });
  expect(analyticsBackLink(`${origin}/g/efx8jakksk`, origin)).toEqual({
    href: "/g/efx8jakksk",
    label: "Back to editor",
  });
  for (const referrer of [
    "",
    `${origin}/`,
    `${origin}/datasets`,
    "https://example.com/editor",
  ])
    expect(analyticsBackLink(referrer, origin)).toEqual({
      href: "/",
      label: "Back to the Gallery",
    });
});
