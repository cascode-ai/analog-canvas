// This code runs under the user's Node before any archive code is loaded.
// Keep the literals single-quoted so the same command works in PowerShell
// and POSIX shells. No claim or connector credentials enter the launcher.
const loadVerifiedArchive = `
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 24)
  throw Error('MCP bootstrap requires Node.js 24 or newer');
const [url, sha256, ...args] = process.argv.slice(1);
const response = await fetch(url, {
  redirect: 'manual', signal: AbortSignal.timeout(30000),
});
if (!response.ok || !response.body) {
  await response.body?.cancel();
  if (response.status >= 300 && response.status < 400)
    throw Error('MCP bootstrap refused a redirect');
  throw Error('MCP bootstrap download failed');
}
const chunks = [];
const hash = createHash('sha256');
let size = 0;
for await (const chunk of response.body) {
  size += chunk.length;
  if (size > 24000000) throw Error('MCP bootstrap archive is too large');
  chunks.push(chunk);
  hash.update(chunk);
}
if (hash.digest('hex') !== sha256)
  throw Error('MCP bootstrap archive integrity check failed');

const directory = mkdtempSync(join(tmpdir(), 'analog-canvas-bootstrap-'));
try {
  const entry = join(directory, 'analog-canvas-mcp.mjs');
  const code = execFileSync('tar', ['-xOzf', '-', 'package/bin/analog-canvas-mcp.mjs'], {
    input: Buffer.concat(chunks), maxBuffer: 16000000, timeout: 30000,
    windowsHide: true,
  });
  writeFileSync(entry, code, { mode: 0o600, flag: 'wx' });
  process.argv = [process.execPath, entry, ...args];
  await import(pathToFileURL(entry).href);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
`
  .trim()
  .replace(/\r?\n\s*/gu, " ");

export function verifiedArchiveLaunchArgs(
  url: string,
  sha256: string,
): string[] {
  return [
    "--input-type=module",
    "--eval",
    loadVerifiedArchive,
    "--",
    url,
    sha256,
  ];
}
