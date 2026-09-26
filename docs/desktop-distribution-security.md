# Desktop distribution credential boundary

The desktop application and its corresponding source are public material. No
production credential may be embedded in either. Minification, an executable
wrapper, deleting a UI button, or removing source from a ZIP is not a credential
protection mechanism.

## Audit of the first published preview

On 2026-09-26, the review downloaded the actual
[first Windows preview](https://github.com/cascode-ai/analog-canvas/releases/tag/desktop-preview-655ee760bb22-1),
whose source is `655ee760bb228e6451acd201368be04557024532`. It inspected the 207
distributed files and the nested archive containing 2,330 source files, and
scanned 302 commits reachable from that mainline revision with Gitleaks 8.30.1.

No production credential was identified. The only scanner finding was a fixed
32-character test value in `packages/agent-adapter/src/http.test.ts`, explicitly
passed to an isolated loopback test server. It is not a deployed credential.
The reviewed exception in `.gitleaks.toml` requires both that exact value and
that exact source path; it does not exempt other tests or other values.

Neither the runnable tree nor its source archive contained `.env`, `.dev.vars`,
private-key files, Git authentication state, a browser profile, cookies or a
user database. Production credential variable names were absent from the
runnable JS/JSON/HTML/CSS/text files. The source archive does include public
Worker authentication implementation, tests, workflow definitions and secret
variable **names**, as does the public repository; these are not secret values.

## Where production authority lives

| Material                                                              | Storage and use                                                                                              | Desktop distribution                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| OAuth client secrets, email service key and simulation upstream token | GitHub Secrets, synchronized into Worker runtime secrets by the deployment workflow                          | No production secrets are passed to desktop build or acceptance jobs |
| `ADMIN_EMAILS` and `ADMIN_EMAILS_EXTRA`                               | Worker runtime secrets; each authenticated session's verified email is checked server-side                   | Neither list is embedded in the runnable files                       |
| Account sessions                                                      | Random login/session tokens; server stores token hashes and validates expiry                                 | No existing user profile or account session is copied into a package |
| Gallery backup token                                                  | Worker runtime secret; authorizes specific bounded reads, not administrator writes or private Cloud Projects | No token value is part of source or runtime output                   |
| UI `isAdmin` / moderator affordances                                  | Server-derived identity controls the display; privileged endpoints independently resolve the server session  | Changing client code does not grant server authority                 |

GitHub and Google sign-in only use provider-verified email addresses for the
administrator check. The account IDs/display-name migrations in
`worker/auth-do.ts` rename stored profiles; they do not grant administrator
authority. `GALLERY_ADMIN_TOKEN` is retired from the runtime authorization
path, although a repository secret with that name still exists. Removing an
unused stored secret is operational housekeeping, not a substitute for server
authorization or a response to an identified leak.

The audit could enumerate GitHub secret names but could not read their values;
therefore it does not claim byte-for-byte comparison with every production
secret. Anonymous and deliberately invalid-credential live probes received
403 before an application JSON response, so they are not counted as proof of
application authorization. The server code review and focused authentication
tests provide that evidence. Pattern scanning cannot prove the absence of all
possible secrets or replace a complete penetration test.

## Enforced distribution checks

1. Desktop Vite builds disable `.env` loading and all `VITE_*` environment
   exposure. A build test injects sentinel values through both sources and
   verifies they do not reach output. Web build behavior is unchanged.
2. Package assembly rejects tracked private configuration, key, profile and
   database paths before creating the corresponding source archive. The final
   gate independently inspects runtime paths and the actual source ZIP's entry
   paths without extracting it. Symlinks are rejected.
3. The Windows workflow uses pinned Gitleaks 8.30.1 to scan runtime contents and
   nested source before upload. Missing tools, scanner errors or findings fail
   closed. Synthetic disposable keys verify detection in both runtime and
   source-only locations, and verify that the fixture exception is path-bound.
4. A successful scan adds `SECURITY.json` with the source commit, scanner version
   and inventory. Archiving checks that this and `ACCEPTANCE.json` match the
   package source. Both merge-queue artifacts and manual prereleases use the
   same gate. Raw browser profiles are no longer uploaded as failure artifacts;
   scanner diagnostics retain only rule, path and line.

The corresponding source and original notices remain distributed. If an actual
credential is ever found, block distribution and revoke/rotate it at the issuer;
removing a file or a release cannot invalidate a previously copied credential.
Audit the public Git history as well as build outputs before restoring access.

For local validation, install the reviewed scanner and set `GITLEAKS_BINARY` to
its executable, then run `pnpm --filter @icm/desktop security:preview` after
packaging and acceptance. The scan is mandatory in the distribution workflow;
the local package command alone is not approval to publish a package.
