import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

// Same byte identity convention as the historical hosted Profile. Reference
// acquisition is local/read-only; this helper is never a product executor.
export function referenceModelTreeSha256(root) {
  const hash = createHash("sha256");
  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile())
        throw Error(`Reference model tree contains a non-file: ${path}`);
      const bytes = readFileSync(path);
      hash.update(JSON.stringify(relative(root, path).replaceAll("\\", "/")));
      hash.update("\0" + bytes.byteLength + "\0");
      hash.update(bytes);
      hash.update("\0");
    }
  };
  visit(root);
  return hash.digest("hex");
}

// Applied only after exact original-tree verification. Preserve every other
// source byte, including comments, model coefficients and continuation layout.
export function upgradeReferenceModelVersions(text) {
  const counts = {};
  const upgraded = text.replace(
    /^(?![ \t]*\*)[^\r\n]*\bversion[ \t]*=[ \t]*[^\r\n]*/gimu,
    (line) =>
      line.replace(
        /\bversion\s*=\s*(\d+(?:\.\d+)+)(?=\s|$)/giu,
        (assignment, version) => {
          if (!["4.5", "4.62"].includes(version))
            throw Error(`Unexpected reference BSIM version: ${version}`);
          counts[version] = (counts[version] ?? 0) + 1;
          return assignment.replace(version, "4.8.3");
        },
      ),
  );
  return { text: upgraded, counts };
}
