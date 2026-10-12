"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { signOutAllSessions, updateMyEmail, updateMyPassword } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";

// Both changes ask for the current password: an unlocked laptop shouldn't be enough to take the account.
export default function FormAccount({ email }) {
	return (
		<div className="flex flex-col gap-6">
			<FormEmail email={email} />
			<FormPassword />
			<SignOutEverywhere />
		</div>
	);
}

function FormEmail({ email }) {
	const [isPending, startTransition] = useTransition();
	const [error, setError] = useState(null);

	function onSubmit(event) {
		event.preventDefault();
		const formElement = event.currentTarget;
		const form = new FormData(formElement);
		startTransition(async () => {
			const result = await updateMyEmail({ email: form.get("email"), currentPassword: form.get("currentPassword") });
			if (result?.error) return setError(result.error);
			setError(null);
			formElement.querySelector("[name=currentPassword]").value = "";
			toast.success("Email changed. Login codes go there from now on.");
		});
	}

	return (
		<Card title="Your email" onSubmit={onSubmit} isPending={isPending} error={error} action="Change email">
			<Field label="Email">
				<Input name="email" type="email" defaultValue={email} autoComplete="email" required />
			</Field>
			<Field label="Current password">
				<Input name="currentPassword" type="password" autoComplete="current-password" required />
			</Field>
		</Card>
	);
}

function FormPassword() {
	const [isPending, startTransition] = useTransition();
	const [error, setError] = useState(null);

	function onSubmit(event) {
		event.preventDefault();
		const formElement = event.currentTarget;
		const form = new FormData(formElement);
		if (form.get("password") !== form.get("confirmPassword")) return setError("The new passwords don't match");
		startTransition(async () => {
			const result = await updateMyPassword({ password: form.get("password"), currentPassword: form.get("currentPassword") });
			if (result?.error) return setError(result.error);
			setError(null);
			formElement.reset();
			toast.success("Password changed. Your other sessions are signed out.");
		});
	}

	return (
		<Card title="Your password" onSubmit={onSubmit} isPending={isPending} error={error} action="Change password">
			<Field label="Current password">
				<Input name="currentPassword" type="password" autoComplete="current-password" required />
			</Field>
			<Field label="New password">
				<Input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
			</Field>
			<Field label="Repeat it">
				<Input name="confirmPassword" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
			</Field>
		</Card>
	);
}

function SignOutEverywhere() {
	const [isPending, startTransition] = useTransition();

	function signOut() {
		if (!window.confirm("Sign out of every browser, this one included?")) return;
		startTransition(() => signOutAllSessions());
	}

	return (
		<section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card px-4 py-3 shadow-border">
			<p className="text-sm text-pretty text-muted-foreground">Lost a device, or logged in somewhere you shouldn&apos;t have?</p>
			<Button variant="outline" onClick={signOut} disabled={isPending}>
				{isPending ? <Loader2 className="animate-spin" /> : "Sign out everywhere"}
			</Button>
		</section>
	);
}

function Card({ title, onSubmit, isPending, error, action, children }) {
	return (
		<form onSubmit={onSubmit} className="rounded-xl bg-card shadow-border">
			<h2 className="flex h-12 items-center px-4 text-sm font-medium">{title}</h2>
			<div className="divide-y divide-border/60 border-t border-border/60">{children}</div>
			<div className="flex items-center justify-end gap-3 border-t border-border/60 px-4 py-3">
				{error && <p className="mr-auto text-sm text-destructive">{error}</p>}
				<Button type="submit" disabled={isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : action}
				</Button>
			</div>
		</form>
	);
}

function Field({ label, children }) {
	return (
		<label className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-4">
			<span className="text-sm text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}
