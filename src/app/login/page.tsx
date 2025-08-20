"use client";

import { useState } from "react";
import { auth } from "../../lib/firebase"; // antes "@/lib/firebase"
import { useAuth } from "../../context/AuthContext";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";

// 👇 Importa tu función
import { ensureUserProfile } from "../../lib/ensureProfile";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  const handleSignup = async () => {
    setError(null);
    try {
      await createUserWithEmailAndPassword(auth, email, pass);

      // 👇 Crear/asegurar perfil en Supabase
      await ensureUserProfile();

      router.push("/dashboard");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleLogin = async () => {
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, pass);

      // 👇 Crear/asegurar perfil en Supabase
      await ensureUserProfile();

      router.push("/dashboard");
    } catch (e: any) {
      setError(e.message);
    }
  };

  if (loading) return <p>Cargando…</p>;

  if (user) {
    return (
      <div className="space-y-4">
        <p>Sesión iniciada como <b>{user.email}</b></p>
        <button className="border px-3 py-2 rounded" onClick={() => router.push("/dashboard")}>
          Ir al dashboard
        </button>
        <button className="border px-3 py-2 rounded" onClick={logout}>
          Cerrar sesión
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-sm space-y-3">
      <h1 className="text-xl font-bold">Acceso</h1>
      <input
        className="w-full border rounded px-3 py-2"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="w-full border rounded px-3 py-2"
        placeholder="Contraseña"
        type="password"
        value={pass}
        onChange={(e) => setPass(e.target.value)}
      />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button className="border px-3 py-2 rounded" onClick={handleLogin}>Entrar</button>
        <button className="border px-3 py-2 rounded" onClick={handleSignup}>Crear cuenta</button>
      </div>
    </div>
  );
}
