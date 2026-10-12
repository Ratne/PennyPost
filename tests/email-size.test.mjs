import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTrackedBytes, listImageUrls } from "../lib/email-size.js";
import { addTracking } from "../lib/tracking.js";

process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-characters";

const BASE_URL = "https://mail.example.com";
const MESSAGE_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

test("the size estimate matches the tracked HTML exactly", () => {
	const html = `<html><body><p>Read <a href="https://example.com/a?x=1&amp;y=2">this</a> and
<a href='https://example.org/é'>that</a>.</p><a href="https://mail.example.com/unsubscribe?token=abc">Unsubscribe</a></body></html>`;
	const tracked = addTracking(html, { baseUrl: BASE_URL, messageId: MESSAGE_ID });
	assert.equal(estimateTrackedBytes(html, BASE_URL), Buffer.byteLength(tracked));
});

test("only remote images are listed, once each", () => {
	const html = `<img src="https://cdn.example.com/a.png"><img src='https://cdn.example.com/a.png'><img src="blob:x"><img src="/local.png">`;
	assert.deepEqual(listImageUrls(html), ["https://cdn.example.com/a.png"]);
});
