import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RNL_INTRO_URL } from "../../components/site-resource-links";
import { AboutRnlLink } from "./rnl-netlist-view";

describe("the About RNL link", () => {
  it("opens the introduction to RNL in a new tab", () => {
    expect(RNL_INTRO_URL).toBe("https://rich-netlist.github.io/rnl/en/");
    const markup = renderToStaticMarkup(<AboutRnlLink />);
    expect(markup).toContain(`href="${RNL_INTRO_URL}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain(">About RNL<");
    expect(markup).not.toContain("data-native-external-link");
  });

  it("goes through the desktop app's fixed list of links when it has one", () => {
    const markup = renderToStaticMarkup(
      <AboutRnlLink
        externalLinksEnabled={false}
        onOpenExternalLink={() => {}}
      />,
    );
    expect(markup).toContain('data-native-external-link="rnl"');
    expect(markup).toContain(">About RNL<");
  });

  it("is left out where the build links nowhere outside itself", () => {
    expect(
      renderToStaticMarkup(<AboutRnlLink externalLinksEnabled={false} />),
    ).toBe("");
  });
});
