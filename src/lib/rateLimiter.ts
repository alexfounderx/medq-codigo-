// In-memory rate limiter (dev / 1 instancia)
const buckets = new Map<string, { count: number; reset: number }>();

export function hitLimit(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.reset) {
    const obj = { count: 1, reset: now + windowMs };
    buckets.set(key, obj);
    return { ok: true, remaining: limit - 1, reset: obj.reset };
  }
  if (entry.count >= limit) return { ok: false, remaining: 0, reset: entry.reset };
  entry.count += 1;
  return { ok: true, remaining: limit - entry.count, reset: entry.reset };
}
