# Simulation evidence storage

Status: accepted
Primary owners: Browser simulation artifact/archive stores, SimulationFiles and Worker AgentArtifacts

This contract implements the approved evidence lifecycle: keep complete numerical
evidence, admit it safely, reclaim idle caches while the Editor remains open, and
prepare Agent downloads only when requested. It does not change a circuit,
solver tolerance, saved signal list, sample grid or numerical result.

## Ownership and admission

The browser Project budget is 1 GiB of stored bodies and 4,096 resident files.
Each public file remains limited to 256 MiB of original UTF-8 bytes; archives
remain limited to 512 MiB of original evidence. Shared file identities count
once. Actual origin quota is a separate browser constraint.

Above the 75% high watermark, admission first recovers unowned bodies, then
oldest eligible cache runs until usage reaches 62.5% or leaves enough space for
the incoming bundle. Cache history also retains at most 30 runs. Explicit Saves
have their existing separate 30-run rolling policy; historical records without
a retention marker remain protected. Automatic eviction cannot remove the
latest successfully completed durable run, a Save, a legacy record or evidence actively used
by a producer/reader. A cache promoted to Save is checked again at deletion.

The browser publisher encodes files sequentially into immutable Blobs, then
commits bodies, identities, ownership and the complete catalog in one IndexedDB
transaction. The final transaction rechecks exact stored bytes and file slots;
concurrent preparation cannot overcommit the budget. There is no durable
precommit staging reservation: `reservedBytes` is zero outside that transaction,
and an aborted transaction leaves neither staged bodies nor a catalog. This
atomic publication provides the reservation/commit behavior at the existing
store boundary without a second durable staging registry.

Failed publication retains the execution output and original file identities
in its session. Export can retry evidence publication for that Run without
another solver execution. Losing the session can lose that unpersisted result;
there is no remote permanent backup. Execution, collection, persistence and
transfer failure are reported separately. Run/catalog `execution` and
`collection` retain the actual solver and acquisition outcomes. A persistence
failure uses `Run.error.stage = "export"` with its storage error code. When
execution also failed, its original Problem is retained and a
`RUN_EVIDENCE_STORAGE_UNAVAILABLE` warning diagnostic identifies the separate
persistence failure. Clients derive persistence failure from either form; it never
changes complete acquisition to partial acquisition. This preserves the strict
legacy Run response shape. The GUI shows the same facts and offers **Retry
saving results**; complete-run and Project ZIP downloads and manual archiving
use that evidence-only recovery before packaging any retained result. Failed
bundle publication never adds an incomplete durable result catalog.

## Readers and reclamation

Short Project locks coordinate publication and physical cleanup. Lifetime
protection uses scoped producer, Run and file-reader Web Locks with durable
owner references. Viewing one Run does not prevent removal of an unrelated
cache. Reader release triggers cleanup; inactive crash owners are reconciled
against current locks. Logical deletion records a durable removal marker, and
physical deletion remains pending while a reader holds the body. Shared bodies
stay until their final owner releases them.

Legacy whole-Project locks are respected. Hosts without Web Locks defer
physical cleanup rather than guessing whether another window is reading.
Failed cleanup can retry on admission, startup or reader release. Browser
cleanup never deletes Agent workspace files.

## Agent transfer replicas

The Worker holds a separate session budget: 1 GiB, 1,024 resident bodies,
256 MiB per original file. Only selected files enter its upload queue; registering
a publisher or finishing a Run performs no eager upload. Existing limits of
eight uploads and 32 MiB in flight remain, with the single-large-file exception.

`File.transfer-capabilities` negotiates protocols 1 and 2. Legacy `download` /
`downloads` retain their strict response shape and session-lifetime protection.
`download-v2` / `downloads-v2` take a consumer UUID and return a path, lease UUID
and expiry alongside the original ArtifactRef. Descriptors are valid for ten
minutes; active GET/Range renews durable protection. Each consumer acknowledges
its own lease after local length/hash verification and atomic file publication.
`File.release-download` is handled by the authenticated Worker; the equivalent
same-session artifact DELETE route supports the SDK transfer helper. It accepts
only a file identity and lease, never an arbitrary R2 key. Authorization remains
`simulation.run` under the existing origin/session controls.

