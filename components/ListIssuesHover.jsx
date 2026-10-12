"use client";

import { HoverImg } from "@/components/block/hover-img";

export default function ListIssuesHover({ issues }) {
	return <HoverImg list projects={issues} />;
}
