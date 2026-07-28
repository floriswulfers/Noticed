import { createClient } from "@supabase/supabase-js";

// These come from your .env.local file — never hard-coded here.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key);

/* ── how the app remembers ──────────────────────────
   For tonight, each browser gets a private "user_key"
   stored on the device. Everything that person keeps
   lives under that key in the noticed_state table.
   In Session 3 this becomes a real login.
   ─────────────────────────────────────────────────── */

export function getUserKey() {
  if (typeof window === "undefined") return null;
  let k = window.localStorage.getItem("noticed_user_key");
  if (!k) {
    k = "u_" + crypto.randomUUID();
    window.localStorage.setItem("noticed_user_key", k);
  }
  return k;
}

export async function loadState(userKey) {
  const { data, error } = await supabase
    .from("noticed_state")
    .select("data")
    .eq("user_key", userKey)
    .maybeSingle();
  if (error) {
    console.error("load failed", error);
    return null;
  }
  return data ? data.data : null;
}

export async function saveState(userKey, state) {
  const { error } = await supabase
    .from("noticed_state")
    .upsert(
      { user_key: userKey, data: state, updated_at: new Date().toISOString() },
      { onConflict: "user_key" }
    );
  if (error) console.error("save failed", error);
}
