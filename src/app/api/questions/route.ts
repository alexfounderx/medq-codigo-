// app/api/questions/route.ts
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hitLimit } from '@/lib/rateLimiter' // ⬅️ mismo helper que en /games

// util simple para barajar
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export async function GET(req: NextRequest) {
  // --- rate limit: 20 req/min por IP+UID ---
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const uid = req.headers.get('x-user-id') || '' // si lo pasas tras login
  const rl = hitLimit(`questions:${ip}:${uid}`, 20)
  if (!rl.ok) {
    return new NextResponse(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(rl.reset),
      },
    })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !/^https?:\/\//.test(url)) {
    return new NextResponse(JSON.stringify({ error: 'SUPABASE_URL missing or invalid', url }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(rl.reset),
      },
    })
  }
  if (!key) {
    return new NextResponse(JSON.stringify({ error: 'SUPABASE_SERVICE_ROLE_KEY missing' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(rl.reset),
      },
    })
  }

  const admin = createClient(url, key, { auth: { persistSession: false } })

  try {
    const sp = req.nextUrl.searchParams
    const specialty = sp.get('specialty')?.trim()
    const difficulty = sp.get('difficulty') ? Number(sp.get('difficulty')) : undefined
    const limitRaw = Number(sp.get('limit') ?? 10)
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 10

    if (!specialty) {
      return new NextResponse(JSON.stringify({ error: 'specialty_required' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': String(rl.remaining),
          'X-RateLimit-Reset': String(rl.reset),
        },
      })
    }

    type Row = {
      id: string
      stem: string
      options: string[]
      specialty: string
      correct_index?: number | null
      topic?: string | null
      difficulty?: number | null
    }

    let qs: Row[] = []

    // --- 1) RPC principal (ideal: hace ORDER BY random() en SQL) ---
    try {
      const { data, error } = await admin.rpc('get_random_questions', {
        spec: specialty,
        lim: limit,
        diff: difficulty ?? null, // si tu RPC lo soporta
      })
      if (error) throw error
      qs = (data as Row[]) ?? []
    } catch {
      // --- 2) Fallback sin random del lado DB; barajamos aquí ---
      let query = admin
        .from('questions')
        .select('id, stem, options, specialty, topic, difficulty')
        .eq('specialty', specialty)
        .limit(limit * 3) // traemos más y barajamos para “simular” aleatorio

      if (typeof difficulty === 'number') {
        query = query.eq('difficulty', difficulty)
      }

      const { data, error } = await query
      if (error) throw error

      const pool = Array.isArray(data) ? data : []
      qs = shuffle(pool).slice(0, limit)
    }

    // --- 3) Sanitizar: jamás enviar correct_index ---
    const sanitized = qs.map(q => ({
      id: q.id,
      stem: q.stem,
      options: q.options,
      specialty: q.specialty,
      topic: q.topic ?? null,
      difficulty: typeof q.difficulty === 'number' ? q.difficulty : null,
    }))

    return new NextResponse(JSON.stringify({ questions: sanitized }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'X-RateLimit-Remaining': String(rl.remaining),
        'X-RateLimit-Reset': String(rl.reset),
      },
    })
  } catch (err: any) {
    console.error('questions endpoint error:', err)
    return new NextResponse(
      JSON.stringify({
        error: String(err?.message || err),
        cause: err?.cause?.code || err?.code || null,
        details: err?.cause?.message || null,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': String(rl.remaining),
          'X-RateLimit-Reset': String(rl.reset),
        },
      }
    )
  }
}
