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

function fail(stage, code, message, nextAction, evidence) {
  console.log(JSON.stringify({ ok: false, stage, code, message, nextAction, evidence }));
  console.error(message);
  process.exitCode = 1;
}

async function bootstrap() {
  if (Number(process.versions.node.split('.')[0]) < 24)
    return fail('runtime', 'NODE_VERSION_UNSUPPORTED', 'MCP bootstrap requires Node.js 24 or newer', 'use-http-kit');
  const [url, sha256, ...args] = process.argv.slice(1);
  const response = await fetch(url, {
    redirect: 'manual', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    const evidence = { httpStatus: response.status };
    if (response.status >= 300 && response.status < 400)
      return fail('download', 'UNEXPECTED_REDIRECT', 'MCP bootstrap refused a redirect', 'stop', evidence);
    return fail('download', 'PACKAGE_DOWNLOAD_FAILED', 'MCP bootstrap download failed', 'use-http-kit', evidence);
  }
  const chunks = [];
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 24000000)
      return fail('download', 'DOWNLOAD_TOO_LARGE', 'MCP bootstrap archive is too large', 'stop');
    chunks.push(chunk);
    hash.update(chunk);
  }
  if (hash.digest('hex') !== sha256)
    return fail('integrity', 'PACKAGE_INTEGRITY_FAILED', 'MCP bootstrap archive integrity check failed', 'stop');

  const directory = mkdtempSync(join(tmpdir(), 'analog-canvas-bootstrap-'));
  try {
    const bytes = Buffer.concat(chunks);
    const archive = join(directory, 'package.tgz');
    const entry = join(directory, 'analog-canvas-mcp.mjs');
    const code = execFileSync('tar', ['-xOzf', '-', 'package/bin/analog-canvas-mcp.mjs'], {
      input: bytes, maxBuffer: 16000000, timeout: 30000,
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    writeFileSync(entry, code, { mode: 0o600, flag: 'wx' });
    writeFileSync(archive, bytes, { mode: 0o600, flag: 'wx' });
    process.argv = [process.execPath, entry, ...args, '--archive', archive];
    await import(pathToFileURL(entry).href);
  } catch {
    fail('extract', 'PACKAGE_EXTRACTION_FAILED', 'MCP bootstrap could not load the verified archive', 'use-http-kit');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await bootstrap().catch(() =>
  fail('download', 'PACKAGE_DOWNLOAD_FAILED', 'MCP bootstrap could not read the archive', 'use-http-kit')
);
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
