'use client';

import { useSearchParams, useRouter } from 'next/navigation';

export default function ResultadosPage() {
  const sp = useSearchParams();
  const router = useRouter();

  // 1) Lee como strings (evita parpadeos/hidratación)
  const eloDeltaStr = sp.get('eloDelta');
  const eloAfterStr = sp.get('eloAfter');
  const correctStr  = sp.get('correct');
  const totalStr    = sp.get('total');
  const specialty   = sp.get('specialty') ?? '';

  // 2) Si faltan params, no redirigimos: informamos y damos opciones
  const hasAllParams =
    eloDeltaStr !== null &&
    eloAfterStr !== null &&
    correctStr  !== null &&
    totalStr    !== null &&
    specialty.length > 0;

  if (!hasAllParams) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <h1 className="mb-2 text-2xl font-semibold">Resultados</h1>
        <p className="text-sm text-gray-600 mb-4">
          No se han recibido los parámetros de la SoloQ.
          Finaliza una partida para ver el ELO ganado/perdido.
        </p>

        {/* Debug útil por si llegas sin params */}
        <pre className="mb-4 whitespace-pre-wrap text-xs text-gray-500 border rounded p-2 bg-gray-50">
{JSON.stringify({
  eloDelta: eloDeltaStr,
  eloAfter: eloAfterStr,
  correct: correctStr,
  total: totalStr,
  specialty,
}, null, 2)}
        </pre>

        <div className="flex gap-3">
          <button onClick={() => router.push('/soloQ')} className="rounded border px-4 py-2">
            Jugar una SoloQ
          </button>
          <button onClick={() => router.push('/dashboard')} className="rounded border px-4 py-2">
            Ir al panel
          </button>
        </div>
      </main>
    );
  }

  // 3) Con params presentes, parseamos números y renderizamos
  const eloDelta = Number(eloDeltaStr);
  const eloAfter = Number(eloAfterStr);
  const correct  = Number(correctStr);
  const total    = Number(totalStr);
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
