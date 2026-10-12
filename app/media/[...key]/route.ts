import { env } from "cloudflare:workers";
import { IMAGE_CACHE_CONTROL } from "@/lib/blob";

const KEY_PATTERN = /^images\/[a-z0-9-]{1,80}\.(png|jpg|gif|webp)$/;

// Uploaded images, read from R2 when no public R2 domain is set (IMAGES_PUBLIC_URL).
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
	const key = (await params).key.join("/");
	if (!KEY_PATTERN.test(key)) return new Response("Not found", { status: 404 });

	const object = await env.IMAGES.get(key);
	if (!object) return new Response("Not found", { status: 404 });

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("etag", object.httpEtag);
	headers.set("cache-control", IMAGE_CACHE_CONTROL);
	headers.set("x-content-type-options", "nosniff");
	return new Response(object.body, { headers });
}
