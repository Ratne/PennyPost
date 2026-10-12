"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { changeAutomationStatus, removeAutomation } from "@/app/(app)/automations/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// The row menu on /automations; the builder reuses the delete dialog with `redirectTo`.
export default function MenuAutomation({ automation, trigger, redirectTo }) {
	const router = useRouter();
	const [isConfirming, setIsConfirming] = useState(false);
	const [isPending, startTransition] = useTransition();
	const isActive = automation.status === "active";

	function toggle() {
		startTransition(async () => {
			const result = await changeAutomationStatus(automation.id, isActive ? "paused" : "active");
			if (result?.error) return toast.error(result.error);
			toast.success(isActive ? `Paused “${automation.name}”` : `“${automation.name}” is live`);
			router.refresh();
		});
	}

	function remove() {
		startTransition(async () => {
			const result = await removeAutomation(automation.id);
			if (result?.error) return toast.error(result.error);
			toast.success(`Deleted “${automation.name}”`);
			setIsConfirming(false);
			if (redirectTo) router.push(redirectTo);
		});
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					{trigger ?? (
						<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${automation.name}`} disabled={isPending}>
							<MoreHorizontal />
						</Button>
					)}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{!redirectTo && (
						<>
							<DropdownMenuItem asChild>
								<Link href={`/automations/${automation.id}`}>
									<Pencil />
									Edit
								</Link>
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={toggle}>
								{isActive ? <Pause /> : <Play />}
								{isActive ? "Pause" : "Activate"}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					)}
					<DropdownMenuItem variant="destructive" onSelect={() => setIsConfirming(true)}>
						<Trash2 />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={isConfirming} onOpenChange={setIsConfirming}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Delete “{automation.name}”?</DialogTitle>
						<DialogDescription>Contacts in it stop where they are. Emails already sent stay in their history.</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">Cancel</Button>
						</DialogClose>
						<Button variant="destructive" onClick={remove} disabled={isPending}>
							Delete automation
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
