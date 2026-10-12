"use client";

import { useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { tagContacts } from "@/app/(app)/contacts/actions";
import PickerTags from "@/components/PickerTags";
import { useSelection } from "@/components/ProviderSelection";
import { Button } from "@/components/ui/button";

export default function BarBulkTags({ tags }) {
	const { selected, clear } = useSelection();
	const [names, setNames] = useState([]);
	const [isPending, startTransition] = useTransition();
	if (selected.length === 0) return null;

	function apply(remove) {
		startTransition(async () => {
			const result = await tagContacts({ ids: selected, names, remove });
			if (result?.error) return toast.error(result.error);
			toast.success(
				remove
					? `Removed ${names.length === 1 ? "1 tag" : `${names.length} tags`} from ${selected.length} contacts`
					: `Tagged ${selected.length} ${selected.length === 1 ? "contact" : "contacts"}`
			);
			setNames([]);
			clear();
		});
	}

	return (
		<div
			role="region"
			aria-label="Bulk actions"
			className="sticky bottom-4 z-20 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-xl bg-popover/95 px-3 py-2.5 shadow-lg ring-1 ring-border backdrop-blur animate-enter"
		>
			<span className="text-sm font-medium tabular-nums">{selected.length} selected</span>
			<PickerTags tags={tags} value={names} onChange={setNames} placeholder="Pick tags" className="min-w-0 flex-1" />
			<div className="flex items-center gap-1">
				<Button size="sm" onClick={() => apply(false)} disabled={isPending || names.length === 0}>
					{isPending ? <Loader2 className="animate-spin" /> : "Add"}
				</Button>
				<Button size="sm" variant="outline" onClick={() => apply(true)} disabled={isPending || names.length === 0}>
					Remove
				</Button>
				<Button size="icon-sm" variant="ghost" onClick={clear} aria-label="Clear selection">
					<X />
				</Button>
			</div>
		</div>
	);
}
