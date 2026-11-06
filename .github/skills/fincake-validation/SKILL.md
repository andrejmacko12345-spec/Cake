---
name: fincake-validation
description: "Use for Fincake targeted tests, typecheck, Expo diagnostics and APK/AAB build failures or artifact verification; build a testy."
---

# Smallest sufficient validation

Read `portfolio-mobile/AGENTS.md` and `package.json`; app commands below run from
`portfolio-mobile/`. Verify current scripts rather than trusting this table forever.

| Requested result | First relevant step |
| --- | --- |
| Specific regression | `node --test <test-file>` using an existing test |
| Type safety | `npm run typecheck` |
| Full test suite | `npm test` only when requested or scope requires it |
| Lint for app code | `npx expo lint` per local rules |
| Expo/config diagnosis | `npx expo-doctor` only for relevant failures |
| APK build | Inspect `.github/workflows/build-apk.yml`; cloud execution needs authorization |
| Play AAB build | Inspect `eas.json` and release blockers in `store/GOOGLE-PLAY.md`; use `npm run build:android:store` only when authorized |

- No application build for documentation-only changes. Do not install lint tooling
  or dependencies preemptively; missing configuration/tooling is a reported blocker.
- Restore/install dependencies only after a manifest change or actual missing
  dependency failure. Use the existing lockfile and Expo-compatible install rules.
- Inspect the first actionable failure, fix only its cause within scope, then
  rerun the affected check. Reuse unchanged passing checks; no repeated full suites.
- Windows local commands must be PowerShell-compatible; workflow Linux commands
  are CI-only. Never hand-edit generated native projects.
- Do not bypass store checks, launch duplicate builds or publish artifacts.
  Monitor the specific run with bounded output; avoid rapid polling.
- A build passes only after completed status and artifact/type/package/version
  checks; inspect signing evidence if relevant. State anything not verified.

Return executed commands, outcomes, artifact path/link if any, and blockers.
