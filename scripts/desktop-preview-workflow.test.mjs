import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/desktop-preview.yml", "utf8");
const release = readFileSync(".github/workflows/desktop-release.yml", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");

describe("desktop distribution gates", () => {
  it("requires packaged Windows acceptance in the existing required core check", () => {
    expect(ci).toContain("uses: ./.github/workflows/desktop-preview.yml");
    expect(ci).toContain("needs: [changes, core_suite, desktop]");
    expect(ci).toContain(
      "if: always() && github.event_name == 'merge_group' && needs.changes.outputs.heavy == 'true'",
    );
    expect(ci).toContain(
      'test "$CORE_RESULT" = "success" && test "$DESKTOP_RESULT" = "success"',
    );
  });

  it("accepts the executable before archiving and uploading the complete folder", () => {
    expect(workflow).toContain("runs-on: windows-latest");
    const assemble = workflow.indexOf(
      "run: pnpm --filter @icm/desktop package:preview",
    );
    const accept = workflow.indexOf(
      "run: pnpm --filter @icm/desktop test:preview",
    );
    const archive = workflow.indexOf(
      "Compress-Archive -LiteralPath $packageManifest.output",
    );
    const security = workflow.indexOf(
      "run: pnpm --filter @icm/desktop security:preview",
    );
    const upload = workflow.indexOf("uses: actions/upload-artifact@v4");
    expect(assemble).toBeGreaterThan(-1);
    expect(accept).toBeGreaterThan(assemble);
    expect(security).toBeGreaterThan(accept);
    expect(archive).toBeGreaterThan(security);
    expect(upload).toBeGreaterThan(archive);
    expect(workflow).toContain(
      "$acceptance.source -ne $packageManifest.commit",
    );
    expect(workflow).toContain("!$acceptance.packaged");
    expect(workflow).toContain("$security.source -ne $packageManifest.commit");
    expect(workflow).not.toContain("plan/preview-acceptance-*/\n");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("only explicitly publishes accepted mainline builds as desktop prereleases", () => {
    expect(workflow).toContain(
      "git merge-base --is-ancestor $sourceCommit origin/main",
    );
    expect(release).toContain(
      "needs: package\n    if: github.event_name == 'workflow_dispatch' && inputs.publish",
    );
    expect(release).toContain(
      'tag="desktop-preview-${SOURCE_SHA:0:12}-${RUN_NUMBER}"',
    );
    expect(release).toContain(
      '--target "$SOURCE_SHA" --prerelease --latest=false',
    );
    expect(release).not.toContain("--clobber");
    expect(workflow).not.toContain("pull_request_target:");
  });
});
