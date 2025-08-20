export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: 'SUPABASE_URL missing or invalid', url }, { status: 500 })
  }
  if (!key) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY missing' }, { status: 500 })
  }

  const admin = createClient(url, key, { auth: { persistSession: false } })

  try {
    const sp = req.nextUrl.searchParams
    const specialty = sp.get('specialty')
    const limit = Number(sp.get('limit') ?? 10)
    if (!specialty) {
      return NextResponse.json({ error: 'specialty required' }, { status: 400 })
    }

    // --- 1) Intento con RPC ---
    let qs:
      | { id: string; stem: string; options: string[]; specialty: string; correct_index?: number }[]
      | null = null

    try {
      const { data, error } = await admin.rpc('get_random_questions', { spec: specialty, lim: limit })
      if (error) throw error
      qs = data ?? []
    } catch {
      // --- 2) Fallback sin RPC ---
      const { data, error } = await admin
        .from('questions')
        .select('id, stem, options, specialty')
        .eq('specialty', specialty)
        .order('random')
        .limit(limit)
      if (error) throw error
      qs = data ?? []
    }

    // --- 3) Stripping: NO enviar correct_index ---
    const sanitized = qs.map(q => ({
      id: q.id,
      stem: q.stem,
      options: q.options,
      specialty: q.specialty,
    }))

    return new NextResponse(JSON.stringify({ questions: sanitized }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  } catch (err: any) {
    console.error('Supabase fetch error:', err)
    return NextResponse.json(
      {
        error: String(err),
        cause: err?.cause?.code || err?.code || null,
        details: err?.cause?.message || null,
      },
      { status: 500 }
    )
  }
}
