using Workerd = import "/workerd/workerd.capnp";

# One host owns this state directory. Namespace keys are storage identities:
# preserve them when moving a release or restoring its database snapshot.
const config :Workerd.Config = (
  services = [
    (name = "canvas", worker = (
      compatibilityDate = "2026-08-11",
      modules = [(name = "index.js", esModule = embed "worker/index.js")],
      bindings = [
        (name = "AUTH", durableObjectNamespace = "AuthDO"),
        (name = "GALLERY", durableObjectNamespace = "GalleryDO"),
        (name = "ANALYTICS", durableObjectNamespace = "AnalyticsDO"),
        (name = "AGENT_SESSION", durableObjectNamespace = "AgentSessionDO"),
        (name = "SIMULATION_CONTROL", durableObjectNamespace = "SimulationControlDO"),
        (name = "COMPONENT_LIBRARY", durableObjectNamespace = "ComponentLibraryDO"),
        (name = "TOPOLOGY_TASK", durableObjectNamespace = "TopologyTaskDO"),
        (name = "ADMIN_EMAILS", text = "owner@trial.invalid")
      ],
      durableObjectNamespaces = [
        (className = "AuthDO", uniqueKey = "canvas-cn-acceptance-AuthDO", enableSql = true),
        (className = "GalleryDO", uniqueKey = "canvas-cn-acceptance-GalleryDO", enableSql = true),
        (className = "AnalyticsDO", uniqueKey = "canvas-cn-acceptance-AnalyticsDO", enableSql = true),
        (className = "AgentSessionDO", uniqueKey = "canvas-cn-acceptance-AgentSessionDO", enableSql = true),
        (className = "SimulationControlDO", uniqueKey = "canvas-cn-acceptance-SimulationControlDO", enableSql = true),
        (className = "ComponentLibraryDO", uniqueKey = "canvas-cn-acceptance-ComponentLibraryDO", enableSql = true),
        (className = "TopologyTaskDO", uniqueKey = "canvas-cn-acceptance-TopologyTaskDO", enableSql = true)
      ],
      durableObjectStorage = (localDisk = "state"),
      globalOutbound = "deny-outbound"
    )),
    (name = "state", disk = (path = "/var/lib/analog-canvas/native/state", writable = true)),
    (name = "deny-outbound", worker = (
      compatibilityDate = "2026-08-11",
      modules = [(name = "deny.js", esModule = "export default {fetch() {return new Response('Outbound services are disabled in this acceptance environment', {status: 503});}}")]
    ))
  ],
  sockets = [(name = "http", address = "127.0.0.1:8788", http = (), service = "canvas")]
);
