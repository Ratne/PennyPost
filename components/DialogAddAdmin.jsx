"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addAdmin } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";

export default function DialogAddAdmin() {
	const [isOpen, setIsOpen] = useState(false);
	const [error, setError] = useState(null);
	const [isPending, startTransition] = useTransition();

	function onSubmit(event) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		startTransition(async () => {
			const result = await addAdmin({ email: form.get("email"), password: form.get("password") });
			if (result?.error) return setError(result.error);
			setIsOpen(false);
			toast.success("Admin added. Share the password with them privately.");
		});
	}

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				setError(null);
			}}
		>
			<DialogTrigger asChild>
				<Button>
					<Plus data-icon="inline-start" />
					Add admin
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>Add an admin</DialogTitle>
						<DialogDescription>
							Full access to every newsletter, contact and setting. They log in with this password and a code sent to their
							email, and can change both.
						</DialogDescription>
					</DialogHeader>
					<Input name="email" type="email" placeholder="Email" autoComplete="off" required autoFocus />
					<Input
						name="password"
						type="password"
						placeholder={`Password, ${MIN_PASSWORD_LENGTH}+ characters`}
						autoComplete="new-password"
						minLength={MIN_PASSWORD_LENGTH}
						required
					/>
					{error && <p className="text-sm text-destructive">{error}</p>}
					<DialogFooter>
						<Button type="submit" disabled={isPending} className="min-w-20">
							{isPending ? <Loader2 className="animate-spin" /> : "Add"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
