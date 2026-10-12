import { useId } from "react";
import { cn } from "@/lib/utils";

const EDGE = [2, 7, 12, 16, 20, 25, 30];
const PERFORATIONS = [
	...EDGE.flatMap((x) => [
		[x, 2],
		[x, 30],
	]),
	...EDGE.slice(1, -1).flatMap((y) => [
		[2, y],
		[30, y],
	]),
];

export default function LogoApp({ className }) {
	const maskId = useId();
	return (
		<svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
			<mask id={maskId}>
				<rect width="32" height="32" fill="#fff" />
				{PERFORATIONS.map(([cx, cy]) => (
					<circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.5" fill="#000" />
				))}
			</mask>
			<rect x="2" y="2" width="28" height="28" mask={`url(#${maskId})`} className="fill-foreground" />
			<g fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-background">
				<rect x="8.5" y="11" width="15" height="10.5" rx="2" />
				<path d="m9.5 12.25 6.5 5 6.5-5" />
			</g>
		</svg>
	);
}
