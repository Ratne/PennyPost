"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { removeSegment } from "@/app/(app)/segments/actions";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function MenuSegment({ segment }) {
	const [isConfirming, setIsConfirming] = useState(false);
	const [isPending, startTransition] = useTransition();

	function remove() {
		startTransition(async () => {
			const result = await removeSegment(segment.id);
			if (result?.error) return toast.error(result.error);
			toast.success(`Deleted “${segment.name}”`);
			setIsConfirming(false);
		});
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${segment.name}`}>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem asChild>
						<Link href={`/segments/${segment.id}`}>
							<Pencil />
							Edit
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link href={`/contacts?segment=${segment.id}`}>
							<Users />
							View contacts
						</Link>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onSelect={() => setIsConfirming(true)}>
						<Trash2 />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={isConfirming} onOpenChange={setIsConfirming}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Delete “{segment.name}”?</DialogTitle>
						<DialogDescription>Drafts that target it go back to every active contact. Contacts aren’t touched.</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">Cancel</Button>
						</DialogClose>
						<Button variant="destructive" onClick={remove} disabled={isPending}>
							Delete segment
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
