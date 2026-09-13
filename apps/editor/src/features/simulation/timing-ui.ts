import { resolvePublicUiFeatureEnabled } from "../../deployment/public-ui-feature";

/**
 * Controls the experimental human-facing digital timing tools.
 *
 * The deterministic simulation package and persisted circuit contracts never
 * depend on this flag. Local development enables the UI by default, while a
 * production build (including Cloudflare) keeps it hidden unless a staging
 * build explicitly opts in.
 */
export function resolveTimingUiEnabled(input: {
  production: boolean;
  configured?: string;
}): boolean {
  return resolvePublicUiFeatureEnabled(input);
}

export const TIMING_UI_ENABLED = resolveTimingUiEnabled({
  production: import.meta.env.PROD,
  configured: import.meta.env.VITE_ICM_TIMING_UI,
});
