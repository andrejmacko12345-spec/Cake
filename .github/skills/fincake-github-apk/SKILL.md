---
name: fincake-github-apk
description: "Use for Fincake GitHub APK delivery, Actions runs, commits, pushes, tags and Releases; not Google Play."
---

# GitHub APK delivery

## Source and authorization

- Inspect git status, requested diff/source SHA and branch. Stage only in-scope
  paths; preserve unrelated changes. Ask only if source/action is ambiguous.
- Commit, push, dispatch workflows or modify releases only when explicitly
  requested. Do not force-push, amend or rewrite history without permission.
  Follow required commit attribution; never commit secrets/signing files.
- For commit/push-only requests stop after verifying that action; do not build.

## Build and publish, only when requested

1. Read applicable app rules, `.github/workflows/build-apk.yml` and
   `portfolio-mobile/version.txt`. Recheck current triggers/version calculation.
2. Reuse its manual dispatch or watched-path push to `main` with `[build]` in the
   commit message. Ordinary pushes can skip the job. Inspect existing runs for
   the source before dispatching; do not duplicate or silently cancel work.
3. Discover authenticated write/dispatch tools before acting. Read-only GitHub
   tools cannot publish. Use available CLI/browser only with authorized access;
   never claim an unavailable integration exists.
4. The workflow owns typecheck/tests, native generation, version calculation and
   publishing: `Fincake.apk` at `apk-latest`, plus the versioned APK/release.
   Do not repeat these locally or recreate the pipeline to bypass a failed check.
5. Follow the exact run to a terminal state, then verify its source SHA,
   successful build, intended tags and downloadable APK assets. Inspect only
   relevant job logs on failure; avoid rapid polling or dumping entire logs.
6. Report separately: commit/push, build and release status. A queued job,
   Actions artifact or existing `apk-latest` from another SHA is not completion.

Do not equate APK with AAB or claim signing/update compatibility without evidence.
Return only actual version, run/release/APK links, checks and blockers.