ACK failure keeps the verified local file; lease expiry is the recovery path.
Expiry or a missing replica causes bounded preparation of the same original
artifact, not another simulation. Full capacity still permits authorized reads
of resident evidence. Idle LRU bodies become reclaimable only after leases and
active transfers finish. Failed PUT reservations retain ten minutes of retry
protection and survive reconstruction. R2 deletion must succeed before its
charged bytes are released; pending failures retry via admission and alarms.

Evicting identities cannot accept a concurrent reupload. Length/hash tombstones
persist until session end, separately bounded at 65,536 identities and 1 MiB
of serialized metadata. The index uses one SQLite-backed Durable Object record;
the [platform key/value limit](https://developers.cloudflare.com/durable-objects/platform/limits/)
is 2 MB. This conservative budget replaces the proposed 16 MiB limit and leaves
serialization headroom for renewals and ACKs. Admission or new leases exceeding
it return `ARTIFACT_METADATA_QUOTA_EXCEEDED` before adding the new identity or
lease; existing reads and ACKs remain available. A tombstone does not count as a resident body. Session
termination retains the existing bulk deletion and failed-key retry behavior.

## Lossless representation and accounting

ArtifactRef length and SHA256 always describe original UTF-8 bytes. The browser
privately stores identity or gzip plus actual Blob `storedBytes`. Files below
64 KiB or with less than 10% savings keep identity; unavailable/failed encoding
also falls back to identity and is admitted at its actual size. Larger encoding
and decoding jobs run serially in short-lived Workers; work bounded to 64 KiB
uses the same codec inline to avoid Worker startup for manifests and logs.
Worker unavailability supports an
identity writer fallback. Decompression stops at the declared original length,
enforces the 256 MiB limit and verifies the original digest. Unknown encoding,
corruption and mismatched identity fail explicitly without deleting evidence.

RAW, complete result JSON, OP/AC/DC/TRAN/Noise CSV (including complex columns),
inputs, logs, manifests and Specs keep their original format and identity.
There is no numerical downsampling or regeneration on archive reopen.

Existing strict `history-usage` retains its fields; byteLength,
unreferencedBytes and reclaimedBytes describe the charged stored-body budget.
`Simulation.resource-usage` separately reports browser-project,
agent-session-transfer and session-memory scopes, with stored/logical bytes,
reservations, protected/reclaimable/pending bytes, counts and blockers. Missing
remote measurements produce an explicit resource problem, never a zero. Origin
quota estimates are advisory and include other origin storage. Blob accounting
does not claim to measure IndexedDB page/index overhead or total process memory.
The 16 MiB text cache does not bound parsed results, Worker heaps or UI state.

## Migration and rollout

IndexedDB v4 reads historical v2/v3 identity bodies without copying them on open.
Connections close on versionchange. A blocked upgrade fails with
`ARTIFACT_STORAGE_UPGRADE_BLOCKED`; old bytes are preserved. Update or close the
older window before retrying. No ordinary cleanup requires refreshing the Editor.

Publish the dual reader and dual transfer protocol first. Gzip writing defaults
off and is enabled separately through `VITE_SIMULATION_GZIP=1` after that reader
release is accepted. Roll back only to a dual-reader version and disable new
gzip writes; an older binary that cannot read gzip is not a safe data rollback.
The version-pinned MCP package, OpenAPI and public help travel with the protocol.

## Validation

Public store/service/HTTP/filesystem tests cover admission, exact identity,
atomic failure/retry, shared and protected owners, leases, Range, reconstruction,
failed deletion and verified local ACK. Browser tests cover cross-tab protection,
50 consecutive Runs and a real Worker round trip of every supported analysis.
`ICM_EVIDENCE_BENCHMARK=1` enables a synthetic 9,384-point, 145-signal bundle
benchmark near the historical 85 MiB size. It records encode/read times, main
thread heartbeats, long tasks and CDP JS heap; it excludes Worker/native memory
and does not certify the user's circuit electrically.
