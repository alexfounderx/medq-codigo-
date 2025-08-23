// app/api/games/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getApps, initializeApp, cert, applicationDefault } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { hitLimit } from "@/lib/rateLimiter"

// 👇 Asegura runtime Node (firebase-admin no funciona en Edge)
export const runtime = "nodejs"

// ✅ Init Firebase Admin (service account preferido; ADC como fallback local)
if (!getApps().length) {
  const hasSA =
    !!process.env.FIREBASE_PROJECT_ID &&
    !!process.env.FIREBASE_CLIENT_EMAIL &&
    !!process.env.FIREBASE_PRIVATE_KEY

  if (hasSA) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      }),
    })
  } else {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    })
  }
}

// 🗄️ Supabase con Service Role (solo en servidor)
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Utils
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
function calcEloDelta(oldElo: number, score: number, opponentElo = 1500, K = 32) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - oldElo) / 400))
  const delta = Math.round(K * (score - expected))
  return clamp(delta, -40, 40) // límite suave
}

function json(res: any, status = 200, extraHeaders?: Record<string, string>) {
  return new NextResponse(JSON.stringify(res), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
  })
}

export async function POST(req: NextRequest) {
  // --- Rate limit (10 req/min) por IP+UID (UID opcional) ---
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const uidHeader = req.headers.get("x-user-id") || ""
  const rl = hitLimit(`games:${ip}:${uidHeader}`, 10)
  if (!rl.ok) {
    return json(
      { error: "rate_limited" },
      429,
      { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
    )
  }

  try {
    // 1) Auth (Firebase ID token)
    const authz = req.headers.get("authorization") || ""
    const token = authz.startsWith("Bearer ") ? authz.slice(7) : undefined
    if (!token) {
      return json(
        { error: "missing_id_token" },
        401,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }

    const decoded = await getAuth().verifyIdToken(token)
    const uid = decoded.uid
    const email = decoded.email || null

    // 2) Body + validaciones estrictas
    let body: any
    try {
      body = await req.json()
    } catch {
      return json(
        { error: "invalid_json_body" },
        400,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }

    const specialty = typeof body?.specialty === "string" ? body.specialty.trim() : ""
    const correct = Number(body?.correct)
    const total = Number(body?.total)
    const duration_ms = Number(body?.duration_ms)
    const opponent_elo = body?.opponent_elo != null ? Number(body.opponent_elo) : undefined

    if (!specialty) {
      return json(
        { error: "missing_specialty" },
        400,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }
    // enteros:
    if (!Number.isInteger(correct) || !Number.isInteger(total)) {
      return json(
        { error: "correct_total_must_be_integers" },
        400,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }
    if (total < 5 || correct < 0 || correct > total) {
      return json(
        { error: "invalid_score_bounds" },
        400,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }
    if (!Number.isInteger(duration_ms) || duration_ms < 0) {
      return json(
        { error: "duration_ms_invalid" },
        400,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }

    // 3) Encontrar (o crear) el usuario (id = Firebase UID por diseño)
    let userId = uid

    let { data: userRow, error: userErr } = await supa
      .from("users")
      .select("id, elo, elo_by_specialty, email")
      .eq("id", uid)
      .maybeSingle()

    if (userErr) return json(
      { error: userErr.message },
      500,
      { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
    )

    if (!userRow && email) {
      const { data: byEmail, error: emailErr } = await supa
        .from("users")
        .select("id, elo, elo_by_specialty, email")
        .eq("email", email)
        .maybeSingle()
      if (emailErr) return json(
        { error: emailErr.message },
        500,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
      if (byEmail) {
        userRow = byEmail
        userId = byEmail.id
      }
    }

    if (!userRow) {
      const { error: insUserErr } = await supa.from("users").insert({ id: uid, email, elo: 1200, elo_by_specialty: {} })
      if (insUserErr) return json(
        { error: insUserErr.message },
        500,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
      const reread = await supa
        .from("users")
        .select("id, elo, elo_by_specialty, email")
        .eq("id", uid)
        .maybeSingle()
      if (reread.error || !reread.data) {
        return json(
          { error: reread.error?.message || "user_create_read_failed" },
          500,
          { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
        )
      }
      userRow = reread.data
      userId = userRow.id
    }

    // 4) Cálculo ELO (con clamp y “oponente” 1500 por defecto)
    const bySpec: Record<string, number> = (userRow.elo_by_specialty as any) ?? {}
    const currentElo =
      (Number.isFinite(bySpec[specialty]) ? bySpec[specialty] : undefined) ??
      (Number.isFinite(userRow.elo) ? userRow.elo : undefined) ??
      1200

    const score = correct / total
    const delta = calcEloDelta(currentElo, score, Number.isFinite(opponent_elo!) ? opponent_elo : 1500)
    const newElo = currentElo + delta

    // 5) Guardar partida
    {
      const { error: insGameErr } = await supa.from("game_sessions").insert({
        user_id: userId,
        specialty,
        correct,
        total,
        duration_ms,
      })
      if (insGameErr) return json(
        { error: insGameErr.message },
        500,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }

    // 6) Historial ELO
    {
      const { error: insEloErr } = await supa.from("elo_history").insert({
        user_id: userId,
        specialty,
        old_elo: currentElo,
        delta,
        new_elo: newElo,
        correct,
        total,
        score,          // guarda score para auditoría
        duration_ms,
      })
      if (insEloErr) return json(
        { error: insEloErr.message },
        500,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }

    // 7) Actualizar usuario (JSON por especialidad + elo “global” opcional)
    const newBySpec = { ...(bySpec || {}) }
    newBySpec[specialty] = newElo

    {
      const { error: updErr } = await supa
        .from("users")
        .update({ elo: newElo, elo_by_specialty: newBySpec })
        .eq("id", userId)
      if (updErr) return json(
        { error: updErr.message },
        500,
        { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
      )
    }

    // 8) Respuesta
    return json(
      {
        ok: true,
        old_elo: currentElo,
        new_elo: newElo,
        delta,
        elo_after: newElo,
        elo_delta: delta,
        user_id_used: userId,
      },
      200,
      { "X-RateLimit-Remaining": String(rl.remaining), "X-RateLimit-Reset": String(rl.reset) }
    )
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "unexpected_error"
    const code =
      msg.includes("Firebase ID token") || msg.toLowerCase().includes("auth") ? 401 : 500
    return json(
      { error: msg },
      code,
      { "X-RateLimit-Remaining": "0" }
    )
  }
}
