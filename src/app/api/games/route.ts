// app/api/games/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) initializeApp();

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function calcEloDelta(oldElo: number, score: number, opponentElo = 1500, K = 32) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - oldElo) / 400));
  const delta = Math.round(K * (score - expected));
  return clamp(delta, -40, 40);
}

export async function POST(req: NextRequest) {
  try {
    // 1) Auth
    const authz = req.headers.get("authorization") || "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7) : undefined;
    if (!token) return NextResponse.json({ error: "missing_id_token" }, { status: 401 });
    const decoded = await getAuth().verifyIdToken(token);
    const uid = decoded.uid;               // Firebase UID (texto)
    const email = decoded.email || null;

    // 2) Body
    const body = await req.json();
    const { specialty, correct, total, duration_ms, opponent_elo } = body || {};
    if (!specialty || typeof correct !== "number" || typeof total !== "number") {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }
    if (!Number.isFinite(correct) || !Number.isFinite(total) || total < 1 || correct < 0 || correct > total) {
      return NextResponse.json({ error: "invalid_score" }, { status: 400 });
    }

    // 3) Encontrar (o crear) el usuario en DB y decidir el userId a usar
    let userId = uid;

    // Intenta por id = uid
    let { data: userRow, error: userErr } = await supa
      .from("users")
      .select("id, elo, elo_by_specialty, email")
      .eq("id", uid)
      .maybeSingle();

    if (!userRow && email) {
      // Intenta por email si la fila no existe con id=uid
      const { data: byEmail, error: emailErr } = await supa
        .from("users")
        .select("id, elo, elo_by_specialty, email")
        .eq("email", email)
        .maybeSingle();

      if (emailErr) return NextResponse.json({ error: emailErr.message }, { status: 500 });

      if (byEmail) {
        userRow = byEmail;
        userId = byEmail.id; // usa el id existente
      }
    }

    if (!userRow) {
      // Crear usuario con id = uid
      const { error: insUserErr } = await supa.from("users").insert({ id: uid, email, elo: 1200 });
      if (insUserErr) return NextResponse.json({ error: insUserErr.message }, { status: 500 });

      // vuelve a leer
      const reread = await supa
        .from("users")
        .select("id, elo, elo_by_specialty, email")
        .eq("id", uid)
        .maybeSingle();
      if (reread.error || !reread.data) {
        return NextResponse.json({ error: reread.error?.message || "user_create_read_failed" }, { status: 500 });
      }
      userRow = reread.data;
      userId = userRow.id;
    }

    const bySpec = (userRow.elo_by_specialty as Record<string, number> | null) || {};
    const currentElo =
      (typeof bySpec[specialty] === "number" ? bySpec[specialty] : undefined) ??
      (typeof userRow.elo === "number" ? userRow.elo : undefined) ??
      1200;

    // 4) Cálculo
    const score = correct / total;
    const delta = calcEloDelta(currentElo, score, opponent_elo ?? 1500);
    const newElo = currentElo + delta;

    // 5) Guardar partida
    const { error: insGameErr } = await supa.from("game_sessions").insert({
      user_id: userId, // usa el id que SÍ existe en users
      specialty,
      correct,
      total,
      duration_ms: Number.isFinite(duration_ms) ? duration_ms : null,
    });
    if (insGameErr) return NextResponse.json({ error: insGameErr.message }, { status: 500 });

    // 6) Historial ELO
    const { error: insEloErr } = await supa.from("elo_history").insert({
      user_id: userId,
      specialty,
      old_elo: currentElo,
      delta,
      new_elo: newElo,
    });
    if (insEloErr) return NextResponse.json({ error: insEloErr.message }, { status: 500 });

    // 7) Actualizar usuario
    const newBySpec = { ...(bySpec || {}) };
    newBySpec[specialty] = newElo;

    const { error: updErr } = await supa
      .from("users")
      .update({ elo: newElo, elo_by_specialty: newBySpec })
      .eq("id", userId);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // 8) Releer lo persistido
    const { data: userAfter, error: readAfterErr } = await supa
      .from("users")
      .select("elo, elo_by_specialty")
      .eq("id", userId)
      .maybeSingle();
    if (readAfterErr) return NextResponse.json({ error: readAfterErr.message }, { status: 500 });

    const afterBySpec = (userAfter?.elo_by_specialty as Record<string, number> | null) || {};
    const persistedAfter =
      (typeof afterBySpec[specialty] === "number" ? afterBySpec[specialty] : undefined) ??
      (typeof userAfter?.elo === "number" ? userAfter.elo : undefined) ??
      null;

    return NextResponse.json({
      ok: true,
      old_elo: currentElo,
      new_elo: newElo,
      delta,
      elo_after: newElo,
      elo_delta: delta,
      persisted_elo_after: persistedAfter,
      user_id_used: userId, // para que veas cuál se usó realmente
    });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "unexpected_error";
    const code = msg.includes("Firebase ID token") || msg.includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
