/** Web deployment policy only; a future host must choose its own startup. */
export async function configureWebServiceWorker(
  production: boolean,
  baseUrl: string,
): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  if (production) {
    // A Pages deployment must not register another site's root-origin worker.
    await navigator.serviceWorker.register(`${baseUrl}sw.js`, {
      scope: baseUrl,
    });
    return;
  }
  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.length === 0) return;
  const wasControlled = navigator.serviceWorker.controller !== null;
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  if (wasControlled) window.location.reload();
}
