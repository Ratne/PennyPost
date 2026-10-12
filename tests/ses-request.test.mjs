import assert from "node:assert/strict";
import { test } from "node:test";
import { getSendErrorAction } from "../lib/sending-rules.js";
import { buildSendEmailBody, getSesEndpoint, toSesError } from "../lib/ses-request.js";

test("builds the SES v2 SendEmail body", () => {
	const body = buildSendEmailBody({
		from: '"Weekly" <hi@mail.example.com>',
		to: "jane@example.com",
		replyTo: "reply@example.com",
		subject: "Hello",
		html: "<p>Hi</p>",
		text: "Hi",
		headers: { "List-Unsubscribe": "<https://x/u>" },
		tags: [{ name: "message_id", value: "abc" }],
		configurationSet: "newsletter",
	});
	assert.deepEqual(body.Destination, { ToAddresses: ["jane@example.com"] });
	assert.deepEqual(body.ReplyToAddresses, ["reply@example.com"]);
	assert.equal(body.ConfigurationSetName, "newsletter");
	assert.deepEqual(body.EmailTags, [{ Name: "message_id", Value: "abc" }]);
	assert.equal(body.Content.Simple.Subject.Data, "Hello");
	assert.equal(body.Content.Simple.Body.Text.Data, "Hi");
	assert.deepEqual(body.Content.Simple.Headers, [{ Name: "List-Unsubscribe", Value: "<https://x/u>" }]);
});

test("leaves out optional fields", () => {
	const body = buildSendEmailBody({ from: "a@b.co", to: "c@d.co", subject: "s", html: "<p>h</p>" });
	assert.equal(body.ReplyToAddresses, undefined);
	assert.equal(body.ConfigurationSetName, undefined);
	assert.equal(body.EmailTags, undefined);
	assert.equal(body.Content.Simple.Body.Text, undefined);
	assert.equal(body.Content.Simple.Headers, undefined);
});

test("endpoint per region", () => {
	assert.equal(getSesEndpoint("eu-west-1"), "https://email.eu-west-1.amazonaws.com");
});

test("maps SES errors to the names the sending rules act on", () => {
	const throttled = toSesError({
		status: 429,
		errorType: "TooManyRequestsException:http://internal.amazon.com/coral/com.amazon.coral.service/",
		body: '{"message":"Maximum sending rate exceeded."}',
	});
	assert.equal(throttled.name, "TooManyRequestsException");
	assert.equal(throttled.message, "Maximum sending rate exceeded.");
	assert.equal(getSendErrorAction(throttled), "retry");

	const paused = toSesError({ status: 400, errorType: null, body: '{"__type":"com.amazon#SendingPausedException","message":"paused"}' });
	assert.equal(paused.name, "SendingPausedException");
	assert.equal(getSendErrorAction(paused), "pause");

	const rejected = toSesError({ status: 400, errorType: "MessageRejected", body: '{"message":"Email address is not verified."}' });
	assert.equal(getSendErrorAction(rejected), "pause");

	const unknown = toSesError({ status: 500, errorType: null, body: "oops" });
	assert.equal(unknown.name, "SesError");
	assert.equal(getSendErrorAction(unknown), "fail");
});
