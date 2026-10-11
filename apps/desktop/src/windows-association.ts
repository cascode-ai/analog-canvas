import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

const execute = promisify(execFile);
const PROG_ID = "Cascode.AnalogCanvas.Project";

/** A private extension, never .json. Settings calls this only after explicit opt-in.
 * A separate registry root lets acceptance exercise real Windows registry I/O
 * without changing the developer's file associations.
 */
export async function windowsAssociation(
  action: "read" | "enable" | "disable",
  executable: string,
  registryRoot = "Software\\Classes",
) {
  if (process.platform !== "win32")
    throw new Error("File association requires Windows");
  if (!isAbsolute(executable) || !(await stat(executable)).isFile())
    throw new Error("The application executable is unavailable");
  const payload = Buffer.from(
    JSON.stringify({ action, executable, root: registryRoot, prog: PROG_ID }),
  ).toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$root = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($config.root)
try {
  $command = '"' + $config.executable + '" --open-project "%1"'
  $commandKey = $root.OpenSubKey($config.prog + '\\shell\\open\\command')
  $registered = if ($commandKey) { $commandKey.GetValue(''); $commandKey.Dispose() } else { '' }
  if ($config.action -eq 'enable') {
    $key = $root.CreateSubKey($config.prog); $key.SetValue('', 'Analog Canvas Project'); $key.Dispose()
    $key = $root.CreateSubKey($config.prog + '\\shell\\open\\command'); $key.SetValue('', $command); $key.Dispose()
    $key = $root.CreateSubKey($config.prog + '\\DefaultIcon'); $key.SetValue('', '"' + $config.executable + '",0'); $key.Dispose()
    $key = $root.CreateSubKey('.icproj\\OpenWithProgids'); $key.SetValue($config.prog, [byte[]]@(), [Microsoft.Win32.RegistryValueKind]::None); $key.Dispose()
    $key = $root.CreateSubKey('.icproj'); if (-not $key.GetValue('')) { $key.SetValue('', $config.prog) }; $key.Dispose()
    $registered = $command
  }
  if ($config.action -eq 'disable') {
    if ($registered -and $registered -ne $command) { throw 'Association belongs to a different installation. Open that installation to remove it, or enable this one first.' }
    $root.DeleteSubKeyTree($config.prog, $false)
    $key = $root.OpenSubKey('.icproj\\OpenWithProgids', $true)
    if ($key) { $key.DeleteValue($config.prog, $false); $key.Dispose() }
    $key = $root.OpenSubKey('.icproj', $true)
    if ($key) { if ($key.GetValue('') -eq $config.prog) { $key.DeleteValue('', $false) }; $key.Dispose() }
    $registered = ''
  }
  if ($config.action -ne 'read' -and $config.root -eq 'Software\\Classes') {
    Add-Type 'using System; using System.Runtime.InteropServices; public static class CanvasAssociationNotify { [DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b); }'
    [CanvasAssociationNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  @{ enabled = ($registered -eq $command); otherInstallation = [bool]($registered -and $registered -ne $command) } | ConvertTo-Json -Compress
} finally { $root.Dispose() }
`;
  const result = await execute(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    { windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024 },
  );
  const parsed: unknown = JSON.parse(result.stdout.trim());
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("enabled" in parsed) ||
    typeof parsed.enabled !== "boolean" ||
    !("otherInstallation" in parsed) ||
    typeof parsed.otherInstallation !== "boolean"
  )
    throw new Error("Invalid Windows association response");
  return {
    enabled: parsed.enabled,
    otherInstallation: parsed.otherInstallation,
  };
}
