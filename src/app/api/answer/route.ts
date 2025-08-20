export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'server env not set' }, { status: 500 })

  const admin = createClient(url, key, { auth: { persistSession: false } })

  const { questionId, selectedIndex } = await req.json()
  if (!questionId || typeof selectedIndex !== 'number') {
    return NextResponse.json({ error: 'questionId and selectedIndex required' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('questions')
    .select('correct_index')
    .eq('id', questionId)
    .single()

  if (error || !data) return NextResponse.json({ error: 'question not found' }, { status: 404 })

  const correct = selectedIndex === data.correct_index
  return NextResponse.json({ correct })
}
