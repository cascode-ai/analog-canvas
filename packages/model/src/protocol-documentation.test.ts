import { CURRENT_PROJECT_FILE_VERSION } from "@icm/project-protocol";
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
      [
        "docs/specs/persistence-and-recovery.md",
        `schema-${CURRENT_PROJECT_FILE_VERSION}`,
      ],
      [
        "docs/specs/project-file-format.md",
        `Portable file schema: \`${CURRENT_PROJECT_FILE_VERSION}\``,
      ],
      [
        "docs/specs/project-file-format.md",
        `normalized editor model schema: \`${version}\``,
      ],
      ["docs/specs/community-gallery.md", "CURRENT_PROJECT_FILE_VERSION"],
      [
        "docs/user/project-compatibility.md",
        `portable Project schema is \`${CURRENT_PROJECT_FILE_VERSION}\``,
      ],
    ] as const;

    // Interaction documentation delegates compatibility to the file-format
    // owner. Check the version declarations there instead of requiring copies.
    for (const [relativePath, expected] of expectations) {
      expect(readRepositoryText(relativePath), relativePath).toContain(
        expected,
      );
    }
  });
});
