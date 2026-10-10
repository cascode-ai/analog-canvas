# Simulation evidence resources and recovery

The browser Project evidence budget and Agent transfer replica budget are
independent. `simulation` / `resource-usage` reports each available scope with
used, reserved, protected, reclaimable and pending bytes, logical original
bytes, counts and limits. Missing remote measurements carry `resourceProblems`;
they do not mean zero usage. Existing `history-usage` byte fields describe
charged stored bodies. ArtifactRef length/hash always describe original files.

New evidence may reclaim eligible older automatic caches before admission.
Explicit Saves, legacy records, the latest durable result and evidence in use
remain protected. Another tab reading one Run does not block cleanup of unrelated
caches. Pending deletion remains charged until physical reclamation succeeds.
Legacy whole-Project locks and browsers without Web Locks defer cleanup.

`simulation_files` / `transfer-capabilities` advertises supported protocols.
Legacy `download` and `downloads` keep their existing response shape. For v2,
use `download-v2` or `downloads-v2` with a consumer UUID. The descriptor includes
the original ArtifactRef, same-session path, lease UUID and expiry. Only requested
files are uploaded. Local cache hits need no upload or download.

MCP's sync/download helper handles negotiation, Range, byte/hash validation,
atomic local publication and ACK. A custom consumer sends `release-download`
with the descriptor's fileId and leaseId only after verifying its local file;
the authenticated same-session artifact DELETE route is equivalent. This releases
only that consumer's lease, not the original Project evidence or another download.
Active streams renew protection. A failed ACK keeps the verified local file and
expires eventually. An expired/unavailable replica needs bounded preparation
of the same original artifact. Never rerun the simulation to fetch evidence.

Transfer identities remain until session end even after their bodies are evicted.
The Worker index has a separate 1 MiB metadata budget (at most 65,536 identities).
`ARTIFACT_METADATA_QUOTA_EXCEEDED` refuses new identities/leases while existing
downloads and ACKs remain usable; prepare future transfers in a new session.

Private browser gzip is lossless. RAW, structured JSON, full CSV including complex
AC, logs, inputs, manifest and Specs keep their original contents and identities.
The stored representation and its physical accounting may be smaller. Unknown
encoding, excessive decompression or a failed digest is an explicit read failure;
stored evidence remains for recovery.

A completed execution with failed persistence retains its session result for
an evidence-only export retry. Closing that session can lose unpersisted data.
Storage failure, transfer quota, authentication and solver failure are distinct.
Persistence failure uses `Run.error.stage:"export"`. If execution also failed,
its original Problem retains a `RUN_EVIDENCE_STORAGE_UNAVAILABLE` warning
diagnostic instead. Either form requires evidence-only recovery before packaging
the complete Run; a retry never invokes the solver again.
An older Editor window can block a database upgrade; update or close that older
window and retry. Ordinary idle cleanup does not require an Editor refresh.
