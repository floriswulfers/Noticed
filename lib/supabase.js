import { createClient } from "@supabase/supabase-js";

// These come from your .env.local file — never hard-coded here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

/* ── accounts ────────────────────────────────────────
   Real login, via Supabase Auth (email + password).
   Each person's data is stored under their own account
   id (auth.uid()), and a Row Level Security policy in
   the database makes sure nobody can read or write
   anyone else's row. See supabase/rls_policies.sql.
   ─────────────────────────────────────────────────── */

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}

/* ── how the app remembers ──────────────────────────
   Everything a person keeps lives under their account
   id (userId) in the noticed_state table, one row per
   person.
   ─────────────────────────────────────────────────── */

export async function loadState(userId) {
  const { data, error } = await supabase
    .from("noticed_state")
    .select("data")
    .eq("user_key", userId)
    .maybeSingle();
  if (error) {
    console.error("noticed: load failed —", error.message, error);
    throw error;
  }
  return data ? data.data : null;
}

export async function saveState(userId, state) {
  const { error } = await supabase
    .from("noticed_state")
    .upsert(
      { user_key: userId, data: state, updated_at: new Date().toISOString() },
      { onConflict: "user_key" }
    );
  if (error) {
    console.error("noticed: save failed —", error.message, error);
    throw error;
  }
}
