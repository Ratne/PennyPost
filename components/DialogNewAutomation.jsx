"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { newAutomation } from "@/app/(app)/automations/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_NAME_LENGTH } from "@/lib/automation-rules";

export default function DialogNewAutomation({ newsletters }) {
	const [isOpen, setIsOpen] = useState(false);

	if (newsletters.length === 0) {
		return (
			<Button asChild>
				<Link href="/newsletters/new">
					<Plus data-icon="inline-start" />
					New automation
				</Link>
			</Button>
		);
	}

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button>
					<Plus data-icon="inline-start" />
					New automation
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">{isOpen && <FormNewAutomation newsletters={newsletters} />}</DialogContent>
		</Dialog>
	);
}

function FormNewAutomation({ newsletters }) {
	const [name, setName] = useState("");
	const [newsletterId, setNewsletterId] = useState(newsletters[0]?.id ?? "");
	const [error, setError] = useState(null);
	const [isPending, startTransition] = useTransition();

	function submit(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await newAutomation({ newsletterId, name });
			if (result?.error) setError(result.error);
		});
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-5">
			<DialogHeader>
				<DialogTitle>New automation</DialogTitle>
				<DialogDescription>It sends from the newsletter you pick, to that newsletter’s contacts.</DialogDescription>
			</DialogHeader>
			<div className="flex flex-col gap-2">
				<Label htmlFor="automation-name">Name</Label>
				<Input
					id="automation-name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="e.g. Onboarding for customers"
					maxLength={MAX_NAME_LENGTH}
					required
					autoFocus
				/>
			</div>
			{newsletters.length > 1 && (
				<div className="flex flex-col gap-2">
					<Label>Newsletter</Label>
					<Select value={newsletterId} onValueChange={setNewsletterId}>
						<SelectTrigger className="w-full" aria-label="Newsletter">
							<SelectValue placeholder="Pick a newsletter" />
						</SelectTrigger>
						<SelectContent>
							{newsletters.map((newsletter) => (
								<SelectItem key={newsletter.id} value={newsletter.id}>
									<AvatarNewsletter newsletter={newsletter} size={18} />
									{newsletter.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}
			{error && <p className="text-sm text-destructive">{error}</p>}
			<DialogFooter>
				<Button type="submit" disabled={isPending || !name.trim() || !newsletterId} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Create"}
				</Button>
			</DialogFooter>
		</form>
	);
}
