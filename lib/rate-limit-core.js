// Rate limits are counted by the RateLimiter Durable Object (server/rate-limiter.ts), one instance per
// limit and key, shared by every Worker instance. Without it, or while it doesn't answer, the same limits
// are counted in this instance's memory: weaker, but a script hammering one form still gets stopped.
const memory = new Map();
const MAX_MEMORY_KEYS = 10_000;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const REPORT_EVERY_MINUTES = 30;
let lastReportAt = 0;

// Windows look like "10 m", "1 h".
export function windowMs(window) {
	const [amount, unit] = String(window).trim().split(/\s+/);
	return Number(amount) * (UNIT_MS[unit] ?? Number.NaN);
}

export function isLimitedInMemory({ name, limit, window, key }, now = Date.now()) {
	const id = `${name}:${key}`;
	const hits = (memory.get(id) ?? []).filter((time) => now - time < windowMs(window));
	const isLimited = hits.length >= limit;
	if (!isLimited) hits.push(now);
	// Re-inserting keeps the Map in order of last use, so the oldest key goes first when it's full.
	memory.delete(id);
	memory.set(id, hits);
	if (memory.size > MAX_MEMORY_KEYS) memory.delete(memory.keys().next().value);
	return isLimited;
}

// Logged, and reported (alert email) at most every 30 minutes per instance, so an outage doesn't write a
// line for every request.
async function reportUnavailable(name, error, onUnavailable) {
	if (Date.now() - lastReportAt < REPORT_EVERY_MINUTES * 60_000) return;
	lastReportAt = Date.now();
	console.error(`[rate-limit] ${name} unavailable, counting in memory:`, error.message);
	try {
		await onUnavailable?.(name, error, REPORT_EVERY_MINUTES);
	} catch (reportError) {
		console.error("[rate-limit] Alert failed:", reportError.message);
	}
}

// limiter.limit(key) answers { success }; true means the request may go through.
export async function checkRateLimit(options, limiter, onUnavailable) {
	if (!limiter) return isLimitedInMemory(options);
	try {
		const { success, reason } = await limiter.limit(options.key);
		if (reason === "timeout") throw new Error("Rate limiter timed out");
		return !success;
	} catch (error) {
		await reportUnavailable(options.name, error, onUnavailable);
		return isLimitedInMemory(options);
	}
}

// Cloudflare sets cf-connecting-ip to the visitor's address; the others cover local dev and proxies.
export function getClientIp(headers) {
	const cloudflare = headers.get("cf-connecting-ip");
	if (cloudflare) return cloudflare.trim();
	const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0].trim();
	return forwardedFor || headers.get("x-real-ip") || "unknown";
}
