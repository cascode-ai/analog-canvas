# Label clearance smoke fixtures (#2619)

Minimal published Community Gallery `.icproj.json` smoke fixtures kept for
end-to-end `parseProject` + `arrangeInstanceLabelsReport` verification in
`apps/editor/src/features/instance-display/arrange-gallery-clearance.test.ts`:

| Gallery id   | Title                  | Purpose                                                                          |
| ------------ | ---------------------- | -------------------------------------------------------------------------------- |
| `296p9s5vn2` | Telescopic op amp      | End-to-end repair of hand-moved names drawn over their own transistors & preset. |
| `zp3r9haqg7` | Self-bias circuit      | End-to-end repair of a name struck by its drain wire and source-arrow crowding.  |
| `vk3x9wxz7j` | Bandgap reference core | End-to-end zero-edit guard when only Net labels/free text are reported.          |

Pattern-level regressions (parallel load pairs, row/column cohorts, mirror
pairs, unwired-side crossings, value hiding, VDD majority orientation, Port
turns, row-intrusion guards) live as self-contained synthetic tests in
`apps/editor/src/features/instance-display/repair-instance-labels.test.ts` so
the repository stays free of multi-megabyte raw project snapshots.
