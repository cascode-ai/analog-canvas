import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { syncInterfaces } from "./mcp-release-interfaces.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function temporaryCopy() {
  const root = mkdtempSync(join(tmpdir(), "icm-mcp-interfaces-"));
  roots.push(root);
  return join(root, "interfaces.json");
}

describe("MCP release interfaces", () => {
  it("fails the check when an interface version changes without regenerating", async () => {
    const path = temporaryCopy();
    await syncInterfaces({ path });
    const generated = JSON.parse(readFileSync(path, "utf8"));
    generated.interfaces["project-file"].writes -= 1;
    writeFileSync(path, `${JSON.stringify(generated, null, 2)}\n`);

    await expect(syncInterfaces({ path, check: true })).rejects.toThrow(
      /interfaces\.json is stale.*pnpm mcp:interfaces/su,
    );
  });
});
