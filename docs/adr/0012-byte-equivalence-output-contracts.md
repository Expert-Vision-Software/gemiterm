# Byte-equivalence contracts on user-visible output

Command output (`list` non-interactive, `fetch`, auth/status menus, export progress) is treated as a recorded baseline: refactors must leave it **byte-identical**, asserted by tests that pass without editing expected output. New features opt into shape changes explicitly (e.g. the `PROFILE` column exists only under `--all-profiles`; JSON fields are omitted, never null-filled, when unset).

## Why

Repeatedly, the cheapest regression signal for this CLI was exact-output comparison — formatting drift was the first symptom of deeper dispatch bugs, and human eyeballs on TUI output do not scale. The cost is that cosmetic changes now require a deliberate, test-visible decision rather than an incidental edit.
