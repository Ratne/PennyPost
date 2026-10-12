"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removePerson } from "@/app/(app)/people/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// Typing the address keeps an erasure, which can't be undone, from being a single misclick.
export default function DialogDeletePerson({ id, email, subscriptions }) {
	const router = useRouter();
	const [isOpen, setIsOpen] = useState(false);
	const [typed, setTyped] = useState("");
	const [isDeleting, startDeleting] = useTransition();

	function remove() {
		startDeleting(async () => {
			const result = await removePerson(id);
			if (result?.error) return void toast.error(result.error);
			setIsOpen(false);
			toast.success(`${email} deleted`);
			router.replace("/contacts");
		});
	}

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				if (!open) setTyped("");
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline">
					<Trash2 />
					Delete
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Delete this contact everywhere?</DialogTitle>
					<DialogDescription>
						Removes <span className="font-medium text-foreground">{email}</span> from{" "}
						{subscriptions === 1 ? "its newsletter" : `all ${subscriptions} newsletters`}, with the profile and the whole
						history. Campaign stats stay. If the address bounced or complained, it stays blocked from future sends.
					</DialogDescription>
				</DialogHeader>
				<Input
					value={typed}
					onChange={(event) => setTyped(event.target.value)}
					placeholder={email}
					aria-label="Type the email address to confirm"
					autoComplete="off"
				/>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancel</Button>
					</DialogClose>
					<Button
						variant="destructive"
						onClick={remove}
						disabled={isDeleting || typed.trim().toLowerCase() !== email}
						className="min-w-20"
					>
						{isDeleting ? <Loader2 className="animate-spin" /> : "Delete"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
