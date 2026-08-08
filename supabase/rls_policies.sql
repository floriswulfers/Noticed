-- Run this once in the Supabase dashboard: Project → SQL Editor → New query → Run.
-- It locks the noticed_state table down so a signed in user can only ever
-- read or write their own row. Without this, the app's login screen keeps
-- people apart, but the database itself would still hand back anyone's
-- data to anyone holding the public anon key.
--
-- The GRANT below is required and separate from the policies: RLS policies
-- only restrict WHICH rows a role can see once it already has base access
-- to the table. Without the GRANT, Postgres rejects every query with
-- "permission denied for table noticed_state" before RLS is even
-- evaluated — this was the actual cause of saves/loads silently failing.
-- Only "authenticated" gets access; signed out visitors (the "anon" role)
-- should never be able to touch this table.

grant select, insert, update on public.noticed_state to authenticated;

alter table noticed_state enable row level security;

create policy "select own state"
  on noticed_state for select
  using (auth.uid()::text = user_key);

create policy "insert own state"
  on noticed_state for insert
  with check (auth.uid()::text = user_key);

create policy "update own state"
  on noticed_state for update
  using (auth.uid()::text = user_key)
  with check (auth.uid()::text = user_key);
