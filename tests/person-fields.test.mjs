import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_NAME_LENGTH, displayName, normalizePersonFields, normalizePhone, splitFullName } from "../lib/person-fields.js";

test("phone numbers keep digits, spaces, dashes and a leading +", () => {
	assert.deepEqual(normalizePhone(" +39 (333) 123-4567 "), { phone: "+39 333 123-4567" });
	assert.deepEqual(normalizePhone("333.123.4567"), { phone: "333 123 4567" });
	assert.deepEqual(normalizePhone(""), { phone: "" });
	assert.ok(normalizePhone("call me").error);
	assert.ok(normalizePhone("12").error);
	assert.ok(normalizePhone("1".repeat(40)).error);
});

test("full names split on the first space", () => {
	assert.deepEqual(splitFullName("Jane van der Berg"), { firstName: "Jane", lastName: "van der Berg" });
	assert.deepEqual(splitFullName("  Cher  "), { firstName: "Cher", lastName: "" });
	assert.deepEqual(splitFullName(""), { firstName: "", lastName: "" });
});

test("fields that weren't given stay out, so nothing gets wiped", () => {
	assert.deepEqual(normalizePersonFields({}), { fields: {} });
	assert.deepEqual(normalizePersonFields({ firstName: "Ada", phone: undefined }), { fields: { firstName: "Ada" } });
	assert.deepEqual(normalizePersonFields({ lastName: "" }), { fields: { lastName: "" } });
});

test("names are cleaned and capped", () => {
	const { fields } = normalizePersonFields({ firstName: " Ada\u0000\n  Maria ", lastName: "x".repeat(MAX_NAME_LENGTH + 20) });
	assert.equal(fields.firstName, "Ada Maria");
	assert.equal(fields.lastName.length, MAX_NAME_LENGTH);
});

test("a bad phone refuses the whole change", () => {
	assert.ok(normalizePersonFields({ firstName: "Ada", phone: "not a phone" }).error);
});

test("display names join what's there", () => {
	assert.equal(displayName({ firstName: "Ada", lastName: "Lovelace" }), "Ada Lovelace");
	assert.equal(displayName({ lastName: "Lovelace" }), "Lovelace");
	assert.equal(displayName(null), "");
});
