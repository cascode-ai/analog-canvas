import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CURRENT_PROJECT_SCHEMA_VERSION } from "./schema.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readRepositoryText(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("Project protocol documentation", () => {
  it("tracks the executable current Project schema and rolling read policy", () => {
    const version = CURRENT_PROJECT_SCHEMA_VERSION;
    const expectations = [
      ["docs/overall-product-plan.md", `schema-${version}`],
      ["docs/specs/schematic-model.md", `strict schema ${version}`],
      ["docs/specs/persistence-and-recovery.md", `schema-${version}`],
      ["docs/specs/project-file-format.md", `Project schema: \`${version}\``],
      ["docs/specs/editor-interaction.md", `schema-${version}`],
      ["docs/adr/0040-connectivity-evidence.md", `schema ${version}`],
      [
        "docs/user/project-compatibility.md",
        `schema version is \`${version}\``,
      ],
    ] as const;

    for (const [relativePath, expected] of expectations) {
      expect(readRepositoryText(relativePath), relativePath).toContain(
        expected,
      );
    }
  });
});
