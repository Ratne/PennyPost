"use client";

import { useEffect, useState } from "react";
import { listImageUrls } from "./email-size.js";

// One HEAD request per picture for the whole session: uploaded files never change at a given URL.
const cache = new Map();

function fetchSize(url) {
	if (!cache.has(url)) {
		cache.set(
			url,
			fetch(url, { method: "HEAD" })
				.then((response) => {
					const length = Number(response.headers.get("content-length"));
					return response.ok && Number.isFinite(length) && length > 0 ? length : null;
				})
				// Other sites often refuse cross-origin requests: their size stays unknown.
				.catch(() => null)
		);
	}
	return cache.get(url);
}

// { bytes, count, unknown }: the total of the pictures whose size could be read, and how many couldn't.
export function useImageBytes(html) {
	const [result, setResult] = useState({ bytes: 0, count: 0, unknown: 0 });
	const key = listImageUrls(html).join("\n");

	useEffect(() => {
		const urls = key ? key.split("\n") : [];
		let isCurrent = true;
		Promise.all(urls.map(fetchSize)).then((sizes) => {
			if (!isCurrent) return;
			setResult({
				bytes: sizes.reduce((sum, size) => sum + (size ?? 0), 0),
				count: urls.length,
				unknown: sizes.filter((size) => size === null).length,
			});
		});
		return () => {
			isCurrent = false;
		};
	}, [key]);

	return result;
}
