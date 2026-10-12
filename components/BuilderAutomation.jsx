"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	ArrowDown,
	ArrowUp,
	CircleAlert,
	Flag,
	Loader2,
	Mail,
	MoreHorizontal,
	Pause,
	Pencil,
	Play,
	Plus,
	Tag,
	Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
	addAutomationStep,
	changeAutomationStatus,
	moveAutomationStep,
	removeAutomationStep,
	saveAutomation,
} from "@/app/(app)/automations/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeStatus from "@/components/BadgeStatus";
import BadgeTag from "@/components/BadgeTag";
import HeaderPage from "@/components/HeaderPage";
import MenuAutomation from "@/components/MenuAutomation";
import SheetStep, { STEP_KINDS } from "@/components/SheetStep";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_NAME_LENGTH, childrenOf, describeWait, descendantIds, getActivationProblem, getStepProblem } from "@/lib/automation-rules";
import { formatNumber, formatRate } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function BuilderAutomation({ initialFlow, newsletter, enrollments, tags, segments, automations }) {
	const router = useRouter();
	const [flow, setFlow] = useState(initialFlow);
	const [editing, setEditing] = useState(null);
	const [deleting, setDeleting] = useState(null);
	const [isRenaming, setIsRenaming] = useState(false);
	const [isPending, startTransition] = useTransition();
	const { automation, steps, stats } = flow;
	const isActive = automation.status === "active";
	const problem = getActivationProblem(automation, steps);

	const names = useMemo(
		() => ({
			tags: new Map(tags.map((tag) => [tag.id, tag])),
			segments: new Map(segments.map(({ id, name }) => [id, name])),
			automations: new Map(automations.map(({ id, name }) => [id, name])),
		}),
		[tags, segments, automations]
	);

	function apply(action, onDone) {
		startTransition(async () => {
			const result = await action();
			if (result?.error) return toast.error(result.error);
			if (result?.steps) setFlow({ automation: result.automation, steps: result.steps, stats: result.stats });
			onDone?.(result);
		});
	}

	function addStep(type, place) {
		apply(
			() => addAutomationStep(automation.id, { ...place, type }),
			({ step }) => {
				if (type === "email") router.push(`/automations/${automation.id}/emails/${step.id}`);
				else setEditing(step.id);
			}
		);
	}

	function toggleStatus() {
		apply(
			() => changeAutomationStatus(automation.id, isActive ? "paused" : "active"),
			() => toast.success(isActive ? "Paused: contacts stay where they are" : "Live: contacts who get the tag now enter")
		);
	}

	const editingStep = steps.find(({ id }) => id === editing) ?? null;
	const context = { automation, steps, stats, names, isPending, onAdd: addStep, onEdit: setEditing, onDelete: setDeleting, apply };

	return (
		<>
			<HeaderPage
				title={automation.name}
				backHref="/automations"
				icon={<AvatarNewsletter newsletter={newsletter} size={28} />}
				meta={<BadgeStatus status={automation.status} />}
			>
				<span className="hidden text-sm text-muted-foreground tabular-nums sm:inline">
					{formatNumber((enrollments.active ?? 0) + (enrollments.waiting ?? 0))} in progress · {formatNumber(automation.stats.completed)} finished
				</span>
				<Button variant="ghost" size="icon" aria-label="Rename" onClick={() => setIsRenaming(true)}>
					<Pencil />
				</Button>
				<Tooltip>
					<TooltipTrigger asChild>
						<span tabIndex={!isActive && problem ? 0 : -1} className="rounded-lg">
							<Button onClick={toggleStatus} disabled={isPending || (!isActive && Boolean(problem))} variant={isActive ? "outline" : "default"}>
								{isPending ? (
									<Loader2 data-icon="inline-start" className="animate-spin" />
								) : isActive ? (
									<Pause data-icon="inline-start" />
								) : (
									<Play data-icon="inline-start" />
								)}
								{isActive ? "Pause" : "Activate"}
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent>{isActive ? "Contacts stay where they are until you resume" : (problem ?? "Contacts who get the tag start entering")}</TooltipContent>
				</Tooltip>
				<MenuAutomation
					automation={{ id: automation.id, name: automation.name, status: automation.status }}
					redirectTo="/automations"
					trigger={
						<Button variant="ghost" size="icon" aria-label="More">
							<MoreHorizontal />
						</Button>
					}
				/>
			</HeaderPage>

			<div className="overflow-x-auto pb-16">
				<div className="mx-auto flex w-max min-w-full flex-col items-center px-2 animate-enter">
					<CardTrigger automation={automation} tags={tags} isPending={isPending} apply={apply} />
					<Run parentId={null} branch={null} context={context} />
					<div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-muted-foreground shadow-border">
						<Flag className="size-3.5" />
						End of automation
					</div>
				</div>
			</div>

			<SheetStep
				key={editingStep?.id ?? "none"}
				step={editingStep}
				automationId={automation.id}
				tags={tags}
				segments={segments}
				automations={automations}
				onClose={() => setEditing(null)}
				onSaved={(result) => {
					setFlow({ automation: result.automation, steps: result.steps, stats: result.stats });
					setEditing(null);
				}}
			/>
			<DialogDeleteStep
				step={deleting}
				steps={steps}
				onOpenChange={(open) => !open && setDeleting(null)}
				onConfirm={() => apply(() => removeAutomationStep(deleting.id), () => setDeleting(null))}
				isPending={isPending}
			/>
			<DialogRename
				open={isRenaming}
				onOpenChange={setIsRenaming}
				name={automation.name}
				onSave={(name) => apply(() => saveAutomation(automation.id, { name }), () => setIsRenaming(false))}
				isPending={isPending}
			/>
		</>
	);
}

