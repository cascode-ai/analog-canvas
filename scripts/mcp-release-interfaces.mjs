// The interface versions an MCP release publishes for plugins as its
// `interfaces.json` asset (docs/specs/plugins.md): for each interface, the
// version this build writes and the oldest version it still reads. The
// committed copy shows a change in review; packaging writes the asset from
// the code itself.
//
//   pnpm mcp:interfaces          rewrite apps/mcp-server/interfaces.json
//   pnpm mcp:interfaces:check    fail when that copy differs from the code
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { AGENT_API_VERSION } from "@icm/agent-adapter";
import {
  CURRENT_PROJECT_FILE_VERSION,
  OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION,
} from "@icm/project-protocol";

import rnlLine from "../packages/rnl/src/rnl-version-line.json" with { type: "json" };

const committedPath = resolve(
  import.meta.dirname,
  "../apps/mcp-server/interfaces.json",
);

/** The `interfaces.json` text this build publishes. */
export function interfacesText() {
  const interfaces = {
    schemaVersion: 1,
    interfaces: {
      "project-file": {
        writes: CURRENT_PROJECT_FILE_VERSION,
        oldestRead: OLDEST_SUPPORTED_PROJECT_SCHEMA_VERSION,
      },
      // A file of an earlier language comes in without its drawing.
      rnl: { writes: rnlLine.language, oldestRead: rnlLine.language },
      // A request of any other apiVersion gets the version diagnostic.
      "agent-api": { writes: AGENT_API_VERSION, oldestRead: AGENT_API_VERSION },
    },
  };
  return `${JSON.stringify(interfaces, null, 2)}\n`;
}

/** Rewrite the committed copy, or with `check` fail when it is stale. */
export async function syncInterfaces({
  path = committedPath,
  check = false,
} = {}) {
  const text = interfacesText();
  if (!check) return writeFile(path, text, "utf8");
  const current = await readFile(path, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (current !== text)
    throw new Error(
      `${path} is stale: the interface versions in code changed. Run pnpm mcp:interfaces and commit it.`,
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const check = process.argv.includes("--check");
  await syncInterfaces({ check });
  console.log(`${check ? "Validated" : "Wrote"} the MCP release interfaces`);
}
