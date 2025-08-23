'use client'

import { useEffect, useRef, useState } from 'react'
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Q = {
  id: string
  stem: string
  options: string[]
  specialty: string
  correctIndex: number // 0-based; -1 si desconocido
}

type SoloQState = 'loading' | 'playing' | 'finished' | 'error'

const SECS_MIN = 25
const SECS_MAX = 35

// Si el backend ya baraja, puedes ponerlo en false.
const SHUFFLE_CLIENT = true

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Normaliza el índice correcto desde múltiples formatos: 0/1-based, texto o máscara */
function normalizeCorrectIndex(raw: any, options: any[]): number {
  // numéricos con diferentes nombres
  let ci: any =
    raw.correctIndex ??
    raw.correct_index ??
    raw.answerIndex ??
    raw.answer_index ??
    raw.solutionIndex ??
    raw.solution_index ??
    null

  // si venía como string numérico
  if (typeof ci === 'string' && ci.trim() !== '') {
    const n = Number(ci)
    if (Number.isFinite(n)) ci = n
  }

  // 1‑based → 0‑based
  if (typeof ci === 'number') {
    let n = ci
    if (n >= 1 && n <= options.length) n = n - 1
    if (n >= 0 && n < options.length) return n
  }

  // por texto exacto
  const textCandidate =
    raw.correct_option ??
    raw.correctValue ??
    raw.answer ??
    raw.solution ??
    null
  if (typeof textCandidate === 'string') {
    const idx = options.findIndex(o => String(o) === String(textCandidate))
    if (idx >= 0) return idx
  }

  // máscara booleana
  if (Array.isArray(raw.correct_mask) && raw.correct_mask.length === options.length) {
    const idx = raw.correct_mask.findIndex(Boolean)
    if (idx >= 0) return idx
  }

  return -1
}

