# AAB build, upload or rollout

Read `portfolio-mobile/AGENTS.md`, the relevant release/blocker sections in
`portfolio-mobile/store/GOOGLE-PLAY.md`, `app.json` and `eas.json`.
App commands run from `portfolio-mobile/`.

1. Verify app/package, versionCode, requested track and current Console release.
   Check existing builds/uploads first; reuse a verified matching AAB instead of
   rebuilding. Confirm signing/update compatibility; never replace keys casually.
2. For readiness checks run `npm run store:check`. For an authorized new build use
   `npm run build:android:store`, which gates the production EAS AAB on that check.
   Do not bypass failures. A metadata-only edit does not need a new build.
3. Verify the build completed and the AAB's package, versionCode, source and
   signing evidence match the intended release. GitHub APK is not a Play bundle.
4. Inspect current submission configuration/access. The initial `eas.json` has no
   submit profile; do not assume automation or first-upload support. Use an
   available authorized Console/API/EAS route; missing access is a blocker.
5. Upload only to the authorized app/track. Read back the accepted bundle/version
   and validation errors. Review release notes and required declarations without
   inventing answers or changing scope.
6. Submit or roll out only if requested. Verify each authorized transition from
   live state; upload, draft, review submission, approval and rollout differ.
   Monitor the specific operation, not repeated whole-console snapshots.

Stop at the requested state or blocker. Report build/Console link and exact state;
do not claim a pending review is an available production release.
