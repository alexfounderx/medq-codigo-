'use client'

import { useEffect, useState } from 'react'
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Q = { id: string; stem: string; options: string[]; specialty: string }

export default function SoloQPage() {
  const router = useRouter()

  const [uid, setUid] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)

  // id de tu fila en public.users (TEXT si usas Firebase UID)
  const [dbUserId, setDbUserId] = useState<string>('')

  const [specialty, setSpecialty] = useState<string>('neuro')
  const [qs, setQs] = useState<Q[]>([])
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [corrects, setCorrects] = useState<number>(0)

  const [state, setState] = useState<'loading'|'playing'|'finished'|'error'>('loading')
  const [posting, setPosting] = useState(false)
  const [errMsg, setErrMsg] = useState<string>('')

  useEffect(() => {
    const auth = getAuth()
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setState('error'); return }
      setUid(u.uid)
      setEmail(u.email ?? null)

      try {
        // Cargar perfil (id + specialty) por UID
        const r = await fetch(`/api/me?uid=${encodeURIComponent(u.uid)}`, { cache: 'no-store' })
        if (r.ok) {
          const j = await r.json()
          if (j?.user?.id) setDbUserId(j.user.id)
          if (j?.user?.specialty) setSpecialty(j.user.specialty)
        } else {
          setErrMsg('No se pudo cargar tu perfil.')
        }
      } catch {
        setErrMsg('Error cargando tu perfil.')
      }

      // Cargar 10 preguntas iniciales
      const out = await fetch(`/api/questions?specialty=${encodeURIComponent(specialty)}&limit=10`, { cache: 'no-store' })
      if (!out.ok) { setState('error'); return }
      const { questions } = await out.json()
      setQs(questions || [])
      setState('playing')
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Si specialty cambia tras /api/me, recargar preguntas una vez
  useEffect(() => {
    (async () => {
      if (state !== 'playing' || !specialty) return
      if (qs.length > 0 && qs[0]?.specialty === specialty) return
      const out = await fetch(`/api/questions?specialty=${encodeURIComponent(specialty)}&limit=10`, { cache: 'no-store' })
      if (out.ok) {
        const { questions } = await out.json()
        setQs(questions || [])
        setIdx(0)
        setSelected(null)
        setIsCorrect(null)
        setCorrects(0)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialty])

  const current = qs[idx]

  async function onSelect(i: number) {
    if (!current || selected != null) return
    setSelected(i)
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: current.id, selectedIndex: i })
      })
      const json = await res.json()
      const ok = !!json?.correct
      setIsCorrect(ok)
      if (ok) setCorrects(c => c + 1)
    } catch {
      setIsCorrect(false)
    }
  }

  // 🔐 Utilidad: obtener ID token o lanzar error claro
  async function getIdTokenOrThrow() {
    const auth = getAuth()
    const user = auth.currentUser
    if (!user) throw new Error('No user logged in')
    return user.getIdToken()
  }

  async function next() {
    if (selected == null || posting) return

    if (idx < qs.length - 1) {
      setIdx(i => i + 1)
      setSelected(null)
      setIsCorrect(null)
    } else {
      // Fin: cerrar partida → /resultados
      try {
        setPosting(true)
        setState('finished')

        const finalCorrects = corrects // ya actualizado en onSelect

        if (!specialty) {
          setErrMsg('No hay especialidad definida.')
          return
        }

        // ⬇️⬇️ CAMBIO CLAVE: añadir Authorization: Bearer <ID_TOKEN> ⬇️⬇️
        const idToken = await getIdTokenOrThrow()

        // El backend ignora user_id/email y usa uid del token verificado
        const payload = {
          specialty,
          correct: finalCorrects,
          total: qs.length,
          // opcional: duration_ms si lo calculas
        }

        const r = await fetch('/api/games', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`, // 👈 necesarios para evitar missing_id_token
          },
          body: JSON.stringify(payload),
        })

        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'Error al cerrar partida')

        // Si tu /api/games devuelve { old_elo, new_elo, delta }
        const q = new URLSearchParams({
          eloDelta: String(j.delta ?? j.elo_delta ?? 0),
          eloAfter: String(j.new_elo ?? j.elo_after ?? ''),
          correct: String(finalCorrects),
          total: String(qs.length),
          specialty,
        })
        router.push(`/resultados?${q.toString()}`)
      } catch (e: any) {
        console.error(e)
        setErrMsg(e?.message || 'Error al cerrar partida')
        setState('finished')
      } finally {
        setPosting(false)
      }
    }
  }

  if (state === 'loading') return <div className="p-6">Preparando tu SoloQ…</div>
  if (state === 'error') return <div className="p-6">Error de sesión o carga. <Link className="underline" href="/login">Inicia sesión</Link></div>

  if (state === 'finished') {
    // Fallback mientras redirige o si hubo error
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-semibold">¡Partida terminada!</h1>
        <p className="text-lg">Resultado: {corrects}/{qs.length} ({Math.round((corrects/qs.length)*100)}%)</p>
        {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        <div className="flex gap-3">
          <Link href="/soloQ" className="px-4 py-2 rounded-md bg-blue-600 text-white">Jugar otra</Link>
          <Link href="/dashboard" className="px-4 py-2 rounded-md border">Ver dashboard</Link>
        </div>
      </div>
    )
  }

  if (!current) return <div className="p-6">No hay preguntas para {specialty} todavía.</div>

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">SoloQ – {specialty}</h1>
          <p className="text-sm text-gray-500">Pregunta {idx + 1} de {qs.length}</p>
        </div>
        <div className="text-sm text-gray-500">Aciertos: {corrects}</div>
      </header>

      <section className="border rounded-lg p-5">
        <p className="text-lg font-medium">{current.stem}</p>
        <div className="mt-4 grid gap-3">
          {current.options.map((opt, i) => {
            const isSel = selected === i
            return (
              <button
                key={i}
                onClick={() => onSelect(i)}
                className={[
                  'w-full text-left border rounded-md px-4 py-3 transition',
                  isSel ? 'ring-2 ring-blue-500' : '',
                  selected != null && isSel && isCorrect === true ? 'bg-green-50 border-green-400' : '',
                  selected != null && isSel && isCorrect === false ? 'bg-red-50 border-red-400' : ''
                ].join(' ')}
                disabled={selected != null}
              >
                {opt}
              </button>
            )
          })}
        </div>

        {selected != null && (
          <div className="mt-4 flex items-center justify-between">
            <p className={`text-sm ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
              {isCorrect ? '¡Correcto!' : 'Incorrecto'}
            </p>
            <button
              onClick={next}
              disabled={posting}
              className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {idx < qs.length - 1 ? 'Siguiente' : (posting ? 'Guardando…' : 'Finalizar')}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
