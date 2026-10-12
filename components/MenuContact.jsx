"use client";

import { useState, useTransition } from "react";
import { Loader2, MoreHorizontal, Tags, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { saveContactTags, setContactStatus } from "@/app/(app)/contacts/actions";
import PickerTags from "@/components/PickerTags";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MenuContact({ id, email, status, tags = [], allTags = [] }) {
	const [isPending, startTransition] = useTransition();
	const [isEditing, setIsEditing] = useState(false);
	const canChangeStatus = ["active", "dormant"].includes(status);

	function update(nextStatus) {
		startTransition(async () => {
			const result = await setContactStatus(id, nextStatus);
			if (result?.error) toast.error(result.error);
		});
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label="Actions" disabled={isPending}>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onSelect={() => setIsEditing(true)}>
						<Tags />
						Edit tags
					</DropdownMenuItem>
					{canChangeStatus && <DropdownMenuSeparator />}
					{status === "dormant" && (
						<DropdownMenuItem onSelect={() => update("active")}>
							<UserCheck />
							Reactivate
						</DropdownMenuItem>
					)}
					{canChangeStatus && (
						<DropdownMenuItem variant="destructive" onSelect={() => update("unsubscribed")}>
							<UserX />
							Unsubscribe
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={isEditing} onOpenChange={setIsEditing}>
				<DialogContent className="sm:max-w-md">
					{isEditing && (
						<FormContactTags id={id} email={email} tags={tags} allTags={allTags} onDone={() => setIsEditing(false)} />
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}

function FormContactTags({ id, email, tags, allTags, onDone }) {
	const [names, setNames] = useState(() => tags.map(({ name }) => name));
	const [isPending, startTransition] = useTransition();

	function save() {
		startTransition(async () => {
			const result = await saveContactTags(id, names);
			if (result?.error) return toast.error(result.error);
			toast.success("Tags saved");
			onDone();
		});
	}

	return (
		<>
			<DialogHeader>
				<DialogTitle>Tags</DialogTitle>
				<DialogDescription className="truncate">{email}</DialogDescription>
			</DialogHeader>
			<PickerTags tags={allTags} value={names} onChange={setNames} />
			<DialogFooter>
				<Button onClick={save} disabled={isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Save"}
				</Button>
			</DialogFooter>
		</>
	);
}
