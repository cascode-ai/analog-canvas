import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { codexMcpConfig } from "./installation-config.js";
import { probeInstalledMcp } from "./installation-probe.js";
import {
  InstallationFailure,
  installationFailureAt,
  installationSystemCode,
  type InstallationStage,
} from "./installation-diagnostics.js";

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
    throw new InstallationFailure(
      "manifest",
      "MANIFEST_INVALID",
      "Unsupported MCP manifest or runtime requirement",
      "stop",
    );
  const version = m.version!;
  const url = `https://github.com/cascode-ai/analog-canvas/releases/download/mcp-v${version}/analog-canvas-mcp-server-${version}.tgz`;
  if (
    m.distribution?.downloadUrl !== url ||
    !/^[a-f0-9]{64}$/u.test(m.distribution.sha256 ?? "")
  )
    throw new InstallationFailure(
      "manifest",
      "MANIFEST_INVALID",
      "Invalid pinned MCP distribution",
      "stop",
    );
  return { version, url, sha256: m.distribution.sha256! };
}

export function verifyInstallationBytes(bytes: Uint8Array, sha256: string) {
  if (createHash("sha256").update(bytes).digest("hex") !== sha256)
    throw new InstallationFailure(
      "integrity",
      "PACKAGE_INTEGRITY_FAILED",
      "MCP package integrity check failed; configuration unchanged",
      "stop",
    );
}

/**
 * The Node a host launches: the one running the installer, but through
 * Homebrew's per-formula `opt` link when it runs from a versioned Cellar
 * directory, which the next `brew upgrade` removes. The link follows the
 * formula's upgrades; any other path is kept as it is.
 */
export function stableNodeExecutable(execPath: string): string {
  const cellar =
    /^(?<prefix>.+)\/Cellar\/(?<formula>[^/]+)\/[^/]+\/bin\/node$/u.exec(
      execPath,
    )?.groups;
  if (!cellar) return execPath;
  const linked = join(cellar.prefix!, "opt", cellar.formula!, "bin", "node");
  try {
    return realpathSync(linked) === realpathSync(execPath) ? linked : execPath;
  } catch {
    return execPath;
  }
}

async function download(
  url: string,
  limit: number,
  stage: "manifest" | "download",
) {
  for (let attempt = 0; ; attempt++) {
    let status: number | undefined;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      status = response.status;
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw Error("HTTP failure");
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit)
          throw new InstallationFailure(
            stage,
            "DOWNLOAD_TOO_LARGE",
            "MCP download exceeds installation limit",
            "stop",
          );
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error instanceof InstallationFailure) throw error;
      const systemCode = installationSystemCode(error);
      const transient =
        status === undefined
          ? systemCode === undefined ||
            [
              "ENOTFOUND",
              "EAI_AGAIN",
              "ECONNRESET",
              "ECONNREFUSED",
              "ETIMEDOUT",
              "ENETUNREACH",
              "EHOSTUNREACH",
              "UND_ERR_CONNECT_TIMEOUT",
              "UND_ERR_SOCKET",
            ].includes(systemCode)
          : status === 429 || status >= 500 || status === 200;
      if (attempt === 0 && transient) continue;
      throw new InstallationFailure(
        stage,
        stage === "manifest"
          ? "MANIFEST_FETCH_FAILED"
          : "PACKAGE_DOWNLOAD_FAILED",
        `MCP ${stage} failed; the Editor HTTP Kit may still be reachable`,
        "use-http-kit",
        {
          ...(status === undefined ? {} : { httpStatus: status }),
          ...(systemCode ? { systemCode } : {}),
        },
      );
    }
  }
}

/** Network is used only here. Steady-state launch is absolute Node + local bundle. */
export async function installMcp(
  args: string[],
  locations: { home?: string; codex?: string; execPath?: string } = {},
) {
  let stage: InstallationStage = "arguments";
  try {
    if (Number(process.versions.node.split(".")[0]) < 24)
      throw new InstallationFailure(
        "runtime",
        "NODE_VERSION_UNSUPPORTED",
        "Node.js 24 or newer is required",
        "use-http-kit",
        { actual: process.versions.node, required: ">=24.0.0" },
      );
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
    stage = "manifest";
    const declaration = installationDeclaration(
      JSON.parse(
        (
          await download(
            `${origin}/api/agent/mcp-manifest.json`,
            128_000,
            "manifest",
          )
        ).toString("utf8"),
      ),
    );
    const bytes = await download(declaration.url, 24_000_000, "download");
    verifyInstallationBytes(bytes, declaration.sha256);
    stage = "extract";
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
      {
        maxBuffer: 16_000_000,
        timeout: 30_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await writeFile(executable, program, { mode: 0o600, flag: "wx" });
    // Local mode (#1498) loads the headless workspace from beside the adapter;
    // a package that ships one installs it there too. An older package has
    // none, and still installs.
    const headlessEntry = "package/bin/analog-canvas-headless.mjs";
    const entries = execFileSync("tar", ["-tf", archive], {
      encoding: "utf8",
      maxBuffer: 4_000_000,
      timeout: 30_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).split(/\r?\n/u);
    if (entries.includes(headlessEntry))
      await writeFile(
        join(directory, "analog-canvas-headless.mjs"),
        execFileSync("tar", ["-xOf", archive, headlessEntry], {
          maxBuffer: 24_000_000,
          timeout: 30_000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        }),
        { mode: 0o600, flag: "wx" },
      );
    // The probe starts the bundle exactly as the host will.
    const node = stableNodeExecutable(locations.execPath ?? process.execPath);
    stage = "local-probe";
    const readiness = await probeInstalledMcp(
      node,
      executable,
      declaration.version,
    );
    const launch = {
      command: node,
      args: [executable],
      env: { ANALOG_CANVAS_API_URL: origin },
    };
    let configPath: string | undefined;
    let backupPath: string | undefined;
    stage = "host-config";
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
        throw new InstallationFailure(
          "host-config",
          "HOST_CONFIG_CHANGED",
          "Host configuration changed during installation; configuration not replaced",
          "stop",
        );
      await rename(temporary, configPath);
    }
    return {
      installed: true,
      hostLoaded: false,
      stage: "host-loading" as const,
      nextAction: "verify-host-tools" as const,
      origin,
      ...readiness,
      configPath,
      backupPath,
      launch,
      message:
        "Local MCP initialize/tools/list passed; host loading is unverified. Verify callable tools in this conversation. If a reload is needed, preserve this installation and use the raw HTTP Kit only when the connection request authorizes fallback. Pair and read the Editor circuit before reporting connection success.",
    };
  } catch (error) {
    throw installationFailureAt(stage, error);
  }
}
