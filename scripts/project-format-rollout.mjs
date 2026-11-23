import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const formatPath = "packages/project-protocol/src/file-format.json";
const overseas = "https://analog-canvas-origin.tokenzhang.com";
const domestic = "https://canvas-hangzhou-origin.tokenzhang.com";

function checked(format) {
  if (
    !Number.isSafeInteger(format?.read) ||
    !Number.isSafeInteger(format?.write) ||
    format.write < 1 ||
    format.read < format.write
  )
    throw new Error("Invalid Project reader/writer capability");
  return format;
}

export async function checkProjectFormatRollout(
  previous,
  candidate,
  getDomestic,
) {
  checked(previous);
  checked(candidate);
  if (candidate.read < previous.read || candidate.write < previous.write)
    throw new Error("Project format downgrade would endanger saved data");
  if (candidate.write === previous.write) return;
  if (candidate.write > previous.read)
    throw new Error(
      "Deploy the compatible overseas reader before enabling this writer",
    );
  const peer = checked(await getDomestic());
  if (candidate.write > peer.read)
    throw new Error(
      "Wait for the compatible domestic reader before enabling this writer",
    );
}

async function json(url) {
  const response = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      `Project format check returned ${response.status} at ${url}`,
    );
  return response.json();
}

function overseasFormatAt(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error("Invalid overseas release identity");
  execFileSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"]);
  const show = (path) =>
    execFileSync("git", ["show", `${commit}:${path}`], { encoding: "utf8" });
  const paths = execFileSync(
    "git",
    ["ls-tree", "--name-only", commit, "--", formatPath],
    { encoding: "utf8" },
  );
  if (paths.trim() === formatPath) return checked(JSON.parse(show(formatPath)));
  // The last release before reader-first rollout used one literal for reading
  // and writing. Derive that capability from the exact deployed commit.
  const version = Number(
    show("packages/project-protocol/src/owned-project-file.ts").match(
      /^export const CURRENT_PROJECT_FILE_VERSION = (\d+);$/mu,
    )?.[1],
  );
  return checked({ read: version, write: version });
}

// Pin the proof to this attempt and check the live pointer again after
// reading Hangzhou. An older successful run cannot enable a newer writer.
export async function guardPublishedFormat(
  candidate,
  { get = json, formatAt = overseasFormatAt } = {},
) {
  const current = overseas + "/regional-release/current.json";
  const pointer = await get(current);
  const { commit, sha256, attempt } = pointer;
  await checkProjectFormatRollout(formatAt(commit), candidate, async () => {
    if (
      !/^[0-9a-f]{40}$/.test(commit) ||
      !/^[0-9a-f]{64}$/.test(sha256) ||
      !/^[1-9][0-9]*-[1-9][0-9]*$/.test(attempt) ||
      pointer.manifest !== `/regional-release/${commit}/release.json`
    )
      throw new Error("Invalid overseas verification identity");
    const receipt = await get(
      `${overseas}/api/regional-release/verification/${commit}/${sha256}/${attempt}`,
    );
    if (
      receipt?.schemaVersion !== 1 ||
      receipt.verified !== true ||
      receipt.commit !== commit ||
      receipt.sha256 !== sha256 ||
      receipt.attempt !== attempt
    )
      throw new Error(
        "The overseas receipt does not verify the currently serving release",
      );
    const domesticFormat = await get(
      domestic + "/regional-release/project-format.json",
    );
    const live = await get(current);
    if (
      live.commit !== commit ||
      live.sha256 !== sha256 ||
      live.attempt !== attempt ||
      live.manifest !== pointer.manifest
    )
      throw new Error(
        "The overseas release changed during Project writer preflight",
      );
    return domesticFormat;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const candidate = JSON.parse(await readFile(formatPath, "utf8"));
  await guardPublishedFormat(candidate);
  console.log(
    `Project format ready: reads through ${candidate.read}, writes ${candidate.write}`,
  );
}
