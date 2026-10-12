"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { savePerson } from "@/app/(app)/people/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_NAME_LENGTH, MAX_PHONE_LENGTH } from "@/lib/person-fields";

export default function FormPerson({ person }) {
	const [isPending, startTransition] = useTransition();
	const [values, setValues] = useState({
		firstName: person.firstName ?? "",
		lastName: person.lastName ?? "",
		phone: person.phone ?? "",
	});
	const isChanged =
		values.firstName !== (person.firstName ?? "") || values.lastName !== (person.lastName ?? "") || values.phone !== (person.phone ?? "");

	function update(key) {
		return (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
	}

	function onSubmit(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await savePerson(person._id, values);
			if (result?.error) return toast.error(result.error);
			toast.success("Contact saved");
		});
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col">
			<div className="divide-y divide-border/60">
				<Field label="Email">
					<span className="truncate py-2 text-sm font-medium">{person.email}</span>
				</Field>
				<Field label="First name">
					<Input value={values.firstName} maxLength={MAX_NAME_LENGTH} autoComplete="off" onChange={update("firstName")} />
				</Field>
				<Field label="Last name">
					<Input value={values.lastName} maxLength={MAX_NAME_LENGTH} autoComplete="off" onChange={update("lastName")} />
				</Field>
				<Field label="Phone">
					<Input
						value={values.phone}
						type="tel"
						inputMode="tel"
						maxLength={MAX_PHONE_LENGTH}
						placeholder="+39 333 123 4567"
						autoComplete="off"
						onChange={update("phone")}
					/>
				</Field>
			</div>
			<div className="flex justify-end border-t border-border/60 px-4 py-3">
				<Button type="submit" disabled={isPending || !isChanged} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Save"}
				</Button>
			</div>
		</form>
	);
}

function Field({ label, children }) {
	return (
		<label className="grid gap-2 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center sm:gap-4">
			<span className="text-sm text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}
