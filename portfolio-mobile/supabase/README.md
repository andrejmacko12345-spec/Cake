# Account setup

1. Run [account-backups.sql](account-backups.sql) in your project's Supabase SQL Editor.
   Re-run the complete script when upgrading: the identity-bound RPC signatures
   replace the older signatures without deleting existing backups.
   The table is private, with per-user read access and authenticated RPCs for revision-checked writes and account deletion.
2. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   in the repository-root `.env`. Existing `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` names are also accepted there.
   Never use a secret or `service_role` key in the application.
3. Under Authentication, enable Email with **Confirm email**. Keep the default
   confirmation and reset-password email templates (links, no codes).
   Under Authentication → URL Configuration → Redirect URLs, allow
   `portfolio-mobile://settings` for the APK and `http://localhost:8081/settings`
   for local web testing. Add your production web origin's `/settings` URL when deployed.
   The password reset link must be opened on the device running the app.
   Confirmation on another device still allows subsequent email/password sign-in.
4. Configure production SMTP before public rollout; default email service limits apply.
5. In GitHub Settings → Secrets and variables → Actions → Variables, add
   `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Only these public values are passed to APK builds.
6. Restart Metro after environment changes. SecureStore requires a new native APK.

## Behaviour

- Guest data remains local and is preserved separately when signing in or out.
- An account with no backup explicitly asks whether to import the device's guest
  data or start empty. An existing backup always wins, including empty portfolios.
- Every backup/delete RPC includes the expected account ID. The server rejects it
  if it differs from the authenticated user, including during session switches.
- Normal sign-out pauses new local writes and drains pending writes before taking
  its final backup. A failed operation keeps the account open and reports the error.
- Changes are automatically backed up after a short debounce, with periodic retry
  and a manual backup button. Offline edits stay in local account storage. Errors
  remain visible; successful backup is required for normal sign-out.
- On the next sign-in/start, the cloud snapshot wins, as requested. Pending offline
  edits not yet backed up can therefore be replaced. Do not promise offline multi-device sync.
- Revisions prevent another device from silently overwriting a newer backup.
  If a conflict occurs, Profile offers an explicit restore from the account.
- Transactions, watchlists, language, compare settings, amount visibility, theme
  and event preferences are backed up. Quotes, caches and auth tokens are excluded.
  The restored theme applies after restarting the app, matching the existing theme system.
- Auth sessions use SecureStore on native and localStorage on web. User data is
  isolated by account ID; logging out returns to the guest portfolio.
- Users can delete their account and cloud backup after confirming their password.
  Backup operations are paused and any outstanding backup finishes before deletion.
  Local writes already in progress finish before cache removal; stale screens cannot
  recreate the deleted account's data. Guest data is unaffected.

## Administration and privacy

Supabase Authentication → Users shows registered users and last sign-in.
`account_backups.updated_at` shows the most recent successful backup. No behavioural
analytics or cross-app tracking is implemented.

Before distributing to real users, publish an operator-specific privacy policy
covering financial data, Supabase hosting region, retention, access and deletion,
and choose an appropriate data-processing agreement. Administrators can technically
access backup data; do not describe the backup as end-to-end encrypted.

## Acceptance checks

- Guest functionality works without Supabase credentials.
- New account → email confirmation link → initial backup.
- Add transaction/watchlist, sign out, sign in on another device → restore.
- Guest portfolio survives sign-in and sign-out without mixing account data.
- Account A cannot read/write/delete account B's backup via the public client.
- Failed/offline backup reports an error; restoring another device's newer backup
  requires the explicit restore action rather than an accidental overwrite.
- Password recovery with email link; delete own account and verify backup cascade.

## Google Play release gates

The app is not yet ready for production distribution:

- `npm run typecheck` and `npm test` must pass before every Android build.
- The current workflow produces a sideload APK, not a Play-signed production AAB.
  Set up a dedicated upload key or managed Expo signing and Play App Signing;
  never upload the development/debug signing key as the production key.
- Confirm the permanent Android application ID before the first Play release.
  Changing it later creates a different application.
- Configure and verify the two public Supabase variables in the cloud build.
- Test confirmation, password recovery, backup restore, account switching and
  deletion on a release build on a physical Android device.
- Publish a real privacy policy and an external account-deletion request URL on
  the Fincake website, and expose the privacy policy in the app.
- Complete Play Data safety, content rating, target audience and financial features
  declarations using the actual SDKs and data flows. Verify financial-data provider
  terms permit redistribution and commercial use; free API access is not a license.
- Pro subscription limits, prices, Google Play Billing, server-verified entitlements,
  restore purchases and subscription management are not implemented yet.
- Check current target API, 16 KB page-size support, permissions and device
  compatibility against the generated production AAB and Play's test reports.
- Complete any closed-testing requirement shown by the new Play Console account.
