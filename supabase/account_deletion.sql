-- Run this once in the Supabase dashboard: Project → SQL Editor → New query → Run.
-- Lets a signed in user permanently delete their own account and all of
-- their data in one step, from client code, without ever handing the app
-- a service role key. SECURITY DEFINER lets this function run with the
-- privileges of the user who created it (the table/schema owner), which is
-- the only way a plain "authenticated" role can delete a row from
-- auth.users, a schema normal users are never granted direct access to.
--
-- The function only ever touches auth.uid(), the caller's own id, so it
-- can't be used to delete anyone else's account.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.noticed_state where user_key = auth.uid()::text;
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
