import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReleaseChannelBadge } from "./editor-app-chrome";

describe("editor release channel identity", () => {
  it("uses a compact Preview identity instead of the retired warning banner", () => {
    const markup = renderToStaticMarkup(
      <ReleaseChannelBadge releaseChannel="preview" />,
    );

    expect(markup).toContain('data-testid="release-channel-badge"');
    expect(markup).toContain("Preview");
    expect(markup).not.toContain("unreleased features");
    expect(markup).not.toContain("gallery is read-only");
  });

  it("adds no channel chrome on production", () => {
    expect(
      renderToStaticMarkup(<ReleaseChannelBadge releaseChannel="production" />),
    ).toBe("");
  });
});
