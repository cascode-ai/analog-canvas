/** Online implementations must be absent, even from unrequested lazy chunks.
 * Pure model/source helpers shared by drawing and simulation remain available.
 */
export function isOnlineImplementation(id: string): boolean {
  const path = id.replaceAll("\\", "/").split("?")[0] ?? "";
  return (
    /\/src\/agent\//u.test(path) ||
    /\/src\/components\/(?:account|account-menu-view|version-history-dialog|gallery-version-project)\.[jt]sx?$/u.test(
      path,
    ) ||
    /\/src\/gallery-client\.ts$/u.test(path) ||
    /\/src\/features\/editor-shell\/(?:cloud-projects|gallery-publish|publish-gallery-dialog|gallery-topology-task|gallery-topology-task-notice|gallery-topology-check|gallery-published-notice|examples-panel)\.[jt]sx?$/u.test(
      path,
    ) ||
    /\/src\/features\/user-components\/(?:component-library-client|user-components-library)\.[jt]sx?$/u.test(
      path,
    ) ||
    /\/src\/features\/hierarchy\/cloud-cell-import\.ts$/u.test(path) ||
    /\/src\/features\/simulation\/(?:browser-simulation-session|browser-simulation-archive-store|browser-simulation-artifact-store|project-run-history|spice-simulation-surface)\.[jt]sx?$/u.test(
      path,
    ) ||
    /\/packages\/(?:agent-client|agent-routing)\//u.test(path) ||
    /\/apps\/editor\/analytics\//u.test(path)
  );
}
