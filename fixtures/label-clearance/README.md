# Gallery label-clearance drawings

Published Community Gallery Projects, as `/api/gallery/<id>` returned their
`projectText` on 2026-11-25, read by
`apps/editor/src/features/instance-display/arrange-gallery-clearance.test.ts`
(#2619). The test never touches the network.

| File         | Entry                                     | Why it is here                                                                                                                                      |
| ------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `296p9s5vn2` | Fully differential telescopic op amp      | M4, M6 and M8 drawn on their own transistors; an `includeManual` arrangement had moved M7 across its VDD stub and M3 onto its drain's junction dot. |
| `zp3r9haqg7` | Self Bias Circuit                         | M5's name on its drain wire, M1 and M2 leaning on their source arrows.                                                                              |
| `vk3x9wxz7j` | Diode-Connected MOS Voltage-Limiting Cell | Nothing a repair moves is reported: a dry run moved labels of drawings with no finding at all.                                                      |
| `ag-1146`    | Differentially tuned LC-VCO               | A block's name centred in its box was reported over the block and repaired out of it.                                                               |
| `ar-3923`    | Two cascaded NPN emitter followers        | A repair moved a value onto a label left in place.                                                                                                  |
| `i2n-1306`   | Differential pair with op-amp output      | R14's 220Ω was moved apart from its name, beside a ground.                                                                                          |
| `ag-1026`    | Two-stage op amp, bulk-driven input       | A Port's v_in⁻ was moved off its end onto Q5.                                                                                                       |
| `i2n-828`    | Op-amp regulated cascode bias             | Names were moved toward neighbouring transistors.                                                                                                   |

Keep the ids: their value is that the labels are where their authors left
them.
