"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { supabase } from "@/lib/supabase";

const SPECIALTIES = ["cardio","neuro","derma","pedia","interna","uro","trauma","cirugia","gine","psiq","neumo"];

export default function SelectSpecialty() {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) { router.replace("/login"); return; }
    (async () => {
      const { data } = await supabase
        .from("users")
        .select("specialty")
        .eq("id", u.uid)
        .maybeSingle();
      if (data?.specialty) router.replace("/dashboard");
      else setLoading(false);
    })();
  }, [router]);

  const save = async () => {
    if (!selected) return;
    const u = auth.currentUser!;
    // Intenta guardar la especialidad del usuario logueado
    const { error } = await supabase
      .from("users")
      .update({ specialty: selected })
      .eq("id", u.uid);
  
    if (error) {
      // No navegues si no se guardó: muestra el error y qué hacer
      alert(`No se pudo guardar la especialidad.\n\nDetalles: ${error.message}\n\nSi te sigue pasando, revisa en Supabase la política RLS de la tabla "users" para permitir update cuando auth.uid() = id.`);
      return;
    }
  
    // ✅ Guardado correcto: ahora sí navega a SoloQ (o a dashboard si prefieres)
    router.replace("/soloQ");
  };
  

  if (loading) return <p>Cargando…</p>;

  return (
    <main className="max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Elige tu especialidad</h1>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {SPECIALTIES.map(s => (
          <button
            key={s}
            onClick={() => setSelected(s)}
            className={`border rounded-xl p-3 ${selected === s ? "ring-2" : ""}`}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>
      <button
        onClick={save}
        disabled={!selected}
        className="w-full rounded-xl p-3 border"
      >
        Continuar
      </button>
    </main>
  );
}
