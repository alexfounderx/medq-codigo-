"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { supabase } from "@/lib/supabase";

type Profile = { display_name: string | null; specialty: string | null; elo: number };

export default function Dashboard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const router = useRouter();

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) { router.replace("/login"); return; }
    (async () => {
      const { data } = await supabase
        .from("users")
        .select("display_name, specialty, elo")
        .eq("id", u.uid)
        .maybeSingle();

      if (!data?.specialty) { router.replace("/onboarding/specialty"); return; }
      setProfile(data as Profile);
    })();
  }, [router]);

  if (!profile) return <p>Cargando…</p>;

  return (
    <main>
      <h1 className="text-2xl font-bold">Hola, {profile.display_name ?? "usuario"}</h1>
      <p className="mt-2">Especialidad: <b>{profile.specialty?.toUpperCase()}</b></p>
      <p>ELO: <b>{profile.elo}</b></p>

      <div className="mt-6 flex gap-3">
        <a href="/soloQ" className="border rounded-xl px-4 py-2">Jugar SoloQ</a>
        <a href="/ranking" className="border rounded-xl px-4 py-2">Ver ranking</a>
      </div>
    </main>
  );
}
