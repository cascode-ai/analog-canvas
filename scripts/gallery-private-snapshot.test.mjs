import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

function localSnapshot(run) {
  const directory = mkdtempSync(join(tmpdir(), "icm-gallery-local-"));
  try {
    if (process.platform === "win32") {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference = 'Stop'; $acl = New-Object System.Security.AccessControl.DirectorySecurity; $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl.SetOwner($user); $acl.SetAccessRuleProtection($true, $false); $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($user, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($env:ICM_SNAPSHOT_TEST_DIRECTORY, $acl)",
        ],
        { env: { ...process.env, ICM_SNAPSHOT_TEST_DIRECTORY: directory } },
      );
    }
    const db = new DatabaseSync(join(directory, "gallery.sqlite"));
    db.exec("CREATE TABLE gallery_entries (id TEXT PRIMARY KEY)");
    db.close();
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        consistentCapture: true,
        offlineRestoreVerified: true,
        captureEndedAt: "2026-10-06T00:00:00Z",
        tables: { gallery_entries: 0 },
      }),
    );
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function verify(directory) {
  return execFileSync(
    process.execPath,
    ["scripts/gallery-private-snapshot.mjs", "--local", directory],
    { encoding: "utf8" },
  );
}

describe("private Gallery snapshot CLI", () => {
  it("refuses hard-linked snapshot files", () => {
    localSnapshot((directory) => {
      linkSync(
        join(directory, "gallery.sqlite"),
        join(directory, "shared.sqlite"),
      );
      expect(() => verify(directory)).toThrow(/linked files/);
    });
  });
  it.skipIf(process.platform !== "win32")(
    "refuses an exposed file inside a private Windows directory",
    () => {
      localSnapshot((directory) => {
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference = 'Stop'; $acl = [System.IO.File]::GetAccessControl($env:ICM_SNAPSHOT_TEST_FILE); $everyone = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0'); $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($everyone, 'Read', 'Allow'); $acl.AddAccessRule($rule); [System.IO.File]::SetAccessControl($env:ICM_SNAPSHOT_TEST_FILE, $acl)",
          ],
          {
            env: {
              ...process.env,
              ICM_SNAPSHOT_TEST_FILE: join(directory, "manifest.json"),
            },
          },
        );
        expect(() => verify(directory)).toThrow(/grants access to other users/);
      });
    },
  );
  it("accepts an explicit verified local snapshot without a GitHub login", () => {
    localSnapshot((directory) => {
      expect(verify(directory)).toContain(
        `Gallery SQLite: ${join(directory, "gallery.sqlite")}`,
      );
    });
  });
  it("refuses local snapshots without offline verification", () => {
    localSnapshot((directory) => {
      writeFileSync(
        join(directory, "manifest.json"),
        JSON.stringify({ consistentCapture: true }),
      );
      expect(() => verify(directory)).toThrow(/offline verification/);
    });
  });
  it("refuses corrupted SQLite instead of reporting local acceptance", () => {
    localSnapshot((directory) => {
      writeFileSync(join(directory, "gallery.sqlite"), "not a SQLite snapshot");
      expect(() => verify(directory)).toThrow(/not a database|corrupt/i);
    });
  });
});
