import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BugReportLink, NEW_BUG_ISSUE_URL } from "./bug-report-link";

describe("bug report link", () => {
  it("opens a blank public GitHub issue labelled bug, in a new tab", () => {
    const url = new URL(NEW_BUG_ISSUE_URL);
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/cascode-ai/analog-canvas/issues/new");
    expect([...url.searchParams]).toEqual([["labels", "bug"]]);

    const markup = renderToStaticMarkup(<BugReportLink testId="report-bug" />);
    expect(markup).toContain('data-testid="report-bug"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("Report bug");
  });
});
