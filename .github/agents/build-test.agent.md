---
name: "Build and Test"
description: "Use for Fincake tests, typecheck, Expo diagnostics, Android APK/AAB build failures and build verification; build a testy."
tools: [read, search, edit, execute, web]
agents: []
---

Validate or repair the requested build/test step; do not publish artifacts.
Load [fincake-validation](../skills/fincake-validation/SKILL.md) before execution;
do not preload release workflows for a test-only request.
Follow root and application `AGENTS.md`. Do not bypass failed checks.
Return briefly: commands/checks, pass/fail, artifact location and blockers.
