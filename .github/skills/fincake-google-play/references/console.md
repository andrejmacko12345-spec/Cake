# Focused Play Console edits

1. Open the intended app and read the current values in the affected Console
   section. Confirm the requested delta, locale and save/publish scope.
2. Read only the matching repository sources and checklist sections:
   - Listing/locales: `portfolio-mobile/store/listing.json`.
   - Privacy/support/pages: `portfolio-mobile/store/privacy-content.json` and
     `public-details.json` in that directory.
   - Data safety/app content: relevant `store/GOOGLE-PLAY.md` sections and actual
     app behavior needed to establish truthful answers, not guesses.
   - Screenshots: use a real current build with non-private sample data.
3. Change only requested fields. Reuse the current page and targeted reads;
   no whole-console audit or repeated screenshots after every action.
4. For local store asset preparation read applicable app rules and use existing
   generators. Run `npm run store:check` from `portfolio-mobile/` when relevant.
   `npm run store:pages:draft` is local preview only; final `npm run store:pages`
   requires satisfied prerequisites. Never publish drafts or placeholders.
5. Save, then reopen/read back affected fields and validation status. Distinguish
   a saved draft from changes submitted or published; submit only if authorized.
6. Keep corresponding repository metadata/docs consistent with verified changes.
   No build for Console-only text edits; if changed content ships in the app,
   identify the required app update without silently building/publishing it.

Stop for missing eligibility/rights information or legal/product decisions.
Do not enter identity/payment information or expose private data in evidence.
