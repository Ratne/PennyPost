"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removeTag } from "@/app/(app)/contacts/actions";
import DialogTag from "@/components/DialogTag";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function MenuTag({ tag }) {
	const [dialog, setDialog] = useState(null);
	const [isPending, startTransition] = useTransition();

	function remove() {
		startTransition(async () => {
			const result = await removeTag(tag.id);
			if (result?.error) return toast.error(result.error);
			toast.success(`Deleted “${tag.name}”`);
			setDialog(null);
		});
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${tag.name}`}>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => setDialog("edit")}>
						<Pencil />
						Edit
					</DropdownMenuItem>
					<DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
						<Trash2 />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<DialogTag tag={tag} open={dialog === "edit"} onOpenChange={(open) => setDialog(open ? "edit" : null)} />
			<Dialog open={dialog === "delete"} onOpenChange={(open) => setDialog(open ? "delete" : null)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Delete “{tag.name}”?</DialogTitle>
						<DialogDescription>
							It comes off {tag.contacts === 1 ? "1 contact" : `${tag.contacts ?? 0} contacts`}. Segments that use it stop
							filtering on it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">Cancel</Button>
						</DialogClose>
						<Button variant="destructive" onClick={remove} disabled={isPending}>
							Delete tag
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
