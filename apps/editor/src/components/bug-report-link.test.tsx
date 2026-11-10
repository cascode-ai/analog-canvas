import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BUG_REPORT_EMAIL,
  BugReportLink,
  NEW_BUG_ISSUE_URL,
  bugReportMailto,
} from "./bug-report-link";

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

  it("offers an email for reporters without a GitHub account (#2162)", () => {
    const markup = renderToStaticMarkup(<BugReportLink testId="report-bug" />);
    expect(markup).toContain('data-testid="report-bug-email"');
    expect(markup).toContain(`mailto:${BUG_REPORT_EMAIL}?`);

    const mail = new URL(
      bugReportMailto("https://example.test/g/abc", "TestBrowser/1"),
    );
    expect(mail.protocol).toBe("mailto:");
    expect(mail.pathname).toBe(BUG_REPORT_EMAIL);
    expect(mail.searchParams.get("subject")).toBe("Analog Canvas bug");
    const body = mail.searchParams.get("body") ?? "";
    expect(body).toContain("Page: https://example.test/g/abc");
    expect(body).toContain("Browser: TestBrowser/1");
  });
});
