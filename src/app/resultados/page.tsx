'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function ResultadosPage() {
  const sp = useSearchParams();
  const router = useRouter();

  const eloDelta = Number(sp.get('eloDelta') ?? '0');
  const eloAfter = Number(sp.get('eloAfter') ?? '0');
  const correct = Number(sp.get('correct') ?? '0');
  const total = Number(sp.get('total') ?? '0');
  const specialty = sp.get('specialty') ?? '';

  // 👇 Redirige en efecto, no en render
  useEffect(() => {
    if (!sp.get('eloAfter')) {
      router.replace('/dashboard');
    }
  }, [sp, router]);

  // Si no hay params aún, muestra placeholder (evita navegar en render)
  if (!sp.get('eloAfter')) {
    return <main className="p-4">Redirigiendo…</main>;
  }

  const positive = eloDelta >= 0;

  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Resultados</h1>

      <div className="rounded-lg border p-4 mb-4">
        <p className="mb-1">Aciertos: <b>{correct}/{total}</b></p>
        <p className="mb-1">ELO actual: <b className="tabular-nums">{eloAfter}</b></p>
        <p className={positive ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
          {positive ? '▲' : '▼'} {eloDelta >= 0 ? `+${eloDelta}` : eloDelta} puntos
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => router.push(`/ranking?specialty=${encodeURIComponent(specialty)}`)}
          className="rounded bg-black px-4 py-2 text-white"
        >
          Ver ranking — {specialty || 'todas'}
        </button>
        <button
          onClick={() => router.push('/soloQ')}
          className="rounded border px-4 py-2"
        >
          Jugar otra vez
        </button>
      </div>
    </main>
  );
}
