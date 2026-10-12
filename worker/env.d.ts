import type { RateLimiter } from "@/server/rate-limiter";

declare global {
	interface Env {
		ASSETS: Fetcher;
		DB: D1Database;
		IMAGES: R2Bucket;
		SEND_QUEUE: Queue<{ messageIds: string[] }>;
		EVENTS_QUEUE: Queue<unknown>;
		RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
		APP_URL: string;
		SENDING_ENABLED: string;
		SES_REGION: string;
		SEND_RATE_PER_SECOND: string;
		IMAGES_PUBLIC_URL: string;
		ADMIN_EMAIL?: string;
		ADMIN_PASSWORD?: string;
		SESSION_SECRET: string;
		EMAILABLE_API_KEY?: string;
		SES_ACCESS_KEY_ID?: string;
		SES_SECRET_ACCESS_KEY?: string;
		SES_CONFIGURATION_SET?: string;
		SES_SNS_TOPIC_ARN?: string;
		ALERT_FROM?: string;
		ARCHIVE_HOSTS?: string;
	}
}

declare global {
	namespace Cloudflare {
		interface Env extends globalThis.Env {}
	}
}

export {};
