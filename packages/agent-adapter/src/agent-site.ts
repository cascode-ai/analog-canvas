import { sha256Hex } from "@icm/derived";

/**
 * Site binding ([web sessions](../../../docs/specs/web-agent-session.md#pairing)).
 * Each site keeps its own Agent session Durable Objects, so a Claim or
 * connector works only where it was issued. New session IDs start with a tag
 * of the issuing origin's host; loopback names reach the same local server
 * and share one tag. Legacy untagged IDs belong to no particular site.
 */
const SITE_TAG = /^([0-9a-f]{8})_/u;

export function agentSiteTag(origin: string): string {
  const url = new URL(origin);
  const host = ["127.0.0.1", "[::1]"].includes(url.hostname)
    ? `localhost${url.port ? `:${url.port}` : ""}`
    : url.host;
  return sha256Hex(host).slice(0, 8);
}

export function agentSiteSessionId(origin: string, id: string): string {
  return `${agentSiteTag(origin)}_${id}`;
}

/** Whether another site than `origin` issued the session; never for legacy IDs. */
export function agentSessionFromOtherSite(
  sessionId: string,
  origin: string,
): boolean {
  const tag = SITE_TAG.exec(sessionId)?.[1];
  return tag !== undefined && tag !== agentSiteTag(origin);
}

/**
 * The host registration name for one exact origin (#2020), so each site's
 * MCP server keeps its own entry beside the others.
 */
export function agentMcpServerName(origin: string): string {
  return `analog-canvas-${sha256Hex(origin).slice(0, 16)}`;
}
