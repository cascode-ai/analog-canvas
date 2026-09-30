/** The event that opens the page header's sign-in choices. */
export const OPEN_SIGN_IN_EVENT = "icm:open-sign-in";

let pending = false;

/**
 * Opens the sign-in choices in the page header, from anywhere on the page:
 * an invitation to sign in leads to the one place sign-in happens.
 */
export function requestSignIn(): void {
  // Remembered until the choices open, in case they are still loading.
  pending = true;
  // After the click that asked has finished: a click outside an open
  // popover closes it, and this click is outside the header's.
  window.setTimeout(() => window.dispatchEvent(new Event(OPEN_SIGN_IN_EVENT)));
}

/** Whether a request to sign in is still waiting; taking it answers it. */
export function takeSignInRequest(): boolean {
  const waiting = pending;
  pending = false;
  return waiting;
}
