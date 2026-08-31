# Legacy Project fixtures

Real and synthetic `.icproj.json` files at **historical schema versions**,
guarding the promise that a user's saved canonical Project file keeps
loading after the schema moves on. Unlike `fixtures/projects/`, nothing
here is in the current form on purpose — do not "fix" these files to the
current schema; their old `schemaVersion` is the point.

| File | Version | Origin |
| --- | --- | --- |
| `issue-446-bias-ini.v25.icproj.json` | 25 | Attached by the reporter of issue #446 to demonstrate the failure ("上周保存的project或因版本更新导致无法导入?"). A real bias-network circuit: 15 instances, 11 nets, 33 routes. Kept byte-identical to the attachment. |

Loading behavior is asserted by
`packages/project-protocol/src/legacy-load.test.ts`, which also covers the
other historical versions with minimal synthetic projects. If a schema bump
adds a migration step, that test's supported-version range is the place that
must keep the whole chain honest.
