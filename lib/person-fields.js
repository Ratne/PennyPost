// Shared by the CSV import (in the browser), the API and the profile form, so it imports nothing.
export const MAX_NAME_LENGTH = 100;
export const MAX_PHONE_LENGTH = 32;
const PHONE_PATTERN = /^\+?[\d\s\-().]{3,}$/;

function cleanText(value, max) {
	const text = String(value ?? "")
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.trim()
		.replace(/\s+/g, " ");
	return text.slice(0, max);
}

// Digits, spaces, dashes and one leading +. Anything else isn't a phone number and is refused.
export function normalizePhone(value) {
	const text = cleanText(value, MAX_PHONE_LENGTH + 10).replace(/[().]/g, " ").replace(/\s+/g, " ").trim();
	if (!text) return { phone: "" };
	if (!PHONE_PATTERN.test(text) || text.replace(/\D/g, "").length < 3 || text.length > MAX_PHONE_LENGTH) {
		return { error: "Phone can only use digits, spaces, dashes and a leading +" };
	}
	return { phone: text };
}

// "Jane van der Berg" splits on the first space: first name "Jane", last name "van der Berg".
export function splitFullName(value) {
	const text = cleanText(value, MAX_NAME_LENGTH * 2);
	const space = text.indexOf(" ");
	if (space === -1) return { firstName: text, lastName: "" };
	return { firstName: text.slice(0, space), lastName: text.slice(space + 1) };
}

// Empty strings mean "no value"; undefined means "not given", so an import or API call never wipes a name.
export function normalizePersonFields({ firstName, lastName, phone } = {}) {
	const fields = {};
	if (firstName !== undefined && firstName !== null) fields.firstName = cleanText(firstName, MAX_NAME_LENGTH);
	if (lastName !== undefined && lastName !== null) fields.lastName = cleanText(lastName, MAX_NAME_LENGTH);
	if (phone !== undefined && phone !== null) {
		const result = normalizePhone(phone);
		if (result.error) return { error: result.error };
		fields.phone = result.phone;
	}
	return { fields };
}

export function displayName(person) {
	return [person?.firstName, person?.lastName].filter(Boolean).join(" ");
}
