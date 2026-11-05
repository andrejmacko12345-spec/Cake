# Supabase account feature retired

The Play Store app no longer includes Supabase authentication, account creation,
or cloud portfolio backups. Do not configure Supabase URL/key variables or
Supabase SMTP for the mobile app; the public `support@fincake.eu` mailbox is
for inbound support only.

The legacy SQL schema and any existing test-account records are intentionally
left untouched. This app change does not delete remote users or data. Do not
run database deletion or cleanup operations unless separately requested and
the exact records have been verified.

New app data is stored locally. Users can export/import transactions as CSV;
watchlists and settings do not currently have a transfer feature.
