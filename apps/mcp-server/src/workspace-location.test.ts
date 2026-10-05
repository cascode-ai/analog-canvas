import { join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createOperationSession } from "./operation-session.js";
import { userWorkspaceRoot } from "./workspace-location.js";

// Where workspaces go for the editor's open Projects is tested against the
// real editor, in apps/editor/src/agent/mcp-workspace-location-live.test.ts.
describe("workspace location policy", () => {
  it("uses platform user data without trusting cwd or a relative environment path", () => {
    const root = userWorkspaceRoot();
    expect(isAbsolute(root)).toBe(true);
    expect(root).not.toContain(process.cwd());
    const home = join(tmpdir(), "home");
    expect(userWorkspaceRoot({}, "linux", home)).toBe(
      join(home, ".local", "share", "analog-canvas", "workspaces"),
    );
    expect(userWorkspaceRoot({}, "darwin", home)).toBe(
      join(
        home,
        "Library",
        "Application Support",
        "analog-canvas",
        "workspaces",
      ),
    );
    expect(() =>
      userWorkspaceRoot({ XDG_DATA_HOME: "relative" }, "linux", home),
    ).toThrow("ABSOLUTE");
    expect(() =>
      createOperationSession({
        apiBaseUrl: "https://test",
        connectorPath: "unused",
        taskDirectory: "relative",
      }),
    ).toThrow("absolute");
  });
});
