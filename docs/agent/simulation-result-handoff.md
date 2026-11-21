# Agent simulation result handoff

## Lifetime

A prepared input has a short start-validity window (not a retention deadline
or lease); queued inputs of a started batch stay valid. Completed runs and
batches (`expiresAt: null`) stay readable for the host's lifetime, and
repeating the original start request ID returns the same run. Session-workspace
drafts (`expiresAt: null`) last until discard or host teardown.

Artifact bodies are Project-scoped browser (IndexedDB) evidence. Disconnect
clears authorization and memory handles, not bodies: a new authorized host for
the same Project can read a known artifact ID; another Project cannot. Local
Agent downloads are independent of the browser.

After reconnecting, `simulation` `history` lists retained terminal runs newest
first (`limit` default 10, max 100; pass `nextCursor` as `cursor`), without
bodies. `storage: persistent` is in browser storage (origin-local, not Cloud
Save); `memory` only in the current host. Use a `runId` with `catalog`, then
download its files. A historical `read` is a shortened receipt with saved
status and any retained error; it cannot tell whether current inputs match and
grants no execution or cancellation authority. Large finished receipts omit
arrays only after publication (`resultPreview`); download complete files.

File `simulation-input` `action:"downloads"` with 1–32 `artifactIds` returns
`downloads` in order, each ready, pending or failed independently. Download
ready ones; retry pending ones with fresh request IDs, never a new simulation.

## GUI handoff

Project-folder runs share a read-only history with the GUI without opening the
panel, changing its folder or replacing a human run. **Project runs** shows
owner and state; **Open result** restores a completed result without
rerunning. The originating session owns execution and cancellation; a project
observer stores completed artifacts as Project evidence even if the Agent never
reads. Revocation cannot erase a completed handoff or cancel a human run;
revocation before handoff is reported unavailable. Session-workspace runs stay
private.

Archives stay in the browser and describe the captured input. See the
[archive rules](https://github.com/cascode-ai/analog-canvas/blob/main/docs/specs/simulation-evidence-storage.md#browser-admission)
for capacity and retention, or [evidence storage](simulation-evidence-storage.md)
for usage and recovery.

`.icproj.json` exports are source-only. A restored run with a captured Project
offers **Download project + results…**, a ZIP evidence bundle of the
prepare-time `project.icproj.json` (omitted when too large or changed during
preparation) plus `results/`.
