import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { codexMcpConfig } from "./installation-config.js";
import { probeInstalledMcp } from "./installation-probe.js";

export function installationOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw Error(
      "Use an exact HTTPS server origin (HTTP is allowed only for loopback)",
    );
  return url.origin;
}

export function installationDeclaration(value: unknown) {
  const m = value as {
    format?: string;
    version?: string;
    requirements?: { node?: string };
    distribution?: { downloadUrl?: string; sha256?: string };
  };
  if (
    !m ||
    m.format !== "analog-canvas-mcp-bootstrap-v1" ||
    !/^\d+\.\d+\.\d+$/u.test(m.version ?? "") ||
    m.requirements?.node !== ">=24.0.0"
  )
    throw Error("Unsupported MCP manifest or runtime requirement");
  const version = m.version!;
  const url = `https://github.com/cascode-ai/analog-canvas/releases/download/mcp-v${version}/analog-canvas-mcp-server-${version}.tgz`;
  if (
    m.distribution?.downloadUrl !== url ||
    !/^[a-f0-9]{64}$/u.test(m.distribution.sha256 ?? "")
  )
    throw Error("Invalid pinned MCP distribution");
  return { version, url, sha256: m.distribution.sha256! };
}

export function verifyInstallationBytes(bytes: Uint8Array, sha256: string) {
  if (createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw Error("MCP package integrity check failed; configuration unchanged");
}

async function download(url: string, limit: number) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!response.ok || !response.body)
    throw Error("MCP download failed; retry installation later");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error("MCP download exceeds installation limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Network is used only here. Steady-state launch is absolute Node + local bundle. */
export async function installMcp(
  args: string[],
  locations: { home?: string; codex?: string } = {},
) {
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw Error("Node.js 24 or newer is required");
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (
      !key ||
      !["--origin", "--host"].includes(key) ||
      !value ||
      options.has(key)
    )
      throw Error(
        "Usage: --install --origin <server origin> --host codex|config",
      );
    options.set(key, value);
  }
  const origin = installationOrigin(options.get("--origin") ?? "");
  const host = options.get("--host") ?? "config";
  if (!["codex", "config"].includes(host))
    throw Error("Supported installation hosts: codex, config");
  const declaration = installationDeclaration(
    JSON.parse(
      (
        await download(`${origin}/api/agent/mcp-manifest.json`, 128_000)
      ).toString("utf8"),
    ),
  );
  const bytes = await download(declaration.url, 24_000_000);
  verifyInstallationBytes(bytes, declaration.sha256);
  // Unique immutable installation keeps an already-running/previous binary intact.
  const directory = join(
    locations.home ?? homedir(),
    ".analog-canvas",
    "mcp",
    `${declaration.version}-${declaration.sha256.slice(0, 12)}-${randomUUID()}`,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const archive = join(directory, "package.tgz");
  const executable = join(directory, "analog-canvas-mcp.mjs");
  await writeFile(archive, bytes, { mode: 0o600, flag: "wx" });
  const program = execFileSync(
    "tar",
    ["-xOf", archive, "package/bin/analog-canvas-mcp.mjs"],
    { maxBuffer: 16_000_000, timeout: 30_000, windowsHide: true },
  );
  await writeFile(executable, program, { mode: 0o600, flag: "wx" });
  const readiness = await probeInstalledMcp(
    process.execPath,
    executable,
    declaration.version,
  );
  const launch = {
    command: process.execPath,
    args: [executable],
    env: { ANALOG_CANVAS_API_URL: origin },
  };
  let configPath: string | undefined;
  let backupPath: string | undefined;
  if (host === "codex") {
    configPath = join(
      locations.codex ??
        (process.env.CODEX_HOME
          ? resolve(process.env.CODEX_HOME)
          : join(homedir(), ".codex")),
      "config.toml",
    );
    let previous: string | undefined;
    try {
      previous = await readFile(configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const next = codexMcpConfig(previous ?? "", "analog-canvas", launch);
    await mkdir(resolve(configPath, ".."), { recursive: true });
    if (previous !== undefined) {
      backupPath = `${configPath}.mcp-backup-${randomUUID()}`;
      await writeFile(backupPath, previous, { mode: 0o600, flag: "wx" });
    }
    const temporary = `${configPath}.mcp-${randomUUID()}`;
    await writeFile(temporary, next, { mode: 0o600, flag: "wx" });
    // Do not overwrite a concurrent host/user configuration edit.
    let current: string | undefined;
    try {
      current = await readFile(configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current !== previous)
      throw Error(
        "Host configuration changed during installation; configuration not replaced",
      );
    await rename(temporary, configPath);
  }
  return {
    installed: true,
    hostLoaded: false,
    origin,
    ...readiness,
    configPath,
    backupPath,
    launch,
    message:
      "Local MCP initialize/tools/list passed. Verify tools in the Agent host; a new conversation or host reload may be required. No HTTP fallback was used.",
  };
}
