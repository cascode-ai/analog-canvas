import { describe, expect, it } from "vitest";

import { SITE_USAGE_NOTE } from "../src/usage-policy-note";
import { usagePolicyHead } from "./usage-policy-head";

describe("usagePolicyHead", () => {
  it("states the usage policy in the shell to programs that do not run it", () => {
    const transform = usagePolicyHead().transformIndexHtml as () => unknown;
    expect(transform()).toEqual([
      {
        tag: "meta",
        attrs: { name: "robots", content: "noai, noimageai" },
        injectTo: "head",
      },
      { tag: "noscript", children: SITE_USAGE_NOTE, injectTo: "body-prepend" },
    ]);
  });
});
