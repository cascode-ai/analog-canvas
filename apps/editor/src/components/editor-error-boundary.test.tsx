import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { EditorCrashScreen } from "./editor-error-boundary";

describe("EditorCrashScreen", () => {
  it("renders an alert with the failure reason and a reload action", () => {
    const html = renderToStaticMarkup(
      <EditorCrashScreen
        message="boom in scene build"
        onReload={() => undefined}
      />,
    );
    expect(html).toContain("The editor hit an unexpected problem");
    expect(html).toContain("boom in scene build");
    expect(html).toContain("Reload editor");
    expect(html).toContain('data-testid="crash-report-bug"');
    expect(html).toContain("Report bug");
    expect(html).toContain("Recover Local Work");
  });

  it("offers a clean reload when the build is the thing that is stale", () => {
    // #493: a fresh visit could not open the editor because the app chunk
    // named in the document no longer existed. An ordinary reload can serve
    // that same document again, so the screen must say what is wrong and
    // offer the reload that discards this build's cached copies.
    const html = renderToStaticMarkup(
      <EditorCrashScreen
        message="Failed to fetch dynamically imported module: /assets/App-L9bGmgOj.js"
        staleBuild
        onReload={() => undefined}
        onRecover={() => undefined}
      />,
    );
    expect(html).toContain("running an old version of the editor");
    expect(html).toContain("Reload with a clean copy");
    expect(html).toContain("crash-reload-clean");
  });

  it("keeps the ordinary crash wording for an ordinary crash", () => {
    const html = renderToStaticMarkup(
      <EditorCrashScreen message="boom" onReload={() => undefined} />,
    );
    expect(html).toContain("The editor hit an unexpected problem");
    expect(html).not.toContain("crash-reload-clean");
  });
});
