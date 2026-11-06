# Project agent guide

The application is in `portfolio-mobile/`. Read its [local rules](portfolio-mobile/AGENTS.md)
before changing application code or running application commands.

## Efficient work

- Reply briefly in the user's language. Inspect only files needed for the task.
- Use the default agent for small tasks. For substantial specialist work, select
  one matching [custom agent](.github/agents/README.md), not a whole team.
- Delegate only a bounded task needing separate context. Do not have multiple
  agents repeat the same exploration, nest delegation, or edit the same files.
- Pass relevant paths, findings and acceptance criteria; return a short result,
  validation evidence and blockers rather than raw logs.
- Search for existing helpers first. Preserve unrelated work and avoid speculative
  refactors, dependency installs, full builds and repeated full test runs.
- Load only the skill matching the current task; agent files link to their workflow.
  Do not preload other agents, skills or release documentation.
- Start with supplied paths or a narrow symbol search; batch independent reads.
  Reuse established findings and check results until their inputs change.
- Keep command output bounded. For failures, inspect the first actionable error;
  for browser work, reuse the current page and read only the affected section.
- Run the smallest relevant validation, respecting application-local rules.
  Documentation-only changes need no application build.
- Never claim completion from a started command: verify its outcome.

## External changes

- Commit, push, publish artifacts, trigger cloud builds or modify Play Console
  only when explicitly requested; otherwise ask first. Authorization is limited
  to the requested action, app, repository and release track.
- Never include secrets, signing material or private user data in source,
  screenshots, logs or agent handoffs. Use existing authenticated tools.
- Missing access, failed checks and unverified external state are blockers,
  not successful results. Do not bypass release checks to finish a task.