function CardTrigger({ automation, tags, isPending, apply }) {
	const tagId = automation.triggerConfig.tagId ?? "";
	const tag = tags.find(({ id }) => id === tagId);
	return (
		<div className="w-80 rounded-xl bg-card p-4 shadow-border sm:w-96">
			<div className="flex items-center gap-3">
				<span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
					<Tag className="size-4" />
				</span>
				<div className="min-w-0">
					<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Trigger</p>
					<p className="truncate text-sm font-medium">{tag ? `A contact gets the tag “${tag.name}”` : "A contact gets a tag"}</p>
				</div>
			</div>
			<div className="mt-4 flex flex-col gap-3">
				{tags.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No tags yet.{" "}
						<Link href="/tags" className="text-foreground underline underline-offset-2">
							Create one
						</Link>{" "}
						to start the automation with it.
					</p>
				) : (
					<Select value={tagId} onValueChange={(value) => apply(() => saveAutomation(automation.id, { tagId: value }))} disabled={isPending}>
						<SelectTrigger className="w-full" aria-label="Tag that starts the automation">
							<SelectValue placeholder="Pick a tag" />
						</SelectTrigger>
						<SelectContent>
							{tags.map((option) => (
								<SelectItem key={option.id} value={option.id}>
									<BadgeTag tag={option} />
									{typeof option.contacts === "number" && (
										<span className="text-xs text-muted-foreground tabular-nums">{formatNumber(option.contacts)}</span>
									)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				<div className="flex items-center justify-between gap-3">
					<Label htmlFor="automation-reentry" className="text-sm font-normal text-muted-foreground">
						Can enter again after finishing
					</Label>
					<Switch
						id="automation-reentry"
						checked={automation.allowReentry}
						disabled={isPending}
						onCheckedChange={(checked) => apply(() => saveAutomation(automation.id, { allowReentry: checked }))}
					/>
				</div>
			</div>
		</div>
	);
}

function Run({ parentId, branch, context }) {
	const run = childrenOf(context.steps, parentId, branch);
	return (
		<div className="flex w-full flex-col items-center">
			<Insert place={{ parentId, branch, index: 0 }} context={context} />
			{run.map((step, index) => (
				<Fragment key={step.id}>
					<CardStep step={step} canMoveUp={index > 0} canMoveDown={index < run.length - 1} context={context} />
					{step.type === "condition" && <Branches step={step} context={context} />}
					<Insert place={{ parentId, branch, index: index + 1 }} context={context} />
				</Fragment>
			))}
		</div>
	);
}

function Line({ className }) {
	return <div aria-hidden className={cn("h-5 w-px bg-border", className)} />;
}

function Insert({ place, context }) {
	return (
		<div className="flex flex-col items-center">
			<Line />
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label="Add a step here"
						disabled={context.isPending}
						className="grid size-6 place-items-center rounded-full bg-background text-muted-foreground shadow-border transition-[color,background-color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground"
					>
						<Plus className="size-3.5" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="center" className="w-72">
					<DropdownMenuLabel className="text-xs text-muted-foreground">Add a step</DropdownMenuLabel>
					{Object.entries(STEP_KINDS).map(([type, kind]) => (
						<DropdownMenuItem key={type} onSelect={() => context.onAdd(type, place)} className="gap-3 py-2">
							<span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", kind.tone)}>
								<kind.icon className="size-4" />
							</span>
							<span className="flex min-w-0 flex-col">
								<span className="text-sm font-medium">{kind.label}</span>
								<span className="text-xs text-muted-foreground">{kind.description}</span>
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<Line />
		</div>
	);
}

function Branches({ step, context }) {
	return (
		<div className="relative grid grid-cols-2 pt-5">
			<div aria-hidden className="absolute top-0 left-1/2 h-5 w-px bg-border" />
			<div aria-hidden className="absolute top-5 right-1/4 left-1/4 h-px bg-border" />
			{["yes", "no"].map((branch) => (
				<div key={branch} className="flex min-w-86 flex-col items-center px-3 sm:min-w-102">
					<Line />
					<span
						className={cn(
							"rounded-full px-2.5 py-0.5 text-xs font-medium",
							branch === "yes" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"
						)}
					>
						{branch === "yes" ? "Yes" : "No"}
					</span>
					<Run parentId={step.id} branch={branch} context={context} />
					<div aria-hidden className="w-px flex-1 bg-border" />
				</div>
			))}
			<div aria-hidden className="absolute right-1/4 bottom-0 left-1/4 h-px bg-border" />
		</div>
	);
}

function describeStep(step, names) {
	const config = step.config;
	switch (step.type) {
		case "wait":
			return describeWait(config);
		case "email":
			return config.subject || "No subject yet";
		case "webhook": {
			try {
				return `POST ${new URL(config.url).host}`;
			} catch {
				return "No URL yet";
			}
		}
		case "condition":
			if (config.kind === "in_segment") return config.segmentId ? `In the segment “${names.segments.get(config.segmentId) ?? "deleted"}”?` : "Pick a segment";
			return config.tagId ? `Has the tag “${names.tags.get(config.tagId)?.name ?? "deleted"}”?` : "Pick a tag";
		case "exit_automation":
			return config.automationId ? `Leave “${names.automations.get(config.automationId) ?? "deleted automation"}”` : "Pick an automation";
		default:
			return step.type;
	}
}

function CardStep({ step, canMoveUp, canMoveDown, context }) {
	const kind = STEP_KINDS[step.type] ?? STEP_KINDS.wait;
	const stat = context.stats[step.id];
	const problem = getStepProblem(step, { automationId: context.automation.id });
	const isEmail = step.type === "email";
	const href = `/automations/${context.automation.id}/emails/${step.id}`;
	const body = (
		<>
			<span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", kind.tone)}>
				<kind.icon className="size-4" />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{kind.label}</span>
				<span className="truncate text-sm font-medium" suppressHydrationWarning>
					{describeStep(step, context.names)}
				</span>
			</span>
		</>
	);
	const details = [
		stat?.here ? `${formatNumber(stat.here)} ${step.type === "wait" ? "waiting" : "here"}` : null,
		isEmail && stat?.sent ? `${formatNumber(stat.sent)} sent` : null,
		isEmail && stat?.sent ? `${formatRate(stat.opened, stat.sent, 0)} opened` : null,
		isEmail && stat?.sent ? `${formatRate(stat.clicked, stat.sent, 0)} clicked` : null,
	].filter(Boolean);

	return (
		<div className="group w-80 rounded-xl bg-card shadow-border transition-shadow duration-150 hover:shadow-border-hover sm:w-96">
			<div className="flex items-center gap-1 p-2">
				{isEmail ? (
					<Link href={href} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left transition-colors duration-150 hover:bg-muted/60">
						{body}
					</Link>
				) : (
					<button
						type="button"
						onClick={() => context.onEdit(step.id)}
						className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left transition-colors duration-150 hover:bg-muted/60"
					>
						{body}
					</button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon-sm" aria-label={`Actions for this ${kind.label.toLowerCase()} step`} disabled={context.isPending}>
							<MoreHorizontal />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{isEmail ? (
							<DropdownMenuItem asChild>
								<Link href={href}>
									<Pencil />
									Edit email
								</Link>
							</DropdownMenuItem>
						) : (
							<DropdownMenuItem onSelect={() => context.onEdit(step.id)}>
								<Pencil />
								Edit
							</DropdownMenuItem>
						)}
						<DropdownMenuItem disabled={!canMoveUp} onSelect={() => context.apply(() => moveAutomationStep(step.id, "up"))}>
							<ArrowUp />
							Move up
						</DropdownMenuItem>
						<DropdownMenuItem disabled={!canMoveDown} onSelect={() => context.apply(() => moveAutomationStep(step.id, "down"))}>
							<ArrowDown />
							Move down
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" onSelect={() => context.onDelete(step)}>
							<Trash2 />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{(problem || details.length > 0) && (
				<div className="flex flex-col gap-1 border-t border-border/60 px-4 py-2 text-xs">
					{problem && (
						<span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
							<CircleAlert className="size-3.5 shrink-0" />
							{problem}
						</span>
					)}
					{details.length > 0 && <span className="text-muted-foreground tabular-nums">{details.join(" · ")}</span>}
				</div>
			)}
			{isEmail && (
				<div className="border-t border-border/60 p-2">
					<Button asChild variant="ghost" size="sm" className="w-full">
						<Link href={href}>
							<Mail data-icon="inline-start" />
							Edit email
						</Link>
					</Button>
				</div>
			)}
		</div>
	);
}

function DialogDeleteStep({ step, steps, onOpenChange, onConfirm, isPending }) {
	const inside = step ? descendantIds(steps, step.id).length - 1 : 0;
	return (
		<Dialog open={Boolean(step)} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Delete this step?</DialogTitle>
					<DialogDescription>
						{inside > 0
							? `Both branches go with it: ${inside === 1 ? "1 more step" : `${inside} more steps`}. `
							: ""}
						Contacts sitting on it leave the automation.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">Cancel</Button>
					</DialogClose>
					<Button variant="destructive" onClick={onConfirm} disabled={isPending}>
						Delete step
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function DialogRename({ open, onOpenChange, name, onSave, isPending }) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open && <FormRename name={name} onSave={onSave} isPending={isPending} />}
			</DialogContent>
		</Dialog>
	);
}

function FormRename({ name: initialName, onSave, isPending }) {
	const [name, setName] = useState(initialName);
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				onSave(name);
			}}
			className="flex flex-col gap-5"
		>
			<DialogHeader>
				<DialogTitle>Rename automation</DialogTitle>
			</DialogHeader>
			<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} required autoFocus aria-label="Name" />
			<DialogFooter>
				<Button type="submit" disabled={isPending || !name.trim()} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : "Save"}
				</Button>
			</DialogFooter>
		</form>
	);
}
