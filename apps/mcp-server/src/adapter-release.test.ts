import { describe, expect, it } from "vitest";
import { agentMcpBootstrapManifest } from "@icm/agent-adapter";
import { adapterRelease } from "./adapter-release.js";

const ORIGIN = "https://editor.example";
const URL = `${ORIGIN}/api/agent/mcp-manifest.json`;

/** The manifest the Worker serves, naming `version` as the latest release. */
function manifest(version: string) {
  return { ...agentMcpBootstrapManifest(ORIGIN), version };
}

describe("adapter release (#1844)", () => {
  it("is outdated before the manifest's release, with its exact upgrade step", () => {
    const served = manifest("0.18.0");
    const release = adapterRelease("0.17.83", served, URL);
    expect(release).toEqual({
      latestVersion: "0.18.0",
      outdated: true,
      upgrade: {
        manifestUrl: URL,
        hosts: {
          codex: served.hosts.codex.command,
          claudeCode: served.hosts.claudeCode.command,
        },
        note: served.installation.note,
      },
      message: expect.stringContaining("older than the latest release"),
    });
  });

  it("compares versions as numbers, not strings", () => {
    // As strings "0.17.9" sorts after "0.17.83" and "0.17.100" before it.
    expect(adapterRelease("0.17.83", manifest("0.17.9"), URL)).toEqual({
      latestVersion: "0.17.9",
      outdated: false,
    });
    expect(adapterRelease("0.17.83", manifest("0.17.100"), URL)).toMatchObject({
      latestVersion: "0.17.100",
      outdated: true,
    });
    expect(adapterRelease("0.9.0", manifest("0.10.0"), URL)?.outdated).toBe(
      true,
    );
  });

  it("gives no warning to the latest release or a newer one", () => {
    expect(adapterRelease("0.17.83", manifest("0.17.83"), URL)).toEqual({
      latestVersion: "0.17.83",
      outdated: false,
    });
    expect(adapterRelease("1.0.0", manifest("0.17.83"), URL)).toEqual({
      latestVersion: "0.17.83",
      outdated: false,
    });
  });

  it("knows no release from a missing or unreadable manifest", () => {
    for (const unreadable of [
      null,
      "not json",
      {},
      { version: "latest" },
      { version: "1.2" },
    ])
      expect(adapterRelease("0.17.83", unreadable, URL)).toBeNull();
  });

  it("points at the manifest when it names no host commands", () => {
    expect(adapterRelease("0.17.83", { version: "0.18.0" }, URL)).toMatchObject(
      {
        outdated: true,
        upgrade: { manifestUrl: URL },
        message: expect.stringContaining("upgrade.manifestUrl"),
      },
    );
  });
});
