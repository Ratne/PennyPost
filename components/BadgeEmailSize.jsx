"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LIMITS } from "@/lib/config";
import { formatKilobytes } from "@/lib/email-size";
import { useImageBytes } from "@/lib/use-image-bytes";
import { cn } from "@/lib/utils";

// htmlBytes is the HTML as sent (tracked links included), which is what Gmail clips at about 100 KB.
export default function BadgeEmailSize({ htmlBytes, html }) {
	const images = useImageBytes(html);
	const isOver = htmlBytes > LIMITS.maxEmailBytes;
	const known = images.count - images.unknown;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					tabIndex={0}
					className={cn(
						"cursor-default rounded text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
						isOver ? "font-medium text-destructive" : "text-muted-foreground"
					)}
				>
					{formatKilobytes(htmlBytes)}
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="max-w-64 text-left">
				<dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 tabular-nums">
					<dt>HTML, as sent</dt>
					<dd className="text-right">{formatKilobytes(htmlBytes)}</dd>
					<dt>Images{images.count > 0 && ` (${images.count})`}</dt>
					<dd className="text-right">
						{images.count === 0 ? "None" : known > 0 ? formatKilobytes(images.bytes) : "Unknown"}
					</dd>
				</dl>
				<p className="mt-2 opacity-70">
					Gmail clips emails whose HTML is over {LIMITS.maxEmailBytes / 1000} KB. Images don&apos;t count toward
					it, but readers download them on every open.
					{images.unknown > 0 && ` ${images.unknown} image size${images.unknown > 1 ? "s" : ""} couldn't be read.`}
				</p>
			</TooltipContent>
		</Tooltip>
	);
}
