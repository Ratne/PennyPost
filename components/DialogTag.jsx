"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveTag } from "@/app/(app)/contacts/actions";
import { TAG_TONES } from "@/components/BadgeTag";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MAX_TAG_LENGTH, TAG_COLORS } from "@/lib/tag-names";
import { cn } from "@/lib/utils";

// Creates a tag, or edits one when `tag` is given. Controlled from outside with `open`, or from its trigger.
export default function DialogTag({ tag, trigger, open, onOpenChange }) {
	const [isOwnOpen, setIsOwnOpen] = useState(false);
	const isOpen = open ?? isOwnOpen;
	const setOpen = onOpenChange ?? setIsOwnOpen;

	return (
		<Dialog open={isOpen} onOpenChange={setOpen}>
			{trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
			<DialogContent className="sm:max-w-md">
				{isOpen && <FormTag tag={tag} onDone={() => setOpen(false)} />}
			</DialogContent>
		</Dialog>
	);
}

function FormTag({ tag, onDone }) {
	const [name, setName] = useState(tag?.name ?? "");
	const [color, setColor] = useState(tag?.color ?? "gray");
	const [error, setError] = useState(null);
	const [isPending, startTransition] = useTransition();

	function submit(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await saveTag({ id: tag?.id, name, color });
			if (result?.error) return setError(result.error);
			toast.success(tag ? "Tag saved" : "Tag created");
			onDone();
		});
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle>{tag ? "Edit tag" : "New tag"}</DialogTitle>
				<DialogDescription>Tags are shared by every newsletter. Names are lowercase.</DialogDescription>
			</DialogHeader>
			<div className="flex flex-col gap-2">
				<Label htmlFor="tag-name">Name</Label>
				<Input
					id="tag-name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="e.g. customers"
					maxLength={MAX_TAG_LENGTH}
					required
					autoFocus
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label id="tag-color">Color</Label>
				<ToggleGroup
					type="single"
					value={color}
					onValueChange={(next) => next && setColor(next)}
					aria-labelledby="tag-color"
					className="flex-wrap gap-1"
					spacing={1}
				>
					{TAG_COLORS.map((key) => (
						<ToggleGroupItem key={key} value={key} aria-label={key} title={key} className="size-8 min-w-8 rounded-full p-0">
							<span className={cn("size-3 rounded-full", TAG_TONES[key])} />
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</div>
			{error && <p className="text-sm text-destructive">{error}</p>}
			<DialogFooter>
				<Button type="submit" disabled={isPending || !name.trim()} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : tag ? "Save" : "Create"}
				</Button>
			</DialogFooter>
		</form>
	);
}
