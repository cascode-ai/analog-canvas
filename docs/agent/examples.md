# Raw HTTP request examples

Send these bodies to the session's `/circuit` endpoint using
[API usage](api-usage.md). Replace Document/object IDs and revisions with
returned facts. These are request shapes, not runnable IDs or a seeded circuit.

## Read authorized state

```json
{"apiVersion":"3.0","requestId":"snapshot-1","operation":"snapshot","documentId":"<authorized-document-id>","includeSourceSpans":false}
```

Authorization comes from claim/resume, not a Project Index in capabilities.

## Preview and commit a reference change

For an existing unlocked instance, preview:

```json
{"apiVersion":"3.0","requestId":"reference-preview-1","operation":"transact","documentId":"<authorized-document-id>","transactionId":"reference-preview-tx-1","expectedRevision":42,"dryRun":true,"edits":[{"kind":"set_instance_reference","instanceId":"<snapshot-instance-id>","reference":"R2"}]}
```

After reviewing the result, commit only if revision 42 still represents the
intended state. The payload has new request and transaction identities:

```json
{"apiVersion":"3.0","requestId":"reference-commit-1","operation":"transact","documentId":"<authorized-document-id>","transactionId":"reference-commit-tx-1","expectedRevision":42,"dryRun":false,"edits":[{"kind":"set_instance_reference","instanceId":"<snapshot-instance-id>","reference":"R2"}]}
```

If the commit response is lost, retry that exact commit envelope. A human edit
causing stale revision requires fresh state and reconsideration, not merely
replacement of the expected revision.

## Build and wire

Use catalog-backed native placement, then a fresh Snapshot for resolved pins.
Use `wireIntent` for an ordinary connection or branch to a returned
route-segment anchor; the browser planner owns Net merge, Junction and Route
splitting. A crossing does not prove connectivity. See
[native authoring](shared/authoring.md) and [tool behavior](tool-behavior.md).
