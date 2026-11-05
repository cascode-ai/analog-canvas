export type InstallationStage =
  | "arguments"
  | "runtime"
  | "manifest"
  | "download"
  | "integrity"
  | "extract"
  | "local-probe"
  | "host-config";

/** Safe installation receipts. Raw exception messages can contain private paths or credentials. */
export class InstallationFailure extends Error {
  readonly diagnostic;

  constructor(
    readonly stage: InstallationStage,
    readonly code: string,
    message: string,
    nextAction: "use-http-kit" | "stop",
    evidence: Record<string, string | number> = {},
  ) {
    super(message);
    this.diagnostic = {
      ok: false as const,
      stage,
      code,
      message,
      nextAction,
      evidence,
    };
  }
}

/** Preserve typed refusals; unexpected exceptions retain only safe system evidence. */
export function installationFailureAt(
  stage: InstallationStage,
  error: unknown,
): InstallationFailure {
  if (error instanceof InstallationFailure) return error;
  const systemCode = installationSystemCode(error);
  const failures = {
    arguments: [
      "INSTALL_ARGUMENTS_INVALID",
      "Use --install --origin <exact HTTPS origin> --host codex|config",
      "stop",
    ],
    runtime: [
      "NODE_RUNTIME_FAILED",
      "Cannot use the selected Node runtime",
      "use-http-kit",
    ],
    manifest: ["MANIFEST_INVALID", "Invalid MCP manifest declaration", "stop"],
    download: [
      "PACKAGE_DOWNLOAD_FAILED",
      "MCP package download failed",
      "use-http-kit",
    ],
    integrity: [
      "PACKAGE_INTEGRITY_FAILED",
      "MCP package integrity check failed",
      "stop",
    ],
    extract: [
      "PACKAGE_EXTRACTION_FAILED",
      "Cannot extract the verified MCP package",
      "use-http-kit",
    ],
    "local-probe": [
      "MCP_PROBE_FAILED",
      "MCP local initialize/tools/list failed",
      "use-http-kit",
    ],
    "host-config": [
      "HOST_CONFIG_FAILED",
      "Cannot update host configuration; inspect the existing configuration",
      "use-http-kit",
    ],
  } as const;
  const [code, message, nextAction] = failures[stage];
  return new InstallationFailure(
    stage,
    code,
    message,
    nextAction,
    systemCode ? { systemCode } : {},
  );
}

/** Only operating-system error codes cross the reporting boundary, never raw messages. */
export function installationSystemCode(error: unknown): string | undefined {
  const allowed = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EACCES",
    "EPERM",
    "ENOENT",
    "ENOSPC",
    "EEXIST",
    "ENOTDIR",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ]);
  for (
    let depth = 0;
    depth < 4 && error && typeof error === "object";
    depth++
  ) {
    const value = error as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof value.code === "string" && allowed.has(value.code))
      return value.code;
    if (value.name === "TimeoutError" || value.name === "AbortError")
      return "ETIMEDOUT";
    error = value.cause;
  }
  return undefined;
}
