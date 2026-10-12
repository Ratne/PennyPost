"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarIcon, Loader2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { previewSegment, saveSegment } from "@/app/(app)/segments/actions";
import PickerTags from "@/components/PickerTags";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatNumber } from "@/lib/format";
import { SEGMENT_STATUSES, normalizeSegmentRules } from "@/lib/segments";

const PREVIEW_DELAY_MS = 350;

export default function EditorSegment({ segment, newsletters, defaultNewsletterId, tags }) {
	const router = useRouter();
	const [name, setName] = useState(segment?.name ?? "");
	const [newsletterId, setNewsletterId] = useState(segment?.newsletterId ?? defaultNewsletterId ?? newsletters[0]?.id ?? "");
	const [rules, setRules] = useState(() => segment?.rules ?? {});
	const [count, setCount] = useState(null);
	const [isCounting, setIsCounting] = useState(false);
	const [isSaving, startSaving] = useTransition();

	const nameById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags]);
	const idByName = useMemo(() => new Map(tags.map((tag) => [tag.name, tag.id])), [tags]);
	const normalized = useMemo(() => normalizeSegmentRules(rules), [rules]);
	const rulesKey = JSON.stringify(normalized);

	useEffect(() => {
		if (!newsletterId) return;
		let isCurrent = true;
		setIsCounting(true);
		const timer = setTimeout(async () => {
			const result = await previewSegment({ newsletterId, rules: JSON.parse(rulesKey) });
			if (!isCurrent) return;
			setIsCounting(false);
			setCount(result?.error ? null : result);
		}, PREVIEW_DELAY_MS);
		return () => {
			isCurrent = false;
			clearTimeout(timer);
		};
	}, [newsletterId, rulesKey]);

	const set = (key, value) => setRules((current) => ({ ...current, [key]: value }));
	const tagNames = (key) => (rules[key] ?? []).map((id) => nameById.get(id)).filter(Boolean);
	const setTagNames = (key, names) => set(key, names.map((tagName) => idByName.get(tagName)).filter(Boolean));

	function save(event) {
		event.preventDefault();
		startSaving(async () => {
			const result = await saveSegment({ id: segment?._id, newsletterId, name, rules: normalized });
			if (result?.error) return toast.error(result.error);
			toast.success(segment ? "Segment saved" : "Segment created");
			router.push("/segments");
		});
	}

	return (
		<form onSubmit={save} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
			<div className="flex flex-col gap-8">
				<Section title="Segment">
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Name" htmlFor="segment-name">
							<Input
								id="segment-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder="e.g. Engaged customers"
								maxLength={60}
								required
							/>
						</Field>
						<Field label="Newsletter">
							<Select value={newsletterId} onValueChange={setNewsletterId} disabled={Boolean(segment)}>
								<SelectTrigger className="w-full" aria-label="Newsletter">
									<SelectValue placeholder="Pick a newsletter" />
								</SelectTrigger>
								<SelectContent>
									{newsletters.map((newsletter) => (
										<SelectItem key={newsletter.id} value={newsletter.id}>
											{newsletter.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>
					</div>
				</Section>

				<Section title="Tags" description="Contacts with any, all, or none of these tags.">
					<div className="flex flex-col gap-4">
						{[
							["tagsAny", "Has any of"],
							["tagsAll", "Has all of"],
							["tagsNone", "Has none of"],
						].map(([key, label]) => (
							<Field key={key} label={label}>
								<PickerTags
									tags={tags}
									value={tagNames(key)}
									onChange={(names) => setTagNames(key, names)}
									allowCreate={false}
									placeholder="Pick tags"
								/>
							</Field>
						))}
					</div>
				</Section>

				<Section title="Status" description="Filters the contacts list. A send only ever reaches active contacts.">
					<ToggleGroup
						type="multiple"
						variant="outline"
						value={rules.statuses ?? []}
						onValueChange={(values) => set("statuses", values)}
						className="flex-wrap"
						spacing={1}
					>
						{SEGMENT_STATUSES.map((status) => (
							<ToggleGroupItem key={status} value={status} className="h-8 px-3 capitalize">
								{status}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</Section>

				<Section title="Engagement">
					<div className="grid gap-4 sm:grid-cols-3">
						<FieldDays label="Opened in the last" value={rules.openedWithinDays} onChange={(value) => set("openedWithinDays", value)} />
						<FieldDays label="Clicked in the last" value={rules.clickedWithinDays} onChange={(value) => set("clickedWithinDays", value)} />
						<FieldDays label="No open for" value={rules.notOpenedForDays} onChange={(value) => set("notOpenedForDays", value)} />
					</div>
				</Section>

				<Section title="Signup">
					<div className="grid gap-4 sm:grid-cols-3">
						<FieldDate label="Joined after" value={rules.subscribedAfter} onChange={(value) => set("subscribedAfter", value)} />
						<FieldDate label="Joined before" value={rules.subscribedBefore} onChange={(value) => set("subscribedBefore", value)} />
						<Field label="Source" htmlFor="segment-source">
							<Input
								id="segment-source"
								value={rules.source ?? ""}
								onChange={(event) => set("source", event.target.value)}
								placeholder="e.g. api, import, website"
								maxLength={100}
							/>
						</Field>
					</div>
				</Section>
			</div>

			<aside className="lg:sticky lg:top-0 lg:self-start">
				<div className="flex flex-col gap-4 rounded-xl bg-card p-5 shadow-border">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Users className="size-4" />
						Audience
						{isCounting && <Loader2 className="ml-auto size-3.5 animate-spin" />}
					</div>
					<div>
						<p className="text-3xl font-semibold tracking-tight tabular-nums">{count ? formatNumber(count.reachable) : "–"}</p>
						<p className="text-sm text-muted-foreground">reachable by a send</p>
					</div>
					<p className="text-sm text-muted-foreground tabular-nums">
						{count
							? `${formatNumber(count.matching)} ${count.matching === 1 ? "contact matches" : "contacts match"} in any status`
							: "Pick a newsletter to count"}
					</p>
					<div className="flex flex-col gap-2 pt-1">
						<Button type="submit" disabled={isSaving || !name.trim() || !newsletterId}>
							{isSaving ? <Loader2 className="animate-spin" /> : segment ? "Save segment" : "Create segment"}
						</Button>
						{segment && (
							<Button asChild variant="outline">
								<Link href={`/contacts?segment=${segment._id}`}>View contacts</Link>
							</Button>
						)}
					</div>
				</div>
			</aside>
		</form>
	);
}

function Section({ title, description, children }) {
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-sm font-medium">{title}</h2>
				{description && <p className="text-sm text-muted-foreground">{description}</p>}
			</div>
			{children}
		</section>
	);
}

function Field({ label, htmlFor, children }) {
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<Label htmlFor={htmlFor} className="text-muted-foreground">
				{label}
			</Label>
			{children}
		</div>
	);
}

function FieldDays({ label, value, onChange }) {
	return (
		<Field label={label}>
			<div className="flex items-center gap-2">
				<Input
					type="number"
					inputMode="numeric"
					min={1}
					max={3650}
					value={value ?? ""}
					onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
					aria-label={`${label} (days)`}
					className="tabular-nums"
				/>
				<span className="text-sm text-muted-foreground">days</span>
			</div>
		</Field>
	);
}

function FieldDate({ label, value, onChange }) {
	const date = value ? new Date(value) : undefined;
	return (
		<Field label={label}>
			<div className="flex items-center gap-1">
				<Popover>
					<PopoverTrigger asChild>
						<Button type="button" variant="outline" className="min-w-0 flex-1 justify-start font-normal">
							<CalendarIcon data-icon="inline-start" />
							<span className={date ? "truncate" : "truncate text-muted-foreground"}>
								{date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Any date"}
							</span>
						</Button>
					</PopoverTrigger>
					<PopoverContent align="start" className="w-auto p-0">
						<Calendar
							mode="single"
							selected={date}
							defaultMonth={date}
							onSelect={(day) => onChange(day ? new Date(Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())).toISOString() : undefined)}
						/>
					</PopoverContent>
				</Popover>
				{date && (
					<Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(undefined)} aria-label={`Clear ${label}`}>
						<X />
					</Button>
				)}
			</div>
		</Field>
	);
}
