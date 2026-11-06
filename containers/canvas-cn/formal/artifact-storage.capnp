using Workerd = import "/workerd/workerd.capnp";

# Pinned upstream R2-compatible storage, private to this workerd process.
# Its blobs and metadata are one backup boundary; neither has a public socket.
const extensions :List(Workerd.Extension) = [(modules = [
  (name = "miniflare:shared", esModule = embed "storage-modules/shared.js"),
  (name = "miniflare:zod", esModule = embed "storage-modules/zod.js")
])];

const entry :Workerd.Worker = (
  compatibilityDate = "2023-07-24",
  modules = [(name = "object-entry.js", esModule = embed "storage-modules/object-entry.js")],
  bindings = [
    (name = "MINIFLARE_NAMESPACE", text = "canvas-cn-formal-artifacts-v1"),
    (name = "MINIFLARE_OBJECT", durableObjectNamespace = (serviceName = "artifact-store", className = "R2BucketObject"))
  ],
  globalOutbound = "deny-outbound"
);

const bucket :Workerd.Worker = (
  compatibilityDate = "2023-07-24",
  compatibilityFlags = ["nodejs_compat", "experimental"],
  modules = [(name = "bucket.js", esModule = embed "storage-modules/bucket.js")],
  durableObjectNamespaces = [(className = "R2BucketObject", uniqueKey = "canvas-cn-formal-R2BucketObject-v1")],
  durableObjectStorage = (localDisk = "artifact-state"),
  bindings = [(name = "MINIFLARE_BLOBS", service = "artifact-state")],
  globalOutbound = "deny-outbound"
);
