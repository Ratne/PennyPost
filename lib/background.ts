import { waitUntil } from "cloudflare:workers";

// Work that runs after the response is sent (Next's after(), on Workers' waitUntil). Errors are logged,
// never thrown: background work must not break the request that started it.
export function after(task: () => unknown) {
	waitUntil(
		Promise.resolve()
			.then(task)
			.catch((error) => console.error("[background] Task failed:", error?.message ?? error))
	);
}
