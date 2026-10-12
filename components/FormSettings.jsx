"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { removeEmailableKey, saveEmailableKey, saveOperationalSettings } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_SEND_RATE_PER_SECOND } from "@/lib/config";

const FROM_ENV = "env";
const HINTS = {
	SENDING_ENABLED: "Off sends nothing: campaigns, welcome emails, alerts and login codes (those go to the Worker logs).",
	SES_REGION: "Where your SES account and verified domains are.",
	SES_CONFIGURATION_SET: "Sends events to the SNS topic that feeds bounces, complaints and deliveries back.",
	SEND_RATE_PER_SECOND: `Emails per second, 1 to ${MAX_SEND_RATE_PER_SECOND}. Keep it under your SES quota.`,
	ALERT_FROM: "Sender of alerts and login codes, on a verified domain. Alerts go to every admin.",
};

// An empty field uses the environment variable of the same name, shown as the placeholder.
export default function FormSettings({ fields, emailable }) {
	const [values, setValues] = useState(() => Object.fromEntries(fields.map(({ name, saved }) => [name, saved])));
	const [isPending, startTransition] = useTransition();

	function onSubmit(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await saveOperationalSettings(values);
			if (result?.error) return toast.error(result.error);
			toast.success("Settings saved");
		});
	}

	return (
		<div className="flex flex-col gap-6">
			<form onSubmit={onSubmit} className="rounded-xl bg-card shadow-border animate-enter">
				<h2 className="flex h-12 items-center px-4 text-sm font-medium">Sending</h2>
				<div className="divide-y divide-border/60 border-t border-border/60">
					{fields.map((field) => (
						<Field key={field.name} label={field.label} hint={HINTS[field.name]} env={field.env} name={field.name}>
							{field.kind === "boolean" ? (
								<Select
									value={values[field.name] || FROM_ENV}
									onValueChange={(value) => setValues((current) => ({ ...current, [field.name]: value === FROM_ENV ? "" : value }))}
								>
									<SelectTrigger className="w-full" aria-label={field.label}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={FROM_ENV}>Environment ({field.env === "true" ? "on" : "off"})</SelectItem>
										<SelectItem value="true">On</SelectItem>
										<SelectItem value="false">Off</SelectItem>
									</SelectContent>
								</Select>
							) : (
								<Input
									value={values[field.name]}
									type={field.kind === "number" ? "number" : "text"}
									inputMode={field.kind === "number" ? "numeric" : undefined}
									min={field.kind === "number" ? 1 : undefined}
									max={field.kind === "number" ? MAX_SEND_RATE_PER_SECOND : undefined}
									placeholder={field.env || field.placeholder}
									className="font-mono"
									onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
								/>
							)}
						</Field>
					))}
				</div>
				<div className="flex justify-end border-t border-border/60 px-4 py-3">
					<Button type="submit" disabled={isPending} className="min-w-20">
						{isPending ? <Loader2 className="animate-spin" /> : "Save"}
					</Button>
				</div>
			</form>

			<FormEmailable emailable={emailable} />
		</div>
	);
}

function FormEmailable({ emailable }) {
	const [key, setKey] = useState("");
	const [isPending, startTransition] = useTransition();

	function save(event) {
		event.preventDefault();
		startTransition(async () => {
			const result = await saveEmailableKey(key);
			if (result?.error) return toast.error(result.error);
			setKey("");
			toast.success("Emailable key saved");
		});
	}

	function remove() {
		if (!window.confirm("Remove the Emailable key? Signups stop being checked.")) return;
		startTransition(async () => {
			const result = await removeEmailableKey();
			if (result?.error) return toast.error(result.error);
			toast.success("Emailable key removed");
		});
	}

	return (
		<form onSubmit={save} style={{ "--stagger": 1 }} className="rounded-xl bg-card shadow-border animate-enter">
			<div className="flex h-12 items-center justify-between gap-3 px-4">
				<h2 className="text-sm font-medium">Address checks</h2>
				<a href="https://emailable.com/docs/api/" target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline">
					Emailable docs
				</a>
			</div>
			<p className="border-t border-border/60 px-4 py-3 text-sm text-pretty text-muted-foreground">
				With an Emailable key, signups from the website form and the API are checked first. Addresses that can&apos;t
				receive email, and disposable ones, are refused with a message; risky and unknown ones go through. If Emailable
				doesn&apos;t answer, signups go through and you get an alert. Imports aren&apos;t checked.
			</p>
			<Field
				label="Private key"
				hint={
					emailable.isSet
						? `Saved: ${emailable.masked}${emailable.source === "environment" ? " (from EMAILABLE_API_KEY)" : ""}. Encrypted in the database; only the last 4 characters are ever shown.`
						: "Encrypted in the database; only the last 4 characters are ever shown."
				}
			>
				<Input
					value={key}
					type="password"
					autoComplete="off"
					placeholder={emailable.isSet ? "Enter a new key to replace it" : "live_..."}
					className="font-mono"
					onChange={(event) => setKey(event.target.value)}
				/>
			</Field>
			<div className="flex justify-end gap-2 border-t border-border/60 px-4 py-3">
				{emailable.isSet && emailable.source === "dashboard" && (
					<Button type="button" variant="ghost" onClick={remove} disabled={isPending}>
						Remove
					</Button>
				)}
				<Button type="submit" disabled={isPending || !key.trim()} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Save key"}
				</Button>
			</div>
		</form>
	);
}

function Field({ label, hint, env, name, children }) {
	return (
		<label className="grid gap-2 border-t border-border/60 px-4 py-3 first:border-t-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
			<span className="text-sm text-muted-foreground sm:pt-2">{label}</span>
			<span className="flex flex-col gap-1.5">
				{children}
				{hint && <span className="text-xs text-pretty text-muted-foreground">{hint}</span>}
				{name && (
					<span className="font-mono text-[11px] text-muted-foreground/70">
						{name}
						{env ? ` = ${env} in the environment` : " not set in the environment"}
					</span>
				)}
			</span>
		</label>
	);
}
