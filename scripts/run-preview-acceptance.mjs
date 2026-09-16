import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const previewAcceptanceGroups = [
  {
    id: "simulation-qualification",
    commands: [
      {
        script: "scripts/preview-dual-engine-smoke.mjs",
        args: ["--ota", "--failures"],
        env: { ICM_ACCEPTANCE_MCP_SOURCE: "published" },
      },
      { script: "scripts/preview-simulation-smoke.mjs", args: [] },
    ],
  },
  {
    id: "product-journeys",
    commands: [
      {
        script: "scripts/preview-agent-simulation-journey.mjs",
        args: [],
        env: { ICM_ACCEPTANCE_MCP_SOURCE: "published" },
      },
      { script: "scripts/preview-source-gui-journey.mjs", args: [] },
      {
        script: "scripts/preview-cross-project-simulation-journey.mjs",
        args: [],
      },
    ],
  },
];

function runCommand(command, baseUrl, { spawnProcess, environment }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      process.execPath,
      [command.script, baseUrl, ...command.args],
      {
        env: { ...environment, ...command.env },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command.script} exited ${code ?? `from signal ${signal ?? "unknown"}`}`,
          ),
        );
    });
  });
}

export async function runPreviewAcceptance(
  baseUrl,
  { spawnProcess = spawn, environment = process.env, logger = console } = {},
) {
  const origin = new URL(baseUrl).origin;
  const outcomes = await Promise.allSettled(
    previewAcceptanceGroups.map(async (group) => {
      logger.log(`Starting Preview acceptance lane: ${group.id}`);
      for (const command of group.commands)
        await runCommand(command, origin, { spawnProcess, environment });
      logger.log(`Completed Preview acceptance lane: ${group.id}`);
    }),
  );
  const failures = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "Preview acceptance failed");
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl)
    throw new Error(
      "usage: node scripts/run-preview-acceptance.mjs https://preview.example",
    );
  await runPreviewAcceptance(baseUrl);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof AggregateError)
      for (const cause of error.errors)
        console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  });
