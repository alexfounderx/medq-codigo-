// app/api/games/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getApps, initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { hitLimit } from "@/lib/rateLimiter"; // ⬅️ asegúrate de tener este helper

// ✅ Init Firebase Admin (service account o ADC)
if (!getApps().length) {
  const hasSA =
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY;

  if (hasSA) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      }),
    });
  } else {
    initializeApp({
      credential: applicationDefault(),
      projectId:
        process.env.FIREBASE_PROJECT_ID ||
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  }
}

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Utils
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function calcEloDelta(oldElo: number, score: number, opponentElo = 1500, K = 32) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - oldElo) / 400));
  const delta = Math.round(K * (score - expected));
  return clamp(delta, -40, 40); // clamp suave
}

export async function POST(req: NextRequest) {
  // --- Rate limit (10 req/min) por IP+UID ---
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const uidHeader = req.headers.get("x-user-id") || ""; // opcional si lo pasas desde el cliente
  const scope = "games";
  const rl = hitLimit(`${scope}:${ip}:${uidHeader}`, 10);
  if (!rl.ok) {
    return new NextResponse(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RateLimit-Reset": String(rl.reset),
      },
    });
  }

  try {
    // 1) Auth (Firebase ID token)
    const authz = req.headers.get("authorization") || "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7) : undefined;
    if (!token) {
      return new NextResponse(JSON.stringify({ error: "missing_id_token" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }

    const decoded = await getAuth().verifyIdToken(token);
    const uid = decoded.uid;             // Firebase UID (TEXT)
    const email = decoded.email || null;

    // 2) Body + validaciones
    const body = await req.json().catch(() => ({}));
    const { specialty, correct, total, duration_ms, opponent_elo } = body || {};

    if (typeof specialty !== "string" || !specialty.trim()) {
      return new NextResponse(JSON.stringify({ error: "missing_specialty" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }
    if (!Number.isFinite(correct) || !Number.isFinite(total)) {
      return new NextResponse(JSON.stringify({ error: "score_not_numeric" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }
    if (total < 5 || correct < 0 || correct > total) {
      return new NextResponse(JSON.stringify({ error: "invalid_score_bounds" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }

    // 3) Encontrar (o crear) el usuario
    let userId: string = uid;

    let { data: userRow, error: userErr } = await supa
      .from("users")
      .select("id, elo, elo_by_specialty, email")
      .eq("id", uid)
      .maybeSingle();

    if (userErr) {
      return new NextResponse(JSON.stringify({ error: userErr.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }

    if (!userRow && email) {
      const { data: byEmail, error: emailErr } = await supa
        .from("users")
        .select("id, elo, elo_by_specialty, email")
        .eq("email", email)
        .maybeSingle();

      if (emailErr) {
        return new NextResponse(JSON.stringify({ error: emailErr.message }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": String(rl.remaining),
            "X-RateLimit-Reset": String(rl.reset),
          },
        });
      }

      if (byEmail) {
        userRow = byEmail;
        userId = byEmail.id; // usa el id existente
      }
    }

    if (!userRow) {
      const { error: insUserErr } = await supa.from("users").insert({ id: uid, email, elo: 1200 });
      if (insUserErr) {
        return new NextResponse(JSON.stringify({ error: insUserErr.message }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": String(rl.remaining),
            "X-RateLimit-Reset": String(rl.reset),
          },
        });
      }
      const reread = await supa
        .from("users")
        .select("id, elo, elo_by_specialty, email")
        .eq("id", uid)
        .maybeSingle();
      if (reread.error || !reread.data) {
        return new NextResponse(JSON.stringify({ error: reread.error?.message || "user_create_read_failed" }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": String(rl.remaining),
            "X-RateLimit-Reset": String(rl.reset),
          },
        });
      }
      userRow = reread.data;
      userId = userRow.id;
    }

    // 4) Cálculo ELO (con clamp)
    const bySpec = (userRow.elo_by_specialty as Record<string, number> | null) || {};
    const currentElo =
      (typeof bySpec[specialty] === "number" ? bySpec[specialty] : undefined) ??
      (typeof userRow.elo === "number" ? userRow.elo : undefined) ??
      1200;

    const score = correct / total;
    const delta = calcEloDelta(currentElo, score, opponent_elo ?? 1500);
    const newElo = currentElo + delta;

    // 5) Guardar partida
    const { error: insGameErr } = await supa.from("game_sessions").insert({
      user_id: userId,
      specialty,
      correct,
      total,
      duration_ms: Number.isFinite(duration_ms) ? duration_ms : null,
    });
    if (insGameErr) {
      return new NextResponse(JSON.stringify({ error: insGameErr.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }

    // 6) Historial ELO
    const { error: insEloErr } = await supa.from("elo_history").insert({
      user_id: userId,
      specialty,
      old_elo: currentElo,
      delta,
      new_elo: newElo,
    });
    if (insEloErr) {
      return new NextResponse(JSON.stringify({ error: insEloErr.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }

    // 7) Actualizar usuario
    const newBySpec = { ...(bySpec || {}) };
    newBySpec[specialty] = newElo;

    const { error: updErr } = await supa
      .from("users")
      .update({ elo: newElo, elo_by_specialty: newBySpec })
      .eq("id", userId);
    if (updErr) {
      return new NextResponse(JSON.stringify({ error: updErr.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }

    // 8) Releer lo persistido (sanity)
    const { data: userAfter, error: readAfterErr } = await supa
      .from("users")
      .select("elo, elo_by_specialty")
      .eq("id", userId)
      .maybeSingle();
    if (readAfterErr) {
      return new NextResponse(JSON.stringify({ error: readAfterErr.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      });
    }

    const afterBySpec = (userAfter?.elo_by_specialty as Record<string, number> | null) || {};
    const persistedAfter =
      (typeof afterBySpec[specialty] === "number" ? afterBySpec[specialty] : undefined) ??
      (typeof userAfter?.elo === "number" ? userAfter.elo : undefined) ??
      null;

    return new NextResponse(
      JSON.stringify({
        ok: true,
        old_elo: currentElo,
        new_elo: newElo,
        delta,
        elo_after: newElo,
        elo_delta: delta,
        persisted_elo_after: persistedAfter,
        user_id_used: userId,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": String(rl.remaining),
          "X-RateLimit-Reset": String(rl.reset),
        },
      }
    );
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "unexpected_error";
    const code = msg.includes("Firebase ID token") || msg.includes("auth") ? 401 : 500;
    return new NextResponse(JSON.stringify({ error: msg }), {
      status: code,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": "0", // conservador
      },
    });
  }
}
