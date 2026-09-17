# Pattern-specific schematic expression

Use only the row supported by the Snapshot's actual model, parameter and
connectivity facts. These are composition suggestions, not classifiers or
proof of electrical performance.

| Evidenced relationship | Show clearly | Preserve exceptions |
| --- | --- | --- |
| CMOS complementary pair with shared gates/drains | One input branch and one output node; PMOS above NMOS when useful | Separate body/supply domains; avoid a small wire box around shared gates |
| Differential devices with paired inputs and shared tail structure | Local pair, discoverable tail and distinct load/output paths | Degeneration, unequal loading, deliberate offset and common-mode circuitry |
| Mirror reference and output branches sharing control | Traceable reference connection, adjacent ratio-ordered outputs and clear common control | Cascode, startup, compliance and different body/source domains |
| Weighted array or ladder with ordered taps | Repeated unit geometry, visible weight/tap order and shared plate/trunk | Dummy, bridge, split-array, calibration and termination elements |
| Switched storage/reference paths | Stable sampling/summing node; local phase/control labels off signal routes | Reset, precharge, complementary switch bodies and alternate references |
| Cross-coupled/sequential feedback | Distinguishable return paths and state nodes | Clock controls must not obscure opposing feedback directions |

For a long repeated row, a compact matrix may read better if order remains
explicit. For repeated hierarchical units, expose common connections through
one clear rail or boundary convention rather than redundant labels at every
pin. Matching artwork alone is not evidence of any row's electrical relation.
