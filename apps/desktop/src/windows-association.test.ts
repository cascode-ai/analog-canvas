import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { windowsAssociation } from "./windows-association";

describe.skipIf(process.platform !== "win32")(
  "Windows project association",
  () => {
    it("registers and removes this executable only under an isolated per-user key", async () => {
      const root = `Software\\AnalogCanvasAcceptance\\${randomUUID()}`;
      try {
        expect(
          await windowsAssociation("read", process.execPath, root),
        ).toEqual({ enabled: false, otherInstallation: false });
        expect(
          (await windowsAssociation("enable", process.execPath, root)).enabled,
        ).toBe(true);
        expect(
          (await windowsAssociation("read", process.execPath, root)).enabled,
        ).toBe(true);
        expect(
          (await windowsAssociation("disable", process.execPath, root)).enabled,
        ).toBe(false);
        const removedDefault = await promisify(execFile)(
          "reg.exe",
          ["query", `HKCU\\${root}\\.icproj`, "/ve"],
          { windowsHide: true },
        );
        expect(removedDefault.stdout).not.toContain(
          "Cascode.AnalogCanvas.Project",
        );
        await promisify(execFile)(
          "reg.exe",
          [
            "add",
            `HKCU\\${root}\\.icproj`,
            "/ve",
            "/t",
            "REG_SZ",
            "/d",
            "Other.Project",
            "/f",
          ],
          { windowsHide: true },
        );
        await windowsAssociation("enable", process.execPath, root);
        await windowsAssociation("disable", process.execPath, root);
        const otherDefault = await promisify(execFile)(
          "reg.exe",
          ["query", `HKCU\\${root}\\.icproj`, "/ve"],
          { windowsHide: true },
        );
        expect(otherDefault.stdout).toContain("Other.Project");
      } finally {
        await promisify(execFile)(
          "reg.exe",
          ["delete", `HKCU\\${root}`, "/f"],
          { windowsHide: true },
        );
      }
    }, 30000);
  },
);
