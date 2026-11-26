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
| `ar-4792`    | Three-stage divider-biased CE amplifier   | Five of a row of six resistors' values, only crowded by grounds, were lifted a row.                                                                 |
| `ag-309`     | Telescopic cascode amplifier              | M13's name was moved under its transistor, out of its mirror with M12's.                                                                            |
| `6b7s8kaqky` | Two-stage op amp employing cascoding      | M6's name was lifted between M6 and M8, out of their column.                                                                                        |
| `ss2hsg8c7j` | High-slew-rate op amp                     | M1, M3 and M5 were moved down beside their grounds.                                                                                                 |
| `xztx7khz65` | Dual-edge asynchronous time comparator    | MP's name went round to its transistor's far side, MN's under VDD's name.                                                                           |
| `qy2d4c57sp` | Comparator                                | C_L was moved across its capacitor, away from its 0.1pF.                                                                                            |
| `ve832ef9mm` | Floating charge transferrer (AI)          | CSp's 1pF was moved above its CSp.                                                                                                                  |
| `ag-1306`    | Power converters                          | A VDD name was turned over its bar; CO was moved beside S3's Pin.                                                                                   |
| `bfzpwrhc4s` | Bias-enhanced ring amplifier              | Two VDD names were turned over their bars, unlike the drawing's others.                                                                             |

Keep the ids: their value is that the labels are where their authors left
them.
