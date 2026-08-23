const testFile = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u;
const implementationFile = /\.(?:[cm]?[jt]sx?)$/u;

function normalized(path) {
  return path.replaceAll("\\", "/");
}

export function testPathKind(path) {
  const value = normalized(path);
  if (testFile.test(value) || value.startsWith("apps/editor/e2e/")) {
    return "test";
  }
  if (
    ((value.startsWith("apps/") || value.startsWith("packages/")) &&
      value.includes("/src/") &&
      implementationFile.test(value)) ||
    (value.startsWith("worker/") && implementationFile.test(value)) ||
    (value.startsWith("scripts/") && implementationFile.test(value))
  ) {
    return "implementation";
  }
  return "other";
}

/**
 * Read the `Test-Impact:` trailers out of commit messages.
 *
 * The declaration lives in the commit that makes the change, so it travels
 * with the diff in `git log`, `git blame`, and the pull request — it does not
 * need a file of its own.
 *
 *     Test-Impact: tests-updated
 *     Test-Impact: no-test-change — <evidence>
 *
 * `no-test-change` must carry its evidence on the same line; a bare
 * declaration would assert the conclusion without the reason.
 */
export function readTestImpactTrailers(messages) {
  const trailer = /^Test-Impact:[ \t]*(tests-updated|no-test-change)\b(.*)$/gmu;
  const declarations = [];
  for (const message of messages) {
    for (const match of message.matchAll(trailer)) {
      const decision = match[1];
      const evidence = (match[2] ?? "").replace(/^[\s—:-]+/u, "").trim();
      if (decision === "no-test-change" && evidence.length === 0) {
        declarations.push({
          valid: false,
          reason: "no-test-change requires evidence on the same line",
        });
        continue;
      }
      declarations.push({ valid: true, decision });
    }
  }
  return declarations;
}

/**
 * Decide whether a production-code diff records an auditable test decision.
 * This intentionally does not require a changed test file for cosmetic or
 * proven behavior-neutral work; it requires the commit to say why instead.
 */
export function assessTestImpact(paths, declarations) {
  const implementationPaths = paths.filter(
    (path) => testPathKind(path) === "implementation",
  );
  if (implementationPaths.length === 0) {
    return { ok: true, message: "No implementation paths changed." };
  }

  const testPaths = paths.filter((path) => testPathKind(path) === "test");
  const invalid = declarations.find((declaration) => !declaration.valid);
  if (invalid) {
    return {
      ok: false,
      message: `Invalid Test-Impact trailer (${invalid.reason}).`,
    };
  }
  const decisions = declarations.map((declaration) => declaration.decision);
  if (decisions.length === 0) {
    return {
      ok: false,
      message:
        "Implementation changes require a Test-Impact trailer in a commit message.",
    };
  }
  if (testPaths.length > 0 && decisions.includes("tests-updated")) {
    return { ok: true, message: "Tests changed and a commit records them." };
  }
  if (testPaths.length === 0 && decisions.includes("no-test-change")) {
    return {
      ok: true,
      message: "No tests changed; a commit records the evidence-based reason.",
    };
  }
  return {
    ok: false,
    message:
      testPaths.length > 0
        ? "Changed tests require Test-Impact: tests-updated."
        : "Implementation changes without tests require Test-Impact: no-test-change plus evidence.",
  };
}
