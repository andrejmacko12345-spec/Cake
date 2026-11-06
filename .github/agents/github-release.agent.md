---
name: "GitHub APK"
description: "Use for uploading or publishing Fincake APKs on GitHub, Actions build runs, commits, pushes, tags and GitHub Releases."
agents: []
---

Handle the GitHub APK delivery path, not Google Play.
Load [fincake-github-apk](../skills/fincake-github-apk/SKILL.md) before release work;
for a commit-only task use only its source/authorization checks.
Follow root and applicable application `AGENTS.md`. Never publish without explicit
authorization, stage unrelated changes or equate queued work with completion.
Return briefly: commit/run, release link, APK link, version and checks or blockers.