export default function SoloQPage() {
  const router = useRouter()

  const [uid, setUid] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [dbUserId, setDbUserId] = useState<string>('')

  const [specialty, setSpecialty] = useState<string>('neuro')
  const [qs, setQs] = useState<Q[]>([])
  const [idx, setIdx] = useState(0)

  const [selected, setSelected] = useState<number | null>(null)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [corrects, setCorrects] = useState<number>(0)

  const [state, setState] = useState<SoloQState>('loading')
  const [posting, setPosting] = useState(false)
  const [errMsg, setErrMsg] = useState<string>('')

  // temporizador
  const [secsLeft, setSecsLeft] = useState<number>(SECS_MAX)
  const [allotted, setAllotted] = useState<number>(SECS_MAX)
  const tickRef = useRef<number | null>(null)
  const qStartRef = useRef<number | null>(null)
  const runLockRef = useRef<boolean>(false) // anti doble‑clic/reentradas
  const totalDurMsRef = useRef<number>(0)

  useEffect(() => {
    const auth = getAuth()
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setState('error'); return }
      setUid(u.uid)
      setEmail(u.email ?? null)

      try {
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

      await loadQuestions(specialty)
      setState('playing')
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recarga si cambia specialty tras /api/me
  useEffect(() => {
    (async () => {
      if (state !== 'playing' || !specialty) return
      if (qs.length > 0 && qs[0]?.specialty === specialty) return
      await loadQuestions(specialty)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialty])

  async function loadQuestions(spec: string) {
    const out = await fetch(`/api/questions?specialty=${encodeURIComponent(spec)}&limit=10`, { cache: 'no-store' })
    if (!out.ok) { setState('error'); return }
    const { questions } = await out.json()

    const typed: Q[] = (questions || []).map((raw: any) => {
      const options = Array.isArray(raw.options) ? raw.options.slice() : []
      const ci = normalizeCorrectIndex(raw, options)
      return {
        id: String(raw.id),
        stem: String(raw.stem),
        options,
        specialty: raw.specialty ?? spec,
        correctIndex: ci,
      }
    })

    // Evitar desalinear la correcta: solo barajamos si TODOS tienen índice válido
    const canShuffle = SHUFFLE_CLIENT && typed.every(q => q.correctIndex >= 0)
    const base = canShuffle ? shuffle(typed) : typed
    const finalQs = canShuffle
      ? base.map(q => {
          const idxs = q.options.map((_, i) => i)
          const perm = shuffle(idxs)
          const newOptions = perm.map(i => q.options[i])
          const newCorrect = perm.findIndex(i => i === q.correctIndex)
          return { ...q, options: newOptions, correctIndex: newCorrect }
        })
      : base

    clearTimer()
    setQs(finalQs)
    setIdx(0)
    setSelected(null)
    setIsCorrect(null)
    setCorrects(0)
    primeTimer()
  }

  const current = qs[idx]

  // temporizador
  function clearTimer() {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }
  function primeTimer() {
    clearTimer()
    const allot = randInt(SECS_MIN, SECS_MAX)
    setAllotted(allot)
    setSecsLeft(allot)
    qStartRef.current = Date.now()
    runLockRef.current = false
    tickRef.current = window.setInterval(() => {
      setSecsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(tickRef.current!)
          tickRef.current = null
          if (!runLockRef.current) {
            runLockRef.current = true
            onTimeout()
          }
          return 0
        }
        return s - 1
      })
    }, 1000)
  }
  function onTimeout() {
    if (qStartRef.current) {
      totalDurMsRef.current += Date.now() - qStartRef.current
      qStartRef.current = null
    }
    setSelected(-1) // sin selección
    setIsCorrect(false)
  }

  // selección con fallback a /api/answer si no hay índice fiable
  async function onSelect(i: number) {
    if (!current || selected != null || runLockRef.current) return
    runLockRef.current = true
    clearTimer()

    if (qStartRef.current) {
      totalDurMsRef.current += Date.now() - qStartRef.current
      qStartRef.current = null
    }

    setSelected(i)

    let ok = false
    if (current.correctIndex >= 0 && current.correctIndex < current.options.length) {
      ok = i === current.correctIndex
    } else {
      try {
        const res = await fetch('/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: current.id, selectedIndex: i }),
        })
        const json = await res.json()
        ok = !!json?.correct
        if (typeof json?.correctIndex === 'number') {
          current.correctIndex = json.correctIndex // opcional: cachear
        }
      } catch {
        ok = false
      }
    }

    setIsCorrect(ok)
    if (ok) setCorrects(c => c + 1)
  }

  // auth token
  async function getIdTokenOrThrow() {
    const auth = getAuth()
    const user = auth.currentUser
    if (!user) throw new Error('No user logged in')
    return user.getIdToken()
  }

  function goNext() {
    if (posting) return
    if (idx < qs.length - 1) {
      setIdx(i => i + 1)
      setSelected(null)
      setIsCorrect(null)
      runLockRef.current = false
      primeTimer()
    } else {
      finalize()
    }
  }

  async function finalize() {
    try {
      setPosting(true)
      setState('finished')

      if (!specialty) {
        setErrMsg('No hay especialidad definida.')
        return
      }

      clearTimer()
      if (qStartRef.current) {
        totalDurMsRef.current += Date.now() - qStartRef.current
        qStartRef.current = null
      }

      const idToken = await getIdTokenOrThrow()
      const payload = {
        specialty,
        correct: corrects,
        total: qs.length,
        duration_ms: Math.max(0, Math.round(totalDurMsRef.current)),
      }

      const r = await fetch('/api/games', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error al cerrar partida')

      const q = new URLSearchParams({
        eloDelta: String(j.delta ?? j.elo_delta ?? 0),
        eloAfter: String(j.new_elo ?? j.elo_after ?? ''),
        correct: String(corrects),
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

  // UI
  if (state === 'loading') return <div className="p-6">Preparando tu SoloQ…</div>
  if (state === 'error') return <div className="p-6">Error de sesión o carga. <Link className="underline" href="/login">Inicia sesión</Link></div>

  if (state === 'finished') {
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
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>Aciertos: {corrects}</span>
          <span>⏱ {secsLeft}s</span>
        </div>
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
                  selected != null && isSel && isCorrect === false ? 'bg-red-50 border-red-400' : '',
                  runLockRef.current ? 'pointer-events-none opacity-90' : ''
                ].join(' ')}
                disabled={selected != null}
              >
                {opt}
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">Tiempo asignado: {allotted}s</p>
          {(selected != null || secsLeft === 0) && (
            <div className="flex items-center gap-3">
              {selected != null && (
                <span className={`text-sm ${isCorrect ? 'text-green-600' : (selected === -1 ? 'text-orange-600' : 'text-red-600')}`}>
                  {isCorrect ? '¡Correcto!' : (selected === -1 ? 'Tiempo agotado' : 'Incorrecto')}
                </span>
              )}
              <button
                onClick={goNext}
                disabled={posting}
                className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {idx < qs.length - 1 ? 'Siguiente' : (posting ? 'Guardando…' : 'Finalizar')}
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
