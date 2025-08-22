import { NextResponse } from 'next/server';
import { hitLimit } from '@/lib/rateLimiter';

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = `ratetest:${ip}`;
  const r = hitLimit(key, 10); // 10 req/min

  if (!r.ok) {
    return new NextResponse(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': String(r.remaining),
        'X-RateLimit-Reset': String(r.reset),
      },
    });
  }
  return NextResponse.json({ ok: true }, {
    headers: {
      'X-RateLimit-Remaining': String(r.remaining),
      'X-RateLimit-Reset': String(r.reset),
    },
  });
}
