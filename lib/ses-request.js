// Pure helpers for the SES v2 REST API (https://docs.aws.amazon.com/ses/latest/APIReference-V2/),
// so the request shape and the error names the sending rules depend on are testable without AWS.

export function getSesEndpoint(region) {
	return `https://email.${region}.amazonaws.com`;
}

export function buildSendEmailBody({ from, to, replyTo, subject, html, text, headers = {}, tags = [], configurationSet }) {
	const body = { Html: { Data: html, Charset: "UTF-8" } };
	if (text) body.Text = { Data: text, Charset: "UTF-8" };
	const headerList = Object.entries(headers).map(([Name, Value]) => ({ Name, Value }));
	return {
		FromEmailAddress: from,
		Destination: { ToAddresses: [to] },
		...(replyTo && { ReplyToAddresses: [replyTo] }),
		...(configurationSet && { ConfigurationSetName: configurationSet }),
		...(tags.length > 0 && { EmailTags: tags.map(({ name, value }) => ({ Name: name, Value: value })) }),
		Content: {
			Simple: {
				Subject: { Data: subject, Charset: "UTF-8" },
				Body: body,
				...(headerList.length > 0 && { Headers: headerList }),
			},
		},
	};
}

// SES answers errors with x-amzn-ErrorType ("TooManyRequestsException:http://...") and a JSON body
// with a message. The error's name is what getSendErrorAction (lib/sending-rules.js) reads, like the
// AWS SDK's exception names.
export function toSesError({ status, errorType, body }) {
	let parsed = null;
	try {
		parsed = body ? JSON.parse(body) : null;
	} catch {
		parsed = null;
	}
	const rawType = errorType || parsed?.__type || parsed?.code || "";
	const name = String(rawType).split(":")[0].split("#").pop() || (status === 429 ? "TooManyRequestsException" : "SesError");
	const message = parsed?.message || parsed?.Message || body || `SES request failed with ${status}`;
	const error = new Error(String(message).slice(0, 500));
	error.name = name;
	error.status = status;
	return error;
}
