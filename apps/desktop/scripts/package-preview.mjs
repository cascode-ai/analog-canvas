import {
  cp,
  mkdir,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { assertPublicDistributionPath } from "../../../scripts/lib/distribution-security.mjs";
import { rcedit } from "rcedit";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("This preview package targets Windows x64");
const dirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
if (dirty.trim())
  throw new Error("Commit the preview sources before producing a package");
const sourcePaths = execFileSync(
  "git",
  ["ls-tree", "-rz", "--name-only", "HEAD"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);
for (const path of sourcePaths) assertPublicDistributionPath(path);

// Unique output: never recursively remove a previous package or user data.
const staging = join(
  root,
  "output",
  `desktop-preview-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
const output = join(staging, "Analog-Canvas-Windows-x64");
const application = output;
await mkdir(application, { recursive: true });
await cp(dirname(require("electron")), application, { recursive: true });
// Preserve Electron's English fallback and both Chinese locale resources.
// All runtime libraries, fonts and original notices remain intact.
for (const entry of await readdir(join(application, "locales"))) {
  if (
    entry.endsWith(".pak") &&
    !["en-US.pak", "zh-CN.pak", "zh-TW.pak"].includes(entry)
  )
    await unlink(join(application, "locales", entry));
}
await rename(
  join(application, "electron.exe"),
  join(application, "Analog Canvas Preview.exe"),
);
// Set Explorer and taskbar branding on the distribution copy only.
await rcedit(join(application, "Analog Canvas Preview.exe"), {
  icon: join(root, "apps/desktop/dist/app.ico"),
  "version-string": {
    ProductName: "Analog Canvas Preview",
    FileDescription: "Analog Canvas offline schematic editor",
    OriginalFilename: "Analog Canvas Preview.exe",
  },
});
const appRoot = join(application, "resources/app");
await mkdir(appRoot, { recursive: true });
await cp(join(root, "apps/desktop/dist"), join(appRoot, "dist"), {
  recursive: true,
});
await cp(
  join(root, "apps/desktop/package.json"),
  join(appRoot, "package.json"),
);
await cp(
  join(root, "apps/editor/dist-desktop"),
  join(application, "resources/editor"),
  { recursive: true },
);
for (const file of ["README.md", "SOURCES.md", "upstream-NOTICE.md"])
  await cp(join(root, "apps/desktop", file), join(output, file));
await cp(join(root, "LICENSE.md"), join(output, "LICENSE.md"));
// Corresponding tracked source, including the explanatory attribution commit.
execFileSync(
  "git",
  ["archive", "--format=zip", `--output=${join(output, "source.zip")}`, "HEAD"],
  { cwd: root },
);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
await writeFile(
  join(output, "BUILD.txt"),
  `Internal Windows x64 preview\nSource commit: ${commit}\nNative Project files and recent Projects; no installer or updater.\n`,
);
await mkdir(join(root, "plan"), { recursive: true });
await writeFile(
  join(root, "plan/preview-package.json"),
  JSON.stringify(
    {
      output,
      executable: join(application, "Analog Canvas Preview.exe"),
      commit,
      archive: join(
        root,
        "output",
        `analog-canvas-desktop-windows-x64-${commit.slice(0, 12)}.zip`,
      ),
    },
    null,
    2,
  ),
);
console.log(output);
