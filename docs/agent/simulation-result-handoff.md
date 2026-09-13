# Agent simulation result handoff

Project-folder simulations share a read-only run history with the GUI. Starting
an Agent run does not open the simulation panel, change its active folder, or
replace a human run. In the selected folder's results area, **Project runs**
shows the owner and state; **Open result** restores a completed result into the
GUI without executing it again.

The originating session still owns execution and cancellation. A project-scoped
observer polls individual and batch runs even if the Agent does not call read.
Completed artifacts are hash-verified and copied into the existing IndexedDB
archive store. Agent revocation cannot erase a completed handoff or cancel a
human run. Revocation before handoff is reported as unavailable, not success.
Session-workspace inputs remain private to that session because they have no
Project folder to attach to.

Archives are local to this browser/origin, not Cloud Save. The existing limits
apply: ten archives per Project and 32 MiB per archive. A storage failure leaves
the in-memory result available with an explicit session-only warning. Refresh
can recover successful archives under **Saved results**; deleting one removes
that browser copy. Old results are saved input snapshots, not a fresh validation
of the current source files.

Normal `.icproj.json` exports remain source-only. A restored run with a captured
Project offers **Project + results ZIP**, containing `project.icproj.json` from
prepare time and the run artifacts under `results/`. Extract the Project for
normal import; the ZIP is an evidence bundle, not a new Project file format.
For unusually large Projects the snapshot is omitted rather than exceeding the
archive limit; result-only export remains available.
If the Project changes while preparation is awaiting compilation or executor
capabilities, its snapshot is also omitted with a warning. The verified executed
input artifacts and simulation results remain available.
