# Agent simulation result handoff

## Evidence and execution lifetime

An unused prepared input has a short start-validity window. That is not an
artifact retention deadline or an authorization lease. Once a batch starts,
its queued prepared inputs remain valid for that batch even if wall time passes
the original preparation expiry. Completed runs and batches remain readable for
the owning host lifetime; repeating the original start request ID returns the
same run rather than executing again. A completed batch reports `expiresAt: null`.

Session-workspace drafts report `expiresAt: null` and remain until explicit
discard or host teardown. Saved Project source files have their own ownership.
Browser artifact bodies are stored separately as Project-scoped IndexedDB
evidence, with a bounded memory cache. Disconnect clears authorization and
memory handles, not these bodies. A new authorized host for the same Project
can read a known artifact ID; another Project cannot. History discovery and
whole-run restoration do not require running the simulation again. Local Agent
downloads remain independent of browser lifetime and storage.

After reconnecting to the same Project, `simulation` operation `history` lists
retained terminal runs, newest stored first. `limit` defaults to 50 (maximum 100);
pass `nextCursor` as `cursor` to continue. This list contains no file bodies or
waveform arrays. `storage: persistent` means the directory was saved in browser
storage; `memory` means it is only retained by the current host. Browser storage
is origin-local, not Cloud Save or a server execution queue.

Use a returned `runId` with `catalog`, then download/sync its registered files.
A historical `read` returns a shortened receipt with the saved execution and
collection status, including a retained execution error when available. It
cannot establish whether current source inputs match, and does not restore
execution/cancellation authority. `cancel` never dispatches to an executor for
a historical-only run. Existing GUI archives remain a separate presentation of
the same evidence; the Agent directory also covers session-workspace runs.

Large finished run receipts omit numeric arrays only after artifact publication
succeeds. `resultPreview` describes that receipt, not lost evidence. Download
the complete registered files to analyze them; keeping a page open does not
extend access credentials automatically beyond the session's existing rules.

## GUI handoff and archives

Project-folder simulations share a read-only run history with the GUI. Starting
an Agent run does not open the simulation panel, change its active folder, or
replace a human run. In the selected folder's results area, **Project runs**
shows the owner and state; **Open result** restores a completed result into the
GUI without executing it again.

The originating session still owns execution and cancellation. A project-scoped
observer polls individual and batch runs even if the Agent does not call read.
Completed artifacts are verified and stored as Project evidence; archives
reference those bodies instead of copying them again. Agent revocation cannot erase a completed handoff or cancel a
human run. Revocation before handoff is reported as unavailable, not success.
Session-workspace inputs remain private to that session because they have no
Project folder to attach to.

Archives are local to this browser/origin, not Cloud Save. Older runs are not
automatically pruned by count. The limit is 512 MiB per archive, subject to browser quota
and the shared 1 GiB Project evidence budget (256 MiB per file). A storage failure leaves
the in-memory result available with an explicit session-only warning. Refresh
can recover successful archives under **Saved results**; deleting one removes
that browser history entry. Old results are saved input snapshots, not a fresh validation
of the current source files.

Deleting an archive records pending cleanup durably. At the next file-session
startup, cleanup first reconciles all remaining archives and run catalogs, then
reclaims unreferenced evidence. Shared files stay until their last reference is
gone. Active Project consumers in any tab hold shared browser locks; cleanup
skips a busy Project instead of waiting or interrupting it. Hosts without Web
Locks also defer physical cleanup. Failed cleanup can retry on a later startup;
it does not block ordinary simulation access. Storage quota failures remain
explicit. Downloaded local files are never deleted by browser cleanup.

Normal `.icproj.json` exports remain source-only. A restored run with a captured
Project offers **Download project + results…**, a ZIP containing
`project.icproj.json` from prepare time and the run artifacts under `results/`.
Extract the Project for normal import; the ZIP is an evidence bundle, not a new
Project file format.
For unusually large Projects the snapshot is omitted rather than exceeding the
archive limit; result-only export remains available.
If the Project changes while preparation is awaiting compilation or executor
capabilities, its snapshot is also omitted with a warning. The verified executed
input artifacts and simulation results remain available.
