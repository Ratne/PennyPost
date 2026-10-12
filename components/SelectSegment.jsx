"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setCampaignSegment } from "@/app/(app)/campaigns/actions";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";

const EVERYONE = "everyone";

// The campaign's audience: every active contact, or one segment. Saved on change, like the rest of the draft.
export default function SelectSegment({ campaignId, newsletterId, segments, segmentId, everyoneCount, onChange, disabled }) {
	const [isSaving, startSaving] = useTransition();

	function change(value) {
		const next = value === EVERYONE ? null : value;
		startSaving(async () => {
			const result = await setCampaignSegment(campaignId, next);
			if (result?.error) return toast.error(result.error);
			onChange({ segmentId: next, audienceCount: result.audienceCount });
		});
	}

	return (
		<span className="flex items-center gap-2">
			<Select value={segmentId ?? EVERYONE} onValueChange={change} disabled={disabled || isSaving}>
				<SelectTrigger size="sm" className="h-7 max-w-64 gap-1.5 border-0 bg-muted/60 px-2 text-xs shadow-none" aria-label="Audience">
					<SelectValue />
				</SelectTrigger>
				<SelectContent align="start">
					<SelectItem value={EVERYONE}>
						Everyone
						<span className="text-muted-foreground tabular-nums">{formatNumber(everyoneCount)}</span>
					</SelectItem>
					{segments.length > 0 && <SelectSeparator />}
					{segments.map((segment) => (
						<SelectItem key={segment.id} value={segment.id} title={segment.summary}>
							{segment.name}
							<span className="text-muted-foreground tabular-nums">{formatNumber(segment.reachable)}</span>
						</SelectItem>
					))}
					<SelectSeparator />
					<Link
						href={`/segments/new?newsletter=${newsletterId}`}
						className="block rounded-sm px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
					>
						New segment…
					</Link>
				</SelectContent>
			</Select>
			{isSaving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
		</span>
	);
}
