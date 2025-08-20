// src/lib/ensureProfile.ts
import { auth } from "@/lib/firebase";
import { supabase } from "@/lib/supabase";

export async function ensureUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;

  // ¿Existe ya?
  const { data: existing, error: selErr } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.uid)
    .maybeSingle();

  if (selErr) throw selErr;

  if (!existing) {
    const { error: insErr } = await supabase.from("users").insert({
      id: user.uid,
      email: user.email,
      display_name: user.displayName ?? user.email?.split("@")[0] ?? "usuario",
      // specialty: null (onboarding la completará)
      // elo: 1000 (default)
    });
    if (insErr) throw insErr;
  }

  return user.uid;
}
