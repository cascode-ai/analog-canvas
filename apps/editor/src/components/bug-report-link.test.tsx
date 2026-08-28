import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  browserSummary,
  BugReportLink,
  buildBugReportUrl,
  type BugReportEnvironment,
} from "./bug-report-link";

const environment: BugReportEnvironment = {
  pathname: "/editor?project=private-project#private-fragment-value",
  browser: "Chrome 140",
  viewport: "1440 × 900 @ 2×",
  mode: "browser tab",
  reportedAt: "2026-08-28T08:30:00.000Z",
};

describe("bug report link", () => {
  it("opens a structured public GitHub issue without private URL parts", () => {
    const url = new URL(
      buildBugReportUrl(environment, {
        surface: "Editor",
        projectSchemaVersion: 29,
      }),
    );
    const body = url.searchParams.get("body") ?? "";

    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/cascode-ai/analog-canvas/issues/new");
    expect(url.searchParams.get("labels")).toBe("bug");
    expect(url.searchParams.get("title")).toBe("[Bug] ");
    expect(body).toContain("## What happened?");
    expect(body).toContain("## Steps to reproduce");
    expect(body).toContain("- Surface: `Editor`");
    expect(body).toContain("- Page: `/editor`");
    expect(body).toContain("- Browser: `Chrome 140`");
    expect(body).toContain("- Project schema: `29`");
    expect(body).toContain("This GitHub Issue will be public");
    expect(body).not.toContain("private-project");
    expect(body).not.toContain("private-fragment-value");
  });

  it("reduces user agents to a browser family and major version", () => {
    expect(
      browserSummary(
        "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome 140");
    expect(
      browserSummary(
        "Mozilla/5.0 AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15",
      ),
    ).toBe("Safari 18");
  });

  it("redacts Gallery entry ids that may identify a private submission", () => {
    const url = new URL(
      buildBugReportUrl(
        {
          ...environment,
          pathname: "/g/private-entry-id?owner_token=secret",
        },
        { surface: "Gallery entry" },
      ),
    );
    const body = url.searchParams.get("body") ?? "";

    expect(body).toContain("- Page: `/g/:id`");
    expect(body).not.toContain("private-entry-id");
    expect(body).not.toContain("owner_token");
  });

  it("keeps the current page open while GitHub receives the final confirmation", () => {
    const markup = renderToStaticMarkup(
      <BugReportLink
        testId="report-bug"
        surface="Community gallery"
        environment={environment}
      />,
    );

    expect(markup).toContain('data-testid="report-bug"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("Report bug");
    expect(markup).toContain("publicly on GitHub");
  });
});
