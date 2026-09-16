import { describe, expect, it } from "vitest";

import { previewBrowserLaunchOptions } from "./preview-browser.mjs";

describe("Preview browser launch", () => {
  it("uses the runner browser when the workflow supplies one", () => {
    expect(
      previewBrowserLaunchOptions({
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/usr/bin/google-chrome",
      }),
    ).toEqual({
      headless: true,
      executablePath: "/usr/bin/google-chrome",
    });
  });

  it("uses the installed Chrome channel for local runs", () => {
    expect(previewBrowserLaunchOptions({})).toEqual({
      headless: true,
      channel: "chrome",
    });
  });
});
