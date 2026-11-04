-- Run in your Supabase project's SQL Editor, including when upgrading older installs.
begin;
create table if not exists public.account_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{"version":1,"values":{}}',
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint backup_shape check (
    payload->>'version' = '1'
    and jsonb_typeof(payload->'values') = 'object'
    and octet_length(payload::text) <= 10485760
  )
);

alter table public.account_backups enable row level security;
revoke all on public.account_backups from anon, authenticated;
grant select on public.account_backups to authenticated;
drop policy if exists "Read own backup" on public.account_backups;
create policy "Read own backup" on public.account_backups
  for select to authenticated using ((select auth.uid()) = user_id);

-- Updates are serialized and compare revisions, so another device cannot silently
-- overwrite a newer backup. Expected identity prevents session-switch data leaks.
drop function if exists public.save_account_backup(jsonb, integer);
create or replace function public.save_account_backup(p_payload jsonb, p_revision integer, p_user_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current_revision integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if p_user_id is distinct from uid then raise exception 'Account identity changed'; end if;
  if p_payload is null
    or p_payload->>'version' is distinct from '1'
    or jsonb_typeof(p_payload->'values') is distinct from 'object'
    or octet_length(p_payload::text) > 10485760 then
    raise exception 'Invalid backup';
  end if;
  insert into public.account_backups(user_id) values (uid) on conflict do nothing;
  select revision into current_revision from public.account_backups where user_id = uid for update;
  if p_revision is distinct from current_revision then
    raise exception 'A newer backup exists. Restore the account backup before saving.';
  end if;
  update public.account_backups
    set payload = p_payload, revision = revision + 1, updated_at = now()
    where user_id = uid returning revision into current_revision;
  return current_revision;
end;
$$;
revoke all on function public.save_account_backup(jsonb, integer, uuid) from public, anon;
grant execute on function public.save_account_backup(jsonb, integer, uuid) to authenticated;

drop function if exists public.delete_own_account();
create or replace function public.delete_own_account(p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'Account identity changed'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_own_account(uuid) from public, anon;
grant execute on function public.delete_own_account(uuid) to authenticated;
commit;
