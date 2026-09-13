import { resolvePublicUiFeatureEnabled } from "../../deployment/public-ui-feature";

/**
 * Controls the human-facing analog Simulation workspace and authoring entry
 * points. Persisted simulation data and HTTP APIs are separate contracts and
 * deliberately do not depend on this build flag.
 */
export function resolvePublicSimulationUiEnabled(input: {
  production: boolean;
  configured?: string;
}): boolean {
  return resolvePublicUiFeatureEnabled(input);
}

export const PUBLIC_SIMULATION_UI_ENABLED = resolvePublicSimulationUiEnabled({
  production: import.meta.env.PROD,
  configured: import.meta.env.VITE_ICM_SIMULATION_UI,
});
