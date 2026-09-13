import { resolvePublicUiFeatureEnabled } from "../deployment/public-ui-feature";

/**
 * Controls whether the browser exposes the human-facing Agent connection UI.
 *
 * The machine API and the MCP adapter intentionally do not depend on this
 * flag.  A production deployment is human-only by default; local development
 * and staging can opt in with VITE_ICM_AGENT_UI=enabled.
 */
export function resolvePublicAgentUiEnabled(input: {
  production: boolean;
  configured?: string;
}): boolean {
  return resolvePublicUiFeatureEnabled(input);
}

export const PUBLIC_AGENT_UI_ENABLED = resolvePublicAgentUiEnabled({
  production: import.meta.env.PROD,
  configured: import.meta.env.VITE_ICM_AGENT_UI,
});
