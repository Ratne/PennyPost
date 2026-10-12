// Dates (and anything else that is not plain JSON) cannot cross into client components.
export function serialize(value) {
	return JSON.parse(JSON.stringify(value));
}
