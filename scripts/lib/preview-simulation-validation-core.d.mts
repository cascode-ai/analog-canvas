export function validatePinnedEnvironment(
  environment: unknown,
  target: string,
): {
  simulator: { name: string; version: string; binarySha256: string };
  models: { id: string; contentSha256: string };
};
