import { normalizePersonFields, normalizePhone, splitFullName } from "./person-fields.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COLUMN_ALIASES = {
	email: ["email", "emailaddress", "subscriberemail", "subscriber"],
	status: ["status", "subscriptionstatus", "subscriberstatus"],
	subscribedAt: [
		"createdat",
		"created",
		"subscribedat",
		"subscribedate",
		"subscriptiondate",
		"datesubscribed",
		"signupdate",
	],
	emailsReceived: ["emailsreceived", "totalemailsreceived", "received"],
	openRate: ["openrate", "uniqueopenrate", "totalopenrate"],
	clickRate: ["clickrate", "clickthroughrate", "uniqueclickrate", "ctr"],
	tags: ["tags", "tag", "labels", "label", "groups"],
	firstName: ["firstname", "first", "givenname", "fname"],
	lastName: ["lastname", "last", "surname", "familyname", "lname"],
	fullName: ["name", "fullname", "subscribername", "contactname"],
	phone: ["phone", "phonenumber", "mobile", "mobilephone", "mobilenumber", "telephone", "tel", "cell"],
};

const STATUS_ALIASES = {
	active: "active",
	subscribed: "active",
	inactive: "unsubscribed",
	unsubscribed: "unsubscribed",
	bounced: "bounced",
	invalid: "bounced",
	hardbounce: "bounced",
	complained: "complained",
	spam: "complained",
	spamreport: "complained",
	pending: "dormant",
	validating: "dormant",
	needsattention: "dormant",
	dormant: "dormant",
};

// An import can only move a contact to a stricter status, never back to active.
export const STATUS_RANK = { active: 0, dormant: 1, unsubscribed: 2, bounced: 3, complained: 4 };

export const MAX_IMPORT_ROWS_PER_REQUEST = 1000;
const MAX_TAG_LENGTH = 40;
const MAX_TAGS_PER_ROW = 20;

// Same rules as lib/tags.ts: trimmed, single spaces, lowercase.
export function normalizeTags(value) {
	const list = Array.isArray(value) ? value : String(value ?? "").split(/[,;|]/);
	const names = list
		.map((name) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH))
		.filter(Boolean);
	return [...new Set(names)].slice(0, MAX_TAGS_PER_ROW);
}

function normalizeKey(value) {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

export function mapColumns(headers) {
	const normalized = headers.map((header) => [header, normalizeKey(header)]);
	return Object.fromEntries(
		Object.entries(COLUMN_ALIASES).map(([field, aliases]) => [
			field,
			normalized.find(([, key]) => aliases.includes(key))?.[0] ?? null,
		])
	);
}

export function normalizeEmail(value) {
	const email = String(value ?? "")
		.trim()
		.toLowerCase();
	return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

export function normalizeStatus(value) {
	if (value === undefined || value === null || String(value).trim() === "") return "active";
	return STATUS_ALIASES[normalizeKey(value)] ?? "dormant";
}

export function normalizeRate(value) {
	const text = String(value ?? "").trim();
	if (!text) return undefined;
	const number = Number.parseFloat(text.replace("%", ""));
	if (!Number.isFinite(number) || number < 0) return undefined;
	const rate = text.includes("%") || number > 1 ? number / 100 : number;
	return Math.min(rate, 1);
}

function normalizeCount(value) {
	const number = Number.parseInt(String(value ?? "").replace(/[^\d]/g, ""), 10);
	return Number.isFinite(number) ? number : undefined;
}

function normalizeDate(value) {
	const time = Date.parse(String(value ?? ""));
	return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

export function normalizeImportRow(row, columns, { status: statusOverride } = {}) {
	const email = normalizeEmail(row[columns.email]);
	if (!email) return null;

	const fileStatus = columns.status ? normalizeStatus(row[columns.status]) : "active";
	const status =
		statusOverride && STATUS_RANK[statusOverride] > STATUS_RANK[fileStatus] ? statusOverride : fileStatus;

	return {
		email,
		status,
		subscribedAt: columns.subscribedAt ? normalizeDate(row[columns.subscribedAt]) : undefined,
		emailsReceived: columns.emailsReceived ? normalizeCount(row[columns.emailsReceived]) : undefined,
		openRate: columns.openRate ? normalizeRate(row[columns.openRate]) : undefined,
		clickRate: columns.clickRate ? normalizeRate(row[columns.clickRate]) : undefined,
		tags: columns.tags ? normalizeTags(row[columns.tags]) : [],
		...readPerson(row, columns),
	};
}

// Separate first and last name columns win over a single name column. A phone that doesn't look
// like one is left out; the row still imports.
function readPerson(row, columns) {
	const split = !columns.firstName && !columns.lastName && columns.fullName ? splitFullName(row[columns.fullName]) : {};
	const { fields } = normalizePersonFields({
		firstName: columns.firstName ? row[columns.firstName] : split.firstName,
		lastName: columns.lastName ? row[columns.lastName] : split.lastName,
	});
	const phone = columns.phone ? normalizePhone(row[columns.phone]).phone : undefined;
	return {
		firstName: fields.firstName || undefined,
		lastName: fields.lastName || undefined,
		phone: phone || undefined,
	};
}

function optionalNumber(value, max) {
	const number = Number(value);
	return value === undefined || value === null || !Number.isFinite(number) || number < 0
		? undefined
		: Math.min(number, max);
}

// Server side: rows come from the browser, so every field is checked again.
export function sanitizeImportRow(row) {
	const email = normalizeEmail(row?.email);
	if (!email || !Object.hasOwn(STATUS_RANK, row?.status)) return null;
	const subscribedAt = row.subscribedAt ? new Date(row.subscribedAt) : undefined;

	return {
		email,
		status: row.status,
		subscribedAt: subscribedAt && Number.isFinite(subscribedAt.getTime()) ? subscribedAt : undefined,
		emailsReceived: optionalNumber(row.emailsReceived, 1_000_000),
		openRate: optionalNumber(row.openRate, 1),
		clickRate: optionalNumber(row.clickRate, 1),
		tags: normalizeTags(row.tags),
		...readPerson(row, { firstName: "firstName", lastName: "lastName", phone: "phone" }),
	};
}
