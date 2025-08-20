import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/me?email=...  |  /api/me?uid=...
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const email = sp.get('email');
  const uid = sp.get('uid');

  if (!email && !uid) {
    return NextResponse.json({ error: 'email or uid required' }, { status: 400 });
  }

  const q = admin.from('users').select('id, email, specialty, elo, games_played');

  const { data, error } = uid
    ? await q.eq('id', uid).maybeSingle()      // si tu id = Firebase UID (TEXT)
    : await q.eq('email', email!).maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  return NextResponse.json({ user: data });
}
