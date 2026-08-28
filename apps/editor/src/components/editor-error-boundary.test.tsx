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
});
