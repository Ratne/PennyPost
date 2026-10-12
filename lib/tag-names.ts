export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_CONTACT = 50;
export const TAG_COLORS = ["gray", "red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink"];

// Tags are shared by every newsletter and compared without case: "VIP" and "vip" are one tag.
export function normalizeTagName(value: unknown) {
	if (typeof value !== "string") return null;
	const name = value.trim().replace(/\s+/g, " ").toLowerCase().slice(0, MAX_TAG_LENGTH);
	return name || null;
}

export function normalizeTagNames(values: unknown) {
	const list = Array.isArray(values) ? values : typeof values === "string" ? values.split(/[,;|]/) : [];
	return [...new Set(list.map(normalizeTagName).filter((name): name is string => Boolean(name)))].slice(0, MAX_TAGS_PER_CONTACT);
}
