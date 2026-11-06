---
name: fincake-bugfix
description: "Use for Fincake crashes, regressions, incorrect calculations and broken interactions; reproduce, fix and test a reported bug."
---

# Reproduce, trace, fix

1. Read `portfolio-mobile/AGENTS.md`. Extract expected/actual result, failing input
   and reproduction steps from existing evidence. Request only missing facts
   that block diagnosis; never request credentials or private portfolio dumps.
2. Reproduce with the smallest existing test or synthetic input. Follow the
   failing call/data path directly; narrow searches by symbol/path/file type.
   Inspect only relevant logs and the first actionable error.
3. Find the root cause and reuse existing helpers. Preserve financial precision,
   currency/unit semantics, persisted-data compatibility, UX and unrelated edits.
   Do not mask failures with broad catches, silent defaults or fabricated values.
4. Add/update a focused regression test in the existing test setup when feasible.
   Show that it fails for the defect and passes after the fix; if reproduction
   is device-only or unavailable, state that limitation explicitly.
5. From `portfolio-mobile/`, run the selected existing test with
   `node --test <test-file>` and required lint/typecheck. Broaden coverage only
   for affected shared behavior or evidence of wider regressions.
6. Verify the original failure and relevant boundaries, not merely compilation.
   Stop when fixed and verified; report unrelated defects without fixing them.

Return cause, change and actual check results. No publishing or store changes.
