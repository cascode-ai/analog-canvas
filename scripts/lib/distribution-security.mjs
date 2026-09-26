import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { unzipSync } from "fflate";

// Source is intentionally public. Credentials, developer config and user data
// are not corresponding source and must never become distribution contents.
export function assertPublicDistributionPath(path) {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    segments.includes("..") ||
    segments.some((part) =>
      /^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.wrangler|\.npmrc|\.netrc|\.pypirc|Cookies(?:-journal)?|Login Data(?:-journal)?|Local State|id_rsa|id_ed25519|credentials(?:\.json)?|service-account.*\.json)$/iu.test(
        part,
      ),
    ) ||
    /\.(?:pem|key|p12|pfx|sqlite3?|db|map)$/iu.test(normalized)
  ) {
    throw new Error(`Private/configuration path is not distributable: ${path}`);
  }
}

export function inspectSourceArchive(bytes) {
  let count = 0;
  // Parse the actual central directory without extracting any files to disk.
  unzipSync(bytes, {
    filter(file) {
      assertPublicDistributionPath(file.name);
      count += 1;
      return false;
    },
  });
  if (!count) throw new Error("Corresponding source archive is empty");
  return count;
}

export async function inspectDistributionDirectory(directory) {
  let files = 0;
  let sourceEntries = 0;
  async function visit(relative = "") {
    for (const entry of await readdir(join(directory, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      assertPublicDistributionPath(path);
      if (entry.isSymbolicLink())
        throw new Error(`Distribution symlinks are not supported: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        files += 1;
        if (path === "source.zip")
          sourceEntries = inspectSourceArchive(
            await readFile(join(directory, path)),
          );
      } else throw new Error(`Unsupported distribution entry: ${path}`);
    }
  }
  await visit();
  if (!sourceEntries) throw new Error("Corresponding source.zip is required");
  return { files, sourceEntries };
}

export function publicFinding(finding) {
  // Do not forward scanner Match, Secret, commit messages or source lines.
  return {
    rule: finding.RuleID,
    file: finding.File,
    line: finding.StartLine,
  };
}
