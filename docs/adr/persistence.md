# Persistence and Compatibility

Status: `accepted`
Owners: `packages/project-protocol`, `apps/editor`, `apps/desktop`, `worker`

Cloud Save, portable files and local recovery are separate
([persistence and recovery](../specs/persistence-and-recovery.md)); runtime code
sees one current shape behind a contiguous reader upgrade chain
([file format](../specs/project-file-format.md)).

- Saves update a stable Cloud Project with acknowledged revisions, so writers
  never overwrite each other; recovery promises no Cloud durability.
- Upgrade adapters at the file boundary keep old files readable without legacy
  runtime branches; ambiguous electrical data is refused with a location.
- The offline desktop keeps canonical project files as the authority, behind
  opaque main-process grants.
