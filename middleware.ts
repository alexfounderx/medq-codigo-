// middleware.ts (RAÍZ DEL PROYECTO)
import { NextRequest, NextResponse } from 'next/server'
export const config = { matcher: ['/api/:path*'] }
export default function middleware(_req: NextRequest) {
  return new NextResponse(JSON.stringify({ fromMiddleware: true }), {
    status: 418,
    headers: { 'Content-Type': 'application/json' },
  })
}
