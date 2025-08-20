'use client';
import { useEffect, useState } from 'react';

type Row = { pos: number; user_id: string; email: string; elo: number };

export default function RankingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const specialty = sp?.get('specialty') || 'neuro';

  useEffect(() => {
    (async () => {
      setLoading(true);
      const r = await fetch(`/api/ranking?specialty=${encodeURIComponent(specialty)}&limit=10`);
      const j = await r.json();
      setRows(j.rows || []);
      setLoading(false);
    })();
  }, [specialty]);

  if (loading) return <main className="p-4">Cargando ranking…</main>;
  
  // en app/ranking/page.tsx, después del loading:
  if (!rows.length) {
    return (
      <main className="mx-auto max-w-xl p-4">
        <h1 className="text-2xl font-semibold mb-4">Top 10 — {specialty.toUpperCase()}</h1>
        <p className="text-gray-600 mb-4">Aún no hay jugadores en esta especialidad.</p>
        <a href="/soloQ" className="inline-block rounded bg-blue-600 px-4 py-2 text-white">Jugar una partida</a>
      </main>
    );
  }


  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-semibold mb-4">Top 10 — {specialty.toUpperCase()}</h1>
      <ol className="space-y-2">
        {rows.map((r) => (
          <li key={r.user_id} className="flex justify-between border rounded p-2">
            <span>#{r.pos} — {r.email}</span>
            <b className="tabular-nums">{r.elo}</b>
          </li>
        ))}
      </ol>
    </main>
  );
}
