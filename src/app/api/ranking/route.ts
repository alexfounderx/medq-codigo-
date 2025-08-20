import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const specialty = sp.get('specialty');
  const limit = Number(sp.get('limit') ?? 10);
  if (!specialty) return NextResponse.json({ error: 'specialty required' }, { status: 400 });

  // Case-insensitive por si hay 'NEURO'/'neuro'
  const { data, error } = await admin
    .from('users')
    .select('id, email, elo')
    .ilike('specialty', specialty) // compara sin mayúsculas/minúsculas
    .order('elo', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // añade posición localmente
  const rows = (data || []).map((u, i) => ({
    pos: i + 1,
    user_id: u.id,
    email: u.email,
    elo: u.elo,
  }));

  return NextResponse.json({ rows });
}
