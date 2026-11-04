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
  Theme changes and restored themes apply immediately without restarting or
  remounting screens; open forms and navigation state are preserved.
- Account loading, first-backup choices and errors use the saved Slovak/English
  preference, including before the main screens mount. Restoring a backup restores
  its language too; signing out returns to the guest language.
- The home visibility button shares one account-scoped setting with analytics,
  forecasts, stock details, transaction history and dividends. Analytics masks monetary returns; hidden forecasts show
  cumulative percentage returns instead of balances and cash gains. Amounts stay
  hidden until the setting loads, and remain hidden if reading or saving fails.
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

- Analyse opens Projections first, with Compare second, using a shared selector
  with a sliding highlight and selection haptics for taps and completed swipes.
  Both financial tables use a rounded outer outline and support switching via swipe paging.
  Both panels stay mounted to preserve symbols and scenario inputs while switching.
  The legacy `/projections` link redirects to the Projections panel.
  Projections provides a three-year stock scenario. Each year
  uses the same four inputs: annual revenue growth, common net income growth
  and low/high P/E. Growth compounds annually; all three result columns fit
  the screen without horizontal scrolling, with compact statement totals.
  Editable revenue growth blends latest-quarter YoY (50%), latest TTM YoY (30%)
  and three-year annual revenue CAGR (20%). Missing components are omitted and
  remaining weights normalized; no valid component leaves the input blank.
  Quarterly/TTM observations must be within 190 days, annual within 550 days;
  comparisons match fiscal dates within 35 days. CAGR requires a full three-year span.
  This is an editable starting scenario, not a forecast.
  Net income growth still uses the arithmetic mean of up to three consecutive annual
  YoY changes, falling back to matching TTM history only when annual growth is unavailable.
  Comparatives require a positive prior-year value and the same currency.
  P/E bounds start at 75% and 125% of the three-year arithmetic mean of
  quarter-end closing price / matching reported TTM diluted EPS. Prices use
  split-adjusted closes, not dividend-adjusted total returns. Require at least
  nine observations spanning the three-year window; missing history leaves
  P/E blank with an explicit notice, never a current-P/E fallback.
  The projection denominator is implied by matching consolidated common income
  / reported diluted EPS (or matching diluted average shares for zero EPS),
  never a single share class's outstanding count. All inputs remain
  editable. Missing comparables remain blank rather than becoming zero.
  Projections searches directly in an inline text input (no modal focus handoff)
  and offers a compact dropdown of all open portfolio positions, without showing amounts.
  The selector opens a bounded, scrollable modal list so Android does not clip
  rows beyond the parent dropdown bounds; its header shows the full position count.
  Portfolio and Watchlist selectors share one compact row. The latter groups
  symbols by every saved watchlist, including custom names and empty-list states.
  It reads account-scoped storage, supports legacy arrays and follows saved changes.
  The result table is visible before selection with placeholder cells and disabled
  assumptions. Row heights use the measured table offset and viewport above
  navigation, reserving page padding and a bottom gap. Currency/period prose is
  omitted from the compact view. Very small/keyboard viewports retain overflow
  rather than shrinking rows below readable height.
  Vertical overflow remains available for keyboards/accessibility.
  Clearing the selected ticker resets inputs, results, errors and loading;
  pending fetches cannot repopulate the cleared view. Result rows are grouped
  into revenue/income, margin/EPS, price range and CAGR with distinct tones,
  section gaps and stronger prices. Negative CAGR remains red.
  The base is a matching, recent TTM statement pair, or a clearly labelled annual
  pair if TTM is unavailable. Statement and quote currencies must match.
  Shares outstanding stay constant; EPS uses common net income / shares.
  Price = EPS × P/E; CAGR uses the current quote and 1/2/3-year horizons, excluding
  dividends, fees and taxes. Nonpositive earnings have no P/E valuation.
  Scenario inputs are session-only, not backed up; test both SK/EN and live themes.

- Guest functionality works without Supabase credentials.
- New account → email confirmation link → initial backup.
- Add transaction/watchlist, sign out, sign in on another device → restore.
- Guest portfolio survives sign-in and sign-out without mixing account data.
- Account A cannot read/write/delete account B's backup via the public client.
- Failed/offline backup reports an error; restoring another device's newer backup
  requires the explicit restore action rather than an accidental overwrite.
- Password recovery with email link; delete own account and verify backup cascade.
- Check both Slovak and English for account setup, errors and transaction history.
  `npm test` also audits translation keys, hardcoded JSX prose and localized errors.

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
