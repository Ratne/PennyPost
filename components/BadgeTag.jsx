import Link from "next/link";
import { cn } from "@/lib/utils";

export const TAG_TONES = {
	gray: "bg-zinc-400 dark:bg-zinc-500",
	red: "bg-red-500",
	orange: "bg-orange-500",
	amber: "bg-amber-500",
	green: "bg-emerald-500",
	teal: "bg-teal-500",
	blue: "bg-sky-500",
	indigo: "bg-indigo-500",
	violet: "bg-violet-500",
	pink: "bg-pink-500",
};

export default function BadgeTag({ tag, href, className, children }) {
	const classes = cn(
		"inline-flex h-5 max-w-40 shrink-0 items-center gap-1.5 rounded-full pr-2 pl-1.5 text-xs font-normal whitespace-nowrap text-foreground/75 shadow-border",
		href && "transition-colors duration-150 hover:bg-muted hover:text-foreground",
		className
	);
	const content = (
		<>
			<span className={cn("size-1.5 shrink-0 rounded-full", TAG_TONES[tag.color] ?? TAG_TONES.gray)} />
			<span className="truncate">{tag.name}</span>
			{children}
		</>
	);
	if (!href) return <span className={classes}>{content}</span>;
	return (
		<Link href={href} scroll={false} className={classes}>
			{content}
		</Link>
	);
}
