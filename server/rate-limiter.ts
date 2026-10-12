import { DurableObject } from "cloudflare:workers";

// A sliding window for one limit and key (idFromName("signup-ip:203.0.113.7")). Hits live in the
// object's SQLite storage; an alarm wipes it once the window has passed with no new hits, so idle keys
// cost nothing.
export class RateLimiter extends DurableObject<Env> {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
	}

	async limit(limit: number, windowMs: number) {
		if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
			throw new Error("Invalid rate limit");
		}
		// The alarm's deleteAll drops the table too, so it's created on every call (a no-op when it exists).
		this.sql.exec("CREATE TABLE IF NOT EXISTS hits (at INTEGER NOT NULL)");
		const now = Date.now();
		this.sql.exec("DELETE FROM hits WHERE at <= ?", now - windowMs);
		const count = this.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM hits").one().count;
		if (count >= limit) return { success: false, remaining: 0 };
		this.sql.exec("INSERT INTO hits (at) VALUES (?)", now);
		await this.ctx.storage.setAlarm(now + windowMs);
		return { success: true, remaining: limit - count - 1 };
	}

	async alarm() {
		await this.ctx.storage.deleteAll();
	}
}
