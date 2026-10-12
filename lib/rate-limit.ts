import { env } from "cloudflare:workers";
import { after } from "@/lib/background";
import { checkRateLimit, windowMs } from "@/lib/rate-limit-core";

export { getClientIp, isLimitedInMemory } from "@/lib/rate-limit-core";

const TIMEOUT_MS = 2000;

type Limit = { name: string; limit: number; window: string; key: string };

function withTimeout<T>(promise: Promise<T>) {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Rate limiter timed out")), TIMEOUT_MS)),
	]);
}

// One Durable Object per limit and key: its count is strongly consistent across every Worker instance.
function getLimiter({ name, limit, window }: Omit<Limit, "key">) {
	const namespace = env.RATE_LIMITER;
	if (!namespace) return null;
	return {
		limit: (key: string) => withTimeout(namespace.get(namespace.idFromName(`${name}:${key}`)).limit(limit, windowMs(window))),
	};
}

function alertUnavailable(name: string, error: Error, cooldownMinutes: number) {
	after(async () => {
		const { sendAlert } = await import("@/lib/alerts");
		await sendAlert({
			key: "rate-limit-unavailable",
			title: "Rate limiter unavailable",
			detail: `The ${name} limit failed (${error.message}). Limits are counted in each Worker instance's memory until it's back.`,
			cooldownMinutes,
		});
	});
}

export function isRateLimited(options: Limit) {
	return checkRateLimit(options, getLimiter(options), alertUnavailable);
}
