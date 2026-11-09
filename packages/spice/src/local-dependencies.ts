import {
  decodeSourceContent,
  isExternalLibraryPath,
  isSpectreSource,
} from "./source.js";
import { spectreSourceIncludes } from "./conversion.js";
import { parseSpiceSource } from "./syntax.js";
import type { SpiceSourceInput } from "./source-types.js";

/** Fetch paths declared in RNL records. The browser runtime interprets the records. */
function packageReferences(text: string, packageFile: boolean): string[] {
  if (!packageFile && !text.includes("@RNL")) return [];
  const records = packageFile
    ? text
    : text
        .split(/\r\n?|\n/u)
        .map((line) => /^(?:\*|\/\/) (.*)$/u.exec(line)?.[1] ?? "\u0000")
        .join("\n");
  const paths: string[] = [];
  let depth = 0;
  for (const [token, opening, attributes] of records.matchAll(
    /(^@RNL\b(?:\([^\r\n)]*\))?\s*\{)|"(?:[^"\\]|\\.)*"|\/\/[^\r\n]*|@USE-PACKAGE\s*\(((?:"(?:[^"\\]|\\.)*"|[^"()\u0000])*)\)|[{}\u0000]/gmu,
  )) {
    if (opening) depth = 1;
    else if (token === "\u0000") depth = 0;
    else if (depth && token === "{") depth++;
    else if (depth && token === "}") depth--;
    else if (depth === 1 && attributes) {
      const path = /(?:^|,)\s*path\s*=\s*("(?:[^"\\]|\\.)*")/u.exec(attributes);
      if (path) paths.push(JSON.parse(path[1]!) as string);
    }
  }
  return paths;
}

/** The dependencies of the original bytes, before any frontend conversion. */
export function localSourceReferences(
  input: SpiceSourceInput,
  packageFile: boolean,
) {
  const { path: name, bytes } = input;
  const content = decodeSourceContent(bytes);
  const references = packageReferences(content.text, packageFile).map(
    (path) => ({
      path,
      packageFile: true,
      reference: `${name} @USE-PACKAGE`,
    }),
  );
  if (packageFile) return references;
  const includes = isSpectreSource(input)
    ? spectreSourceIncludes(content.text)
    : parseSpiceSource({
        path: name,
        id: name,
        hash: "",
        ...content,
      }).statements.flatMap((statement) => {
        const path =
          statement.kind === "include" ||
          (statement.kind === "library" && statement.mode === "include")
            ? statement.requestedPath
            : undefined;
        return path ? [{ path, line: statement.sourceRef.start.line }] : [];
      });
  for (const { path, line } of includes) {
    // Foundry libraries remain references in the user's simulator.
    if (!isExternalLibraryPath(path))
      references.push({
        path,
        packageFile: false,
        reference: `${name}:${line}`,
      });
  }
  return references;
}
