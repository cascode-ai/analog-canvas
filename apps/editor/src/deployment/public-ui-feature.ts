export interface PublicUiFeatureConfiguration {
  production: boolean;
  configured?: string;
}

/**
 * Public UI capabilities fail closed in production builds. Preview and local
 * development opt in explicitly or inherit the development default.
 */
export function resolvePublicUiFeatureEnabled(
  input: PublicUiFeatureConfiguration,
): boolean {
  if (input.configured === "enabled") return true;
  if (input.configured === "disabled") return false;
  return !input.production;
}
