import type { SessionUser } from "./auth-do";

export const PREVIEW_ACCEPTANCE_COOKIE = "icm_preview_acceptance";

export interface PreviewAcceptanceEnv {
  ICM_CHANNEL?: string;
  PREVIEW_ACCEPTANCE_TOKEN?: string;
}

function cookieValue(request: Request, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) return cookie.slice(prefix.length);
  }
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Private identity for the deployed Preview journey. It can reach only the
 * Preview Worker and its isolated Project store; Production never sets either
 * half of this contract. Ordinary Preview visitors remain signed out.
 */
export function isPreviewAcceptanceRequest(
  request: Request,
  env: PreviewAcceptanceEnv,
): boolean {
  if (env.ICM_CHANNEL !== "preview" || !env.PREVIEW_ACCEPTANCE_TOKEN) {
    return false;
  }
  const supplied = cookieValue(request, PREVIEW_ACCEPTANCE_COOKIE);
  return (
    supplied !== null &&
    constantTimeEqual(supplied, env.PREVIEW_ACCEPTANCE_TOKEN)
  );
}

export function previewAcceptanceUserOf(
  request: Request,
  env: PreviewAcceptanceEnv,
): SessionUser | null {
  return isPreviewAcceptanceRequest(request, env)
    ? {
        id: "preview-cross-project-acceptance",
        displayName: "Preview acceptance",
        email: null,
        provider: "preview-acceptance",
        role: "user",
        isAdmin: false,
      }
    : null;
}
