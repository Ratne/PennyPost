"use client";

import { useRef, useState, useTransition } from "react";
import { Clock, GitBranch, Loader2, LogOut, Mail, Plus, Webhook, X } from "lucide-react";
import { toast } from "sonner";
import { saveAutomationStep } from "@/app/(app)/automations/actions";
import BadgeTag from "@/components/BadgeTag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MAX_WAIT_AMOUNT, MAX_WEBHOOK_HEADERS, WAIT_UNITS, WEBHOOK_PLACEHOLDERS, getStepProblem } from "@/lib/automation-rules";
import { cn } from "@/lib/utils";

export const STEP_KINDS = {
	wait: { label: "Wait", description: "Hours, days, weeks, or until a date", icon: Clock, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
	email: { label: "Send email", description: "Write it, then come back here", icon: Mail, tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
	webhook: { label: "Webhook", description: "POST JSON to another service", icon: Webhook, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
	condition: { label: "If / else", description: "Split on a tag or a segment", icon: GitBranch, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
	exit_automation: {
		label: "Exit another automation",
		description: "Take the contact out of a different flow",
		icon: LogOut,
		tone: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
	},
};

const DESCRIPTIONS = {
	wait: "The contact pauses here, then carries on with the next step.",
	webhook: "Sends a POST request when a contact reaches this step. A failed call is logged and the flow goes on.",
	condition: "Contacts who match go down Yes, the others down No. Both branches meet again after it.",
	exit_automation: "If the contact is in the other automation, they leave it right away.",
};

// Edits the config of one step; email steps have their own page.
export default function SheetStep({ step, automationId, tags, segments, automations, onClose, onSaved }) {
	const [config, setConfig] = useState(step?.config ?? {});
	const [isSaving, startSaving] = useTransition();
	const isOpen = Boolean(step) && step.type !== "email";
	const kind = step ? STEP_KINDS[step.type] : null;
	const problem = step ? getStepProblem({ ...step, config }, { automationId }) : null;
	const set = (patch) => setConfig((current) => ({ ...current, ...patch }));

	function save(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await saveAutomationStep(step.id, config);
			if (result?.error) return toast.error(result.error);
			onSaved(result);
		});
	}

	return (
		<Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="w-full gap-0 sm:max-w-md">
				{isOpen && (
					<form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
						<SheetHeader className="border-b border-border/60">
							<SheetTitle className="flex items-center gap-2.5">
								<span className={cn("grid size-7 place-items-center rounded-md", kind.tone)}>
									<kind.icon className="size-3.5" />
								</span>
								{kind.label}
							</SheetTitle>
							<SheetDescription>{DESCRIPTIONS[step.type]}</SheetDescription>
						</SheetHeader>
						<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
							{step.type === "wait" && <PanelStepWait config={config} set={set} />}
							{step.type === "webhook" && <PanelStepWebhook config={config} set={set} />}
							{step.type === "condition" && <PanelStepCondition config={config} set={set} tags={tags} segments={segments} />}
							{step.type === "exit_automation" && <PanelStepExit config={config} set={set} automations={automations} />}
						</div>
						<SheetFooter className="border-t border-border/60">
							{problem && <p className="text-sm text-amber-700 dark:text-amber-400">{problem}</p>}
							<Button type="submit" disabled={isSaving}>
								{isSaving ? <Loader2 className="animate-spin" /> : "Save step"}
							</Button>
						</SheetFooter>
					</form>
				)}
			</SheetContent>
		</Sheet>
	);
}

function Field({ label, htmlFor, hint, children }) {
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<Label htmlFor={htmlFor} className="text-muted-foreground">
				{label}
			</Label>
			{children}
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}

// datetime-local works in the browser's time zone; the config keeps an ISO instant.
function toLocalInput(iso) {
	if (!iso) return "";
	const date = new Date(iso);
	if (!Number.isFinite(date.getTime())) return "";
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
	return local.toISOString().slice(0, 16);
}

function PanelStepWait({ config, set }) {
	const mode = config.mode === "until" ? "until" : "delay";
	return (
		<>
			<ToggleGroup
				type="single"
				variant="outline"
				value={mode}
				onValueChange={(value) => value && set(value === "until" ? { mode: "until", at: config.at ?? null } : { mode: "delay", amount: config.amount ?? 1, unit: config.unit ?? "days" })}
				className="w-full"
			>
				<ToggleGroupItem value="delay" className="flex-1">
					For a while
				</ToggleGroupItem>
				<ToggleGroupItem value="until" className="flex-1">
					Until a date
				</ToggleGroupItem>
			</ToggleGroup>
			{mode === "delay" ? (
				<Field label="Wait for" htmlFor="wait-amount">
					<div className="flex gap-2">
						<Input
							id="wait-amount"
							type="number"
							inputMode="numeric"
							min={1}
							max={MAX_WAIT_AMOUNT}
							value={config.amount ?? ""}
							onChange={(event) => set({ amount: event.target.value ? Number(event.target.value) : "" })}
							className="w-24 tabular-nums"
							required
						/>
						<Select value={config.unit ?? "days"} onValueChange={(unit) => set({ unit })}>
							<SelectTrigger className="flex-1" aria-label="Unit">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.keys(WAIT_UNITS).map((unit) => (
									<SelectItem key={unit} value={unit} className="capitalize">
										{unit}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</Field>
			) : (
				<Field label="Wait until" htmlFor="wait-at" hint="In your time zone. Contacts reaching this step after the date carry on right away.">
					<Input
						id="wait-at"
						type="datetime-local"
						value={toLocalInput(config.at)}
						onChange={(event) => set({ at: event.target.value ? new Date(event.target.value).toISOString() : null })}
						required
					/>
				</Field>
			)}
		</>
	);
}

function PanelStepWebhook({ config, set }) {
	const bodyRef = useRef(null);
	const headers = config.headers ?? [];
	const setHeader = (index, patch) => set({ headers: headers.map((header, at) => (at === index ? { ...header, ...patch } : header)) });

	function insertPlaceholder(name) {
		const token = `{{${name}}}`;
		const body = config.body ?? "";
		const element = bodyRef.current;
		const start = element?.selectionStart ?? body.length;
		const end = element?.selectionEnd ?? body.length;
		set({ body: body.slice(0, start) + token + body.slice(end) });
		requestAnimationFrame(() => {
			element?.focus();
			element?.setSelectionRange(start + token.length, start + token.length);
		});
	}

	return (
		<>
			<Field label="URL" htmlFor="webhook-url">
				<div className="flex items-center gap-2">
					<span className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">POST</span>
					<Input
						id="webhook-url"
						type="url"
						value={config.url ?? ""}
						onChange={(event) => set({ url: event.target.value })}
						placeholder="https://example.com/hooks/newsletter"
						required
					/>
				</div>
			</Field>
			<Field label="Headers" hint="Placeholders work in values too, e.g. Bearer {{contactId}}.">
				<div className="flex flex-col gap-2">
					{headers.map((header, index) => (
						<div key={index} className="flex items-center gap-2">
							<Input
								value={header.name}
								onChange={(event) => setHeader(index, { name: event.target.value })}
								placeholder="Authorization"
								aria-label={`Header ${index + 1} name`}
								className="font-mono text-xs"
							/>
							<Input
								value={header.value}
								onChange={(event) => setHeader(index, { value: event.target.value })}
								placeholder="Bearer …"
								aria-label={`Header ${index + 1} value`}
								className="font-mono text-xs"
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove header ${index + 1}`}
								onClick={() => set({ headers: headers.filter((_, at) => at !== index) })}
							>
								<X />
							</Button>
						</div>
					))}
					{headers.length < MAX_WEBHOOK_HEADERS && (
						<Button type="button" variant="outline" size="sm" className="self-start" onClick={() => set({ headers: [...headers, { name: "", value: "" }] })}>
							<Plus data-icon="inline-start" />
							Add header
						</Button>
					)}
				</div>
			</Field>
			<Field label="JSON body" htmlFor="webhook-body" hint="Put placeholders inside quotes: values are escaped for JSON.">
				<Textarea
					id="webhook-body"
					ref={bodyRef}
					value={config.body ?? ""}
					onChange={(event) => set({ body: event.target.value })}
					spellCheck={false}
					rows={10}
					className="font-mono text-xs leading-5"
					placeholder={'{\n  "email": "{{email}}"\n}'}
				/>
				<div className="flex flex-wrap gap-1.5">
					{WEBHOOK_PLACEHOLDERS.map((name) => (
						<button
							key={name}
							type="button"
							onClick={() => insertPlaceholder(name)}
							className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors duration-150 hover:bg-muted/70 hover:text-foreground"
						>
							{`{{${name}}}`}
						</button>
					))}
				</div>
			</Field>
		</>
	);
}

function PanelStepCondition({ config, set, tags, segments }) {
	const kind = config.kind === "in_segment" ? "in_segment" : "has_tag";
	return (
		<>
			<ToggleGroup
				type="single"
				variant="outline"
				value={kind}
				onValueChange={(value) => value && set(value === "in_segment" ? { kind: value, segmentId: null, tagId: undefined } : { kind: value, tagId: null, segmentId: undefined })}
				className="w-full"
			>
				<ToggleGroupItem value="has_tag" className="flex-1">
					Has a tag
				</ToggleGroupItem>
				<ToggleGroupItem value="in_segment" className="flex-1">
					Is in a segment
				</ToggleGroupItem>
			</ToggleGroup>
			{kind === "has_tag" ? (
				<Field label="The contact has the tag">
					<Select value={config.tagId ?? ""} onValueChange={(tagId) => set({ tagId })}>
						<SelectTrigger className="w-full" aria-label="Tag">
							<SelectValue placeholder={tags.length ? "Pick a tag" : "No tags yet"} />
						</SelectTrigger>
						<SelectContent>
							{tags.map((tag) => (
								<SelectItem key={tag.id} value={tag.id}>
									<BadgeTag tag={tag} />
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
			) : (
				<Field label="The contact is in the segment" hint="Checked when the contact reaches this step.">
					<Select value={config.segmentId ?? ""} onValueChange={(segmentId) => set({ segmentId })}>
						<SelectTrigger className="w-full" aria-label="Segment">
							<SelectValue placeholder={segments.length ? "Pick a segment" : "This newsletter has no segments"} />
						</SelectTrigger>
						<SelectContent>
							{segments.map((segment) => (
								<SelectItem key={segment.id} value={segment.id}>
									{segment.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
			)}
		</>
	);
}

function PanelStepExit({ config, set, automations }) {
	return (
		<Field label="Automation to leave">
			<Select value={config.automationId ?? ""} onValueChange={(automationId) => set({ automationId })}>
				<SelectTrigger className="w-full" aria-label="Automation">
					<SelectValue placeholder={automations.length ? "Pick an automation" : "There are no other automations"} />
				</SelectTrigger>
				<SelectContent>
					{automations.map((automation) => (
						<SelectItem key={automation.id} value={automation.id}>
							{automation.name}
							{automation.status !== "active" && <span className="text-xs text-muted-foreground capitalize">{automation.status}</span>}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Field>
	);
}
