"use client";

import { useCallback, useDeferredValue, useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Check, CircleAlert, FlaskConical, Loader2, Workflow } from "lucide-react";
import { toast } from "sonner";
import { saveAutomationEmail, sendAutomationTest } from "@/app/(app)/automations/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import BadgeEmailSize from "@/components/BadgeEmailSize";
import EditorRich from "@/components/EditorRich";
import HeaderPage from "@/components/HeaderPage";
import PreviewEmail from "@/components/PreviewEmail";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { estimateTrackedBytes } from "@/lib/email-size";
import { UNSUBSCRIBE_PLACEHOLDER, renderEmail, withResponsiveImages } from "@/lib/render-email";
import { useAutosave } from "@/lib/use-autosave";

const UPLOADING_MESSAGE = "Wait for images to finish uploading";

// An automation step's email, laid out like the campaign editor. Saves as you type.
export default function FormAutomationEmail({ automation, step, newsletter, isSendingEnabled, testEmail, appUrl }) {
	const [initialBody] = useState(step.html ?? "");
	const [values, setValues] = useState({ subject: step.subject ?? "", previewText: step.previewText ?? "", body: initialBody });
	const save = useCallback((snapshot) => saveAutomationEmail(step.id, snapshot), [step.id]);
	const { isDirty, isSaving, error, flush } = useAutosave(values, save);
	const [isTesting, startTesting] = useTransition();
	const deferredValues = useDeferredValue(values);
	const isUploading = values.body.includes('src="blob:');
	const backHref = `/automations/${automation.id}`;

	const rendered = useMemo(() => {
		const email = renderEmail({
			format: "rich",
			html: deferredValues.body,
			subject: deferredValues.subject,
			previewText: deferredValues.previewText,
			newsletter,
		});
		return { ...email, bytes: estimateTrackedBytes(email.html, appUrl) };
	}, [deferredValues, newsletter, appUrl]);
	const previewHtml = useMemo(() => withResponsiveImages(rendered.html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#")), [rendered.html]);

	function sendTest() {
		startTesting(async () => {
			if (isUploading) return void toast.error(UPLOADING_MESSAGE);
			if (!(await flush())) return void toast.error("Couldn't save the email");
			const result = await sendAutomationTest(step.id);
			if (result?.error) toast.error(result.error);
			else toast.success(`Test sent to ${testEmail}`);
		});
	}

	const onKeyDown = useEffectEvent((event) => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			flush();
		}
	});
	const onBeforeUnload = useEffectEvent((event) => {
		if (!isDirty && !isSaving) return;
		flush();
		event.preventDefault();
	});

	useEffect(() => {
		function handleKeyDown(event) {
			onKeyDown(event);
		}
		function handleBeforeUnload(event) {
			onBeforeUnload(event);
		}
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("beforeunload", handleBeforeUnload);
		};
	}, []);

	function update(key) {
		return (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
	}

	const updateBody = useCallback((body) => setValues((current) => ({ ...current, body })), []);
	const from = newsletter.fromName ? `${newsletter.fromName} <${newsletter.fromEmail}>` : newsletter.fromEmail;

	return (
		<>
			<HeaderPage
				title={values.subject || "Untitled email"}
				backHref={backHref}
				icon={<AvatarNewsletter newsletter={newsletter} size={28} />}
				meta={
					<Link
						href={backHref}
						className="flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground shadow-border transition-colors duration-150 hover:text-foreground"
					>
						<Workflow className="size-3.5 shrink-0" />
						<span className="truncate">{automation.name}</span>
					</Link>
				}
			>
				<StatusSave isSaving={isDirty || isSaving} error={error} onRetry={flush} />
				<Tooltip>
					<TooltipTrigger asChild>
						<span tabIndex={isSendingEnabled ? -1 : 0} className="rounded-lg">
							<Button variant="outline" onClick={sendTest} disabled={!isSendingEnabled || isTesting}>
								{isTesting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <FlaskConical data-icon="inline-start" />}
								Test
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent>{isSendingEnabled ? `Sends to ${testEmail}` : "Sending is off"}</TooltipContent>
				</Tooltip>
				<Button asChild>
					<Link href={backHref} onClick={() => flush()}>
						Done
					</Link>
				</Button>
			</HeaderPage>

			<div className="grid gap-4 lg:grid-cols-2 lg:items-start">
				<div className="overflow-hidden rounded-xl bg-card shadow-border animate-enter">
					<Row label="From">
						<span className="truncate text-sm">{from}</span>
					</Row>
					<Row label="Subject">
						<input
							value={values.subject}
							onChange={update("subject")}
							placeholder="Subject"
							maxLength={200}
							className="h-11 w-full min-w-0 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
						/>
					</Row>
					<Row label="Preview">
						<input
							value={values.previewText}
							onChange={update("previewText")}
							placeholder="Text shown after the subject"
							maxLength={300}
							className="h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						/>
					</Row>
					<EditorRich content={initialBody} onChange={updateBody} />
				</div>

				<div style={{ "--stagger": 1 }} className="flex flex-col gap-4 animate-enter lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)]">
					<PreviewEmail
						sender={newsletter}
						subject={deferredValues.subject}
						previewText={deferredValues.previewText}
						html={previewHtml}
						className="lg:min-h-0 lg:flex-1"
						toolbar={<BadgeEmailSize htmlBytes={rendered.bytes} html={rendered.html} />}
					/>
				</div>
			</div>
		</>
	);
}

function StatusSave({ isSaving, error, onRetry }) {
	if (error) {
		return (
			<button type="button" onClick={onRetry} title={error} className="flex items-center gap-1.5 text-xs text-destructive hover:underline">
				<CircleAlert className="size-3.5" />
				Not saved, retry
			</button>
		);
	}
	return (
		<span aria-live="polite" className="flex min-w-16 items-center justify-end gap-1.5 text-xs text-muted-foreground">
			{isSaving ? (
				"Saving…"
			) : (
				<>
					<Check className="size-3.5" />
					Saved
				</>
			)}
		</span>
	);
}

function Row({ label, children }) {
	return (
		<div className="grid min-h-11 grid-cols-[4.5rem_minmax(0,1fr)] items-center border-b border-border/60 px-4 transition-colors duration-150 focus-within:bg-muted/40">
			<span className="text-sm text-muted-foreground">{label}</span>
			{children}
		</div>
	);
}
