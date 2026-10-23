import { describe, expect, it } from "vitest";

import { SITE_USAGE_NOTE } from "../src/usage-policy-note";
import { usagePolicyShell } from "./usage-policy-shell";

describe("usagePolicyShell", () => {
  it("states the usage policy in the shell to programs that do not run it", () => {
    const transform = usagePolicyShell().transformIndexHtml as () => {
      tag: string;
      attrs?: Record<string, string>;
      children?: string;
    }[];
    const [meta, noscript] = transform();
    expect(meta).toMatchObject({
      tag: "meta",
      attrs: { name: "robots", content: "noai, noimageai" },
    });
    expect(noscript?.tag).toBe("noscript");
    // Written into the HTML as given: the note reads as text, never as markup.
    expect(noscript?.children).not.toMatch(/[<>]/u);
    const text = noscript!
      .children!.replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
    expect(text).toBe(SITE_USAGE_NOTE);
  });
});
