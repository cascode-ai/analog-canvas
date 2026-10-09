import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { codexMcpConfig } from "./installation-config.js";
import {
  installationOrigin,
  installationDeclaration,
  verifyInstallationBytes,
  installMcp,
  stableNodeExecutable,
} from "./install.js";
import { probeInstalledMcp } from "./installation-probe.js";
import { MCP_SERVER_VERSION } from "./server.js";
import { AGENT_MCP_VERSION } from "@icm/agent-adapter";

const launch = {
  command: "C:\\node\\node.exe",
  args: ["C:\\local bundle\\mcp.mjs"],
  env: {
    ANALOG_CANVAS_API_URL: "https://analog-canvas-preview.tokenzhang.com",
  },
};
describe("verified offline MCP installation", () => {
  it("installs verified bytes, backs up host settings, launches offline through Homebrew's opt link and leaves settings intact on failed update", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-mcp-install-"));
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      const source = join(directory, "package", "bin");
      const codex = join(directory, "host");
      await mkdir(source, { recursive: true });
      await mkdir(codex);
      await writeFile(
        join(source, "analog-canvas-mcp.mjs"),
        `import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
const m=JSON.parse(line); if(!m.id)continue;
const result=m.method==='initialize'?{serverInfo:{name:'analog-canvas',version:'1.2.3'}}:{tools:['connect','connection_status','get_context','simulation'].map(name=>({name}))};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}`,
      );
      const archive = join(directory, "fixture.tgz");
      execFileSync("tar", ["-czf", archive, "-C", directory, "package"], {
        windowsHide: true,
      });
      const bytes = await readFile(archive);
      const manifest = {
        format: "analog-canvas-mcp-bootstrap-v1",
        version: "1.2.3",
        requirements: { node: ">=24.0.0" },
        distribution: {
          downloadUrl:
            "https://github.com/cascode-ai/analog-canvas/releases/download/mcp-v1.2.3/analog-canvas-mcp-server-1.2.3.tgz",
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      };
      fetchMock.mockImplementation(async (url) =>
        String(url).endsWith("mcp-manifest.json")
          ? Response.json(manifest)
          : new Response(bytes),
      );
      const original =
        'model = "keep"\n[mcp_servers.other]\ncommand = "unrelated"\n';
      const config = join(codex, "config.toml");
      await writeFile(config, original);
      // Homebrew runs Node from a versioned Cellar directory that the next
      // `brew upgrade` removes; the host launches it through the formula's
      // `opt` link, which follows upgrades.
      const brew = join(directory, "brew");
      const cellarNode = join(
        brew,
        "Cellar",
        "node",
        "25.8.1_1",
        "bin",
        "node",
      );
      await mkdir(dirname(cellarNode), { recursive: true });
      // The core offline installation contract also runs on Windows,
      // whose executable naming and symlink privileges differ from Homebrew.
      const node = process.platform === "win32" ? process.execPath : cellarNode;
      if (process.platform !== "win32") {
        await symlink(process.execPath, cellarNode);
        await mkdir(join(brew, "opt"));
        await symlink(
          join("..", "Cellar", "node", "25.8.1_1"),
          join(brew, "opt", "node"),
          "dir",
        );
      }
      const installed = await installMcp(
        ["--origin", launch.env.ANALOG_CANVAS_API_URL, "--host", "codex"],
        { home: directory, codex, execPath: node },
      );
      expect(installed.launch.command).toBe(
        process.platform === "win32"
          ? process.execPath
          : join(brew, "opt", "node", "bin", "node"),
      );
      expect(installed.hostLoaded).toBe(false);
      expect(await readFile(installed.backupPath!, "utf8")).toBe(original);
      const configured = await readFile(config, "utf8");
      expect(configured).toContain(original.trim());
      expect(configured).toContain(launch.env.ANALOG_CANVAS_API_URL);
      expect(configured).toContain(
        `command = ${JSON.stringify(installed.launch.command)}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      fetchMock.mockRejectedValue(Error("offline"));
      await expect(
        probeInstalledMcp(
          installed.launch.command,
          installed.launch.args[0]!,
          "1.2.3",
        ),
      ).resolves.toMatchObject({ toolCount: 4 });
      await expect(
        installMcp(
          ["--origin", launch.env.ANALOG_CANVAS_API_URL, "--host", "codex"],
          { home: directory, codex },
        ),
      ).rejects.toThrow("offline");
      expect(await readFile(config, "utf8")).toBe(configured);
      fetchMock.mockImplementation(async (url) =>
        String(url).endsWith("mcp-manifest.json")
          ? Response.json(manifest)
          : new Response("tampered"),
      );
      await expect(
        installMcp(
          ["--origin", launch.env.ANALOG_CANVAS_API_URL, "--host", "codex"],
          { home: directory, codex },
        ),
      ).rejects.toThrow("integrity");
      expect(await readFile(config, "utf8")).toBe(configured);
      fetchMock.mockImplementation(async (url) =>
        String(url).endsWith("mcp-manifest.json")
          ? Response.json({
              ...manifest,
              version: "1.2.4",
              distribution: {
                ...manifest.distribution,
                downloadUrl: manifest.distribution.downloadUrl.replaceAll(
                  "1.2.3",
                  "1.2.4",
                ),
              },
            })
          : new Response(bytes),
      );
      await expect(
        installMcp(
          ["--origin", launch.env.ANALOG_CANVAS_API_URL, "--host", "codex"],
          { home: directory, codex },
        ),
      ).rejects.toThrow("identity");
      expect(await readFile(config, "utf8")).toBe(configured);
    } finally {
      fetchMock.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("keeps a Node path unless Homebrew's opt link names the same binary", async () => {
    for (const path of [
      "/usr/local/bin/node",
      "C:\\node\\node.exe",
      "/nonexistent/Cellar/node/1.0.0/bin/node",
    ])
      expect(stableNodeExecutable(path)).toBe(path);
    // An older Cellar Node still running after the formula moved on keeps
    // its own path: the host runs exactly the Node the probe checked.
    const brew = await mkdtemp(join(tmpdir(), "icm-mcp-brew-"));
    try {
      for (const version of ["24.1.0", "25.0.0"]) {
        await mkdir(join(brew, "Cellar", "node", version, "bin"), {
          recursive: true,
        });
        await writeFile(
          join(brew, "Cellar", "node", version, "bin", "node"),
          "",
        );
      }
      await mkdir(join(brew, "opt"));
      await symlink(
        process.platform === "win32"
          ? join(brew, "Cellar", "node", "25.0.0")
          : join("..", "Cellar", "node", "25.0.0"),
        join(brew, "opt", "node"),
        process.platform === "win32" ? "junction" : "dir",
      );
      // The resolver recognizes POSIX Homebrew paths; forward slashes also
      // let Windows execute the real filesystem-resolution contract.
      const older = join(
        brew,
        "Cellar",
        "node",
        "24.1.0",
        "bin",
        "node",
      ).replaceAll("\\", "/");
      expect(stableNodeExecutable(older)).toBe(older);
      expect(
        stableNodeExecutable(
          join(brew, "Cellar", "node", "25.0.0", "bin", "node").replaceAll(
            "\\",
            "/",
          ),
        ),
      ).toBe(join(brew, "opt", "node", "bin", "node"));
    } finally {
      await rm(brew, { recursive: true, force: true });
    }
  });
  it("preserves unrelated servers, host settings and env while replacing multiline npx args", () => {
    const original =
      'model = "keep"\n[mcp_servers.other]\ncommand = "keep"\n[mcp_servers."analog-canvas"]\ncommand = "npx"\nargs = [\n  "old",\n]\nstartup_timeout_sec = 50\n[mcp_servers."analog-canvas".env]\nCUSTOM = "keep"\nANALOG_CANVAS_API_URL = "https://old.example"\n';
    const result = codexMcpConfig(original, "analog-canvas", launch);
    expect(result).toContain(
      'model = "keep"\n[mcp_servers.other]\ncommand = "keep"',
    );
    expect(result).toContain('CUSTOM = "keep"');
    expect(result).toContain("startup_timeout_sec = 50");
    expect(result).toContain(`args = ${JSON.stringify(launch.args)}`);
    expect(result).not.toContain('"npx"');
    expect(codexMcpConfig(result, "analog-canvas", launch)).toBe(result);
  });
  it("refuses ambiguous duplicate config and preserves literal table names", () => {
    expect(() =>
      codexMcpConfig(
        '[mcp_servers.analog-canvas]\n[mcp_servers."analog-canvas"]',
        "analog-canvas",
        launch,
      ),
    ).toThrow("duplicate");
    expect(
      codexMcpConfig(
        "[mcp_servers.'analog-canvas']\ncommand = 'npx'\n",
        "analog-canvas",
        launch,
      ).match(/\[mcp_servers\.'analog-canvas'\]/gu),
    ).toHaveLength(1);
  });
  it("does not confuse environments or accept credentials in origins", () => {
    expect(
      installationOrigin("https://analog-canvas-preview.tokenzhang.com/"),
    ).toBe(launch.env.ANALOG_CANVAS_API_URL);
    for (const url of [
      "http://remote.example",
      "https://u:p@example.com",
      "https://example.com/path",
      "https://example.com/?token=secret",
    ])
      expect(() => installationOrigin(url)).toThrow();
    expect(installationOrigin("http://localhost:5173")).toBe(
      "http://localhost:5173",
    );
  });
  it("rejects digest tampering and arbitrary distribution URLs", () => {
    const bytes = Buffer.from("bundle");
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(() => verifyInstallationBytes(bytes, sha)).not.toThrow();
    expect(() => verifyInstallationBytes(Buffer.from("changed"), sha)).toThrow(
      "integrity",
    );
    expect(() =>
      installationDeclaration({
        format: "analog-canvas-mcp-bootstrap-v1",
        version: "1.0.0",
        requirements: { node: ">=24.0.0" },
        distribution: {
          downloadUrl: "https://other.example/file",
          sha256: sha,
        },
      }),
    ).toThrow("distribution");
    expect(MCP_SERVER_VERSION).toBe(AGENT_MCP_VERSION);
  });
  it("performs actual stdio handshake and tool listing without a server; rejects stale runtime version", async () => {
    const directory = await mkdtemp(join(tmpdir(), "icm-mcp-probe-"));
    try {
      const file = join(directory, "probe.mjs");
      await writeFile(
        file,
        `import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})) {
 const m=JSON.parse(line); if(!m.id) continue;
 const result=m.method==='initialize'?{serverInfo:{name:'analog-canvas',version:'1.2.3'}}:{tools:['connect','connection_status','get_context','simulation'].map(name=>({name}))};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}`,
      );
      await expect(
        probeInstalledMcp(process.execPath, file, "1.2.3"),
      ).resolves.toEqual({ version: "1.2.3", toolCount: 4 });
      await expect(
        probeInstalledMcp(process.execPath, file, "1.2.4"),
      ).rejects.toThrow("identity");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
