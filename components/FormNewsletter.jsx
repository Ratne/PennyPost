"use client";

import { useActionState, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ExternalLink, FlaskConical, ImageUp, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { saveNewsletter, sendWelcomeTest } from "@/app/(app)/newsletters/actions";
import AvatarNewsletter from "@/components/AvatarNewsletter";
import PreviewEmail from "@/components/PreviewEmail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CLEANUP_LIMITS, LAST_CHANCE_DAYS, getCleanupSettings } from "@/lib/cleanup";
import { CONFIRM_URL_PLACEHOLDER, getConfirmationContent } from "@/lib/confirmation-content";
import { formatNumber } from "@/lib/format";
import { KEEP_URL_PLACEHOLDER, getLastChanceContent } from "@/lib/last-chance-content";
import { MAX_AUTHOR_BIO_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_FOOTER_LENGTH } from "@/lib/newsletters";
import { DEFAULT_LOGO_WIDTH, LOGO_WIDTH_LIMITS, UNSUBSCRIBE_PLACEHOLDER, renderEmail } from "@/lib/render-email";
import { slugify } from "@/lib/slug";
import { IMAGE_TYPES, prepareImage, uploadImage } from "@/lib/upload-image";
import { cn } from "@/lib/utils";

const IMAGE_PREVIEW_PATTERN = /^(https:\/\/\S+\.\S{2,}\/\S+|\/\S+\.\w{3,4})$/;
const LOGO_PREVIEW_PATTERN = /^(https:\/\/\S+\.\S{2,}\/\S+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/\S+)$/;
const FOOTER_PLACEHOLDER = `**Company Ltd**, registered office: 1 Main Street, City, Country
VAT number 01234567890 · Company register no. AB-123456 · Share capital €10,000 fully paid
[Privacy policy](https://example.com/privacy)`;

export default function FormNewsletter({ newsletter, verifiedDomains, isSendingEnabled, testEmail, cleanupTotals, otherHomepageName }) {
	const [state, action, isPending] = useActionState(saveNewsletter, null);
	const [isTesting, startTesting] = useTransition();
	const [name, setName] = useState(newsletter?.name ?? "");
	const [slug, setSlug] = useState(newsletter?.slug ?? "");
	const [isSlugEdited, setIsSlugEdited] = useState(Boolean(newsletter));
	const [fromName, setFromName] = useState(newsletter?.fromName ?? "");
	const [fromEmail, setFromEmail] = useState(newsletter?.fromEmail ?? "");
	const [imageUrl, setImageUrl] = useState(newsletter?.imageUrl ?? "");
	const [emailLogoUrl, setEmailLogoUrl] = useState(newsletter?.emailLogoUrl ?? "");
	const [emailLogoWidth, setEmailLogoWidth] = useState(String(newsletter?.emailLogoWidth ?? DEFAULT_LOGO_WIDTH));
	const [footerMarkdown, setFooterMarkdown] = useState(newsletter?.footerMarkdown ?? "");
	const [isUploadingLogo, setIsUploadingLogo] = useState(false);
	const logoInputRef = useRef(null);
	const [authorImageUrl, setAuthorImageUrl] = useState(newsletter?.author?.imageUrl ?? "");
	const [isUploadingAuthor, setIsUploadingAuthor] = useState(false);
	const authorInputRef = useRef(null);
	const [isConfirmationRequired, setIsConfirmationRequired] = useState(Boolean(newsletter?.requireConfirmation));
	const [confirmationEdits, setConfirmationEdits] = useState(null);
	const [isWelcomeEnabled, setIsWelcomeEnabled] = useState(Boolean(newsletter?.welcome?.enabled));
	const [welcome, setWelcome] = useState({
		subject: newsletter?.welcome?.subject ?? "",
		previewText: newsletter?.welcome?.previewText ?? "",
		markdown: newsletter?.welcome?.markdown ?? "",
	});
	const [isArchiveEnabled, setIsArchiveEnabled] = useState(Boolean(newsletter?.archiveEnabled));
	const [isHomepage, setIsHomepage] = useState(Boolean(newsletter?.isHomepage));
	const savedCleanup = getCleanupSettings(newsletter);
	const [isCleanupEnabled, setIsCleanupEnabled] = useState(savedCleanup.enabled);
	const [cleanup, setCleanup] = useState({ issues: String(savedCleanup.issues), days: String(savedCleanup.days) });
	const deferredWelcome = useDeferredValue(welcome);
	const deferredFooter = useDeferredValue(footerMarkdown);
	const previewLogoUrl = LOGO_PREVIEW_PATTERN.test(emailLogoUrl) ? emailLogoUrl : "";
	// What every preview below renders the email with: the unsaved logo and footer show up right away.
	const emailNewsletter = useMemo(
		() => ({ name, emailLogoUrl: previewLogoUrl, emailLogoWidth: Number(emailLogoWidth), footerMarkdown: deferredFooter }),
		[name, previewLogoUrl, emailLogoWidth, deferredFooter]
	);

	useEffect(() => {
		if (state?.ok) toast.success("Saved");
		if (state?.error) toast.error(state.error);
	}, [state]);

	async function upload(file, { setUrl, setIsUploading, inputRef, toPath = (url) => url }) {
		if (!file) return;
		setIsUploading(true);
		try {
			const image = await prepareImage(file);
			setUrl(toPath(await uploadImage(image.file)));
		} catch (error) {
			toast.error(error.message);
		} finally {
			setIsUploading(false);
			if (inputRef.current) inputRef.current.value = "";
		}
	}

	const uploadLogo = (file) => upload(file, { setUrl: setEmailLogoUrl, setIsUploading: setIsUploadingLogo, inputRef: logoInputRef });
	// Archive pages take https:// links or paths: a local upload (http://localhost) is kept as its path.
	const uploadAuthorPhoto = (file) =>
		upload(file, {
			setUrl: setAuthorImageUrl,
			setIsUploading: setIsUploadingAuthor,
			inputRef: authorInputRef,
			toPath: (url) => {
				const parsed = new URL(url, window.location.href);
				return parsed.protocol === "http:" && parsed.origin === window.location.origin ? parsed.pathname : url;
			},
		});

	const designHtml = useMemo(
		() =>
			renderEmail({
				markdown: "Your issue goes here, between the logo and the footer.",
				subject: "Your next issue",
				newsletter: emailNewsletter,
			}).html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"),
		[emailNewsletter]
	);

	const welcomeHtml = useMemo(
		() =>
			renderEmail({
				markdown: deferredWelcome.markdown,
				subject: deferredWelcome.subject,
				previewText: deferredWelcome.previewText,
				newsletter: emailNewsletter,
			}).html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#"),
		[deferredWelcome, emailNewsletter]
	);

	// Until it's edited, the built-in email follows the name.
	const confirmation = useMemo(
		() => confirmationEdits ?? getConfirmationContent({ name, confirmation: newsletter?.confirmation }),
		[confirmationEdits, name, newsletter?.confirmation]
	);
	const deferredConfirmation = useDeferredValue(confirmation);
	const confirmationHtml = useMemo(
		() =>
			renderEmail({ ...deferredConfirmation, newsletter: emailNewsletter })
				.html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#")
				.replaceAll(CONFIRM_URL_PLACEHOLDER, "#"),
		[deferredConfirmation, emailNewsletter]
	);

	const lastChance = useMemo(() => {
		const content = getLastChanceContent({ name, fromEmail });
		const { html } = renderEmail({ ...content, newsletter: emailNewsletter });
		return {
			...content,
			html: html.replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#").replaceAll(KEEP_URL_PLACEHOLDER, "#"),
		};
	}, [name, fromEmail, emailNewsletter]);

	const previewImageUrl = IMAGE_PREVIEW_PATTERN.test(imageUrl) ? imageUrl : "";
	const fromDomain = fromEmail.split("@")[1]?.trim().toLowerCase();
	const isDomainUnverified =
		Boolean(fromDomain) && Array.isArray(verifiedDomains) && !verifiedDomains.includes(fromDomain);

	function updateConfirmation(key) {
		return (event) => {
			const { value } = event.target;
			setConfirmationEdits((current) => ({ ...(current ?? confirmation), [key]: value }));
		};
	}

	function updateWelcome(key) {
		return (event) => {
			const { value } = event.target;
			setWelcome((current) => ({ ...current, [key]: value }));
		};
	}

	function updateCleanup(key) {
		return (event) => {
			const { value } = event.target;
			setCleanup((current) => ({ ...current, [key]: value }));
		};
	}

	function sendTest() {
		startTesting(async () => {
			const result = await sendWelcomeTest(newsletter._id);
			if (result?.error) toast.error(result.error);
			else toast.success(`Test sent to ${testEmail}`);
		});
	}

	return (
		<form action={action} className="flex flex-col gap-4">
			{newsletter && <input type="hidden" name="id" value={newsletter._id} />}

			<Section title="General" stagger={0}>
				<Field label="Name">
					<Input
						name="name"
						value={name}
						required
						placeholder="Field notes"
						onChange={(event) => {
							setName(event.target.value);
							if (!isSlugEdited) setSlug(slugify(event.target.value));
						}}
					/>
				</Field>
				<Field label="Slug">
					<Input
						name="slug"
						value={slug}
						required
						placeholder="field-notes"
						className="font-mono"
						onChange={(event) => {
							setSlug(event.target.value);
							setIsSlugEdited(true);
						}}
					/>
				</Field>
				<Field label="Image" hint="Square logo, 128×128 or larger">
					<span className="flex items-center gap-3">
						<AvatarNewsletter newsletter={{ name, imageUrl: previewImageUrl }} size={36} />
						<Input
							name="imageUrl"
							value={imageUrl}
							placeholder="https://example.com/logo.png"
							onChange={(event) => setImageUrl(event.target.value)}
						/>
					</span>
				</Field>
			</Section>

			<Section title="Sender" stagger={1}>
				<Field label="From name">
					<Input
						name="fromName"
						value={fromName}
						placeholder="Jane Doe"
						onChange={(event) => setFromName(event.target.value)}
					/>
				</Field>
				<Field
					label="From email"
					hint={isDomainUnverified ? `${fromDomain} is not verified in SES` : null}
					isWarning
				>
					<Input
						name="fromEmail"
						type="email"
						value={fromEmail}
						required
						placeholder="hi@mail.example.com"
						onChange={(event) => setFromEmail(event.target.value)}
					/>
				</Field>
				<Field label="Reply-to">
					<Input name="replyTo" type="email" defaultValue={newsletter?.replyTo} placeholder="Optional" />
				</Field>
			</Section>

			<Section title="Email design" stagger={1}>
				<Field label="Logo" hint="Shown centered at the top of every email. PNG or JPEG, not WebP: Outlook can't show it.">
					<span className="flex flex-col gap-3">
						<span className="flex items-center gap-2">
							<Input
								name="emailLogoUrl"
								value={emailLogoUrl}
								placeholder="https://example.com/logo.png"
								className="font-mono"
								onChange={(event) => setEmailLogoUrl(event.target.value)}
							/>
							<input
								ref={logoInputRef}
								type="file"
								accept={IMAGE_TYPES.join(",")}
								hidden
								onChange={(event) => uploadLogo(event.target.files?.[0])}
							/>
							<Button
								type="button"
								variant="outline"
								onClick={() => logoInputRef.current?.click()}
								disabled={isUploadingLogo}
							>
								{isUploadingLogo ? <Loader2 className="animate-spin" /> : <ImageUp />}
								Upload
							</Button>
							{emailLogoUrl && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label="Remove logo"
									onClick={() => setEmailLogoUrl("")}
								>
									<X />
								</Button>
							)}
						</span>
						{previewLogoUrl && (
							<span className="flex justify-center rounded-lg bg-white p-4 shadow-border">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={previewLogoUrl}
									alt=""
									style={{ width: `${Number(emailLogoWidth) || DEFAULT_LOGO_WIDTH}px`, maxWidth: "100%", height: "auto" }}
								/>
							</span>
						)}
					</span>
				</Field>
				<Field label="Logo width" hint={`In pixels, from ${LOGO_WIDTH_LIMITS.min} to ${LOGO_WIDTH_LIMITS.max}`}>
					<span className="flex items-center gap-2">
						<Input
							name="emailLogoWidth"
							type="number"
							inputMode="numeric"
							min={LOGO_WIDTH_LIMITS.min}
							max={LOGO_WIDTH_LIMITS.max}
							value={emailLogoWidth}
							onChange={(event) => setEmailLogoWidth(event.target.value)}
							className="w-28 tabular-nums"
						/>
						<span className="text-sm text-muted-foreground">px</span>
					</span>
				</Field>
				<Field
					label="Footer"
					hint="Markdown, shown under the unsubscribe link of every email. Anti-spam and company laws require your legal details here."
				>
					<Textarea
						name="footerMarkdown"
						value={footerMarkdown}
						onChange={(event) => setFooterMarkdown(event.target.value)}
						rows={4}
						maxLength={MAX_FOOTER_LENGTH}
						placeholder={FOOTER_PLACEHOLDER}
						className="font-mono text-[13px] leading-6"
					/>
				</Field>
				<div className="p-3">
					<PreviewEmail
						html={designHtml}
						sender={{ name, fromName, fromEmail, imageUrl: previewImageUrl }}
						subject="Your next issue"
						previewText="How every email starts and ends"
						fit="content"
					/>
				</div>
			</Section>

			<Section
				title="Confirm new signups"
				stagger={2}
				action={
					<Switch
						name="requireConfirmation"
						checked={isConfirmationRequired}
						onCheckedChange={setIsConfirmationRequired}
						aria-label="Confirm new signups"
					/>
				}
			>
				<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
					New subscribers get this email and only join once they click its button, so fake and mistyped
					addresses never reach the list. It&apos;s the only email they get: say what comes next.
				</p>
				{isConfirmationRequired && (
					<>
						<Field label="Subject">
							<Input
								name="confirmationSubject"
								value={confirmation.subject}
								required
								onChange={updateConfirmation("subject")}
							/>
						</Field>
						<Field label="Preview text">
							<Input
								name="confirmationPreviewText"
								value={confirmation.previewText}
								placeholder="Optional"
								onChange={updateConfirmation("previewText")}
							/>
						</Field>
						<Field
							label="Content"
							hint={`Markdown. Keep the button: its ${CONFIRM_URL_PLACEHOLDER} becomes each subscriber's link.`}
						>
							<Textarea
								name="confirmationMarkdown"
								value={confirmation.markdown}
								onChange={updateConfirmation("markdown")}
								className="min-h-48 font-mono text-[13px] leading-6"
							/>
						</Field>
						<div className="p-3">
							<PreviewEmail
								html={confirmationHtml}
								sender={{ name, fromName, fromEmail, imageUrl: previewImageUrl }}
								subject={deferredConfirmation.subject}
								previewText={deferredConfirmation.previewText}
								fit="content"
							/>
						</div>
					</>
				)}
			</Section>

			<Section
				title="Welcome email"
				stagger={3}
				collapsedNote={
					isConfirmationRequired &&
					"Not sent while new signups confirm, since the confirmation email replaces it. Its content is kept."
				}
				action={
					<Switch
						name="welcomeEnabled"
						checked={isWelcomeEnabled}
						onCheckedChange={setIsWelcomeEnabled}
						aria-label="Welcome email"
					/>
				}
			>
				<Field label="Subject">
					<Input name="welcomeSubject" value={welcome.subject} onChange={updateWelcome("subject")} />
				</Field>
				<Field label="Preview text">
					<Input
						name="welcomePreviewText"
						value={welcome.previewText}
						placeholder="Optional"
						onChange={updateWelcome("previewText")}
					/>
				</Field>
				<Field label="Content" hint="Markdown">
					<Textarea
						name="welcomeMarkdown"
						value={welcome.markdown}
						onChange={updateWelcome("markdown")}
						className="min-h-48 font-mono text-[13px] leading-6"
					/>
				</Field>
				{deferredWelcome.markdown.trim() && (
					<div className="p-3">
						<PreviewEmail
							html={welcomeHtml}
							sender={{ name, fromName, fromEmail, imageUrl: previewImageUrl }}
							subject={deferredWelcome.subject}
							previewText={deferredWelcome.previewText}
							fit="content"
						/>
					</div>
				)}
				{newsletter && (
					<div className="flex items-center justify-between gap-3 px-4 py-3">
						<p className="text-xs text-muted-foreground">
							{isSendingEnabled ? `Sends the saved version to ${testEmail}` : "Sending is off"}
						</p>
						<Button type="button" variant="outline" size="sm" onClick={sendTest} disabled={!isSendingEnabled || isTesting}>
							{isTesting ? <Loader2 className="animate-spin" /> : <FlaskConical />}
							Send test
						</Button>
					</div>
				)}
			</Section>

			<Section
				title="List cleanup"
				stagger={4}
				action={
					<Switch
						name="cleanupEnabled"
						checked={isCleanupEnabled}
						onCheckedChange={setIsCleanupEnabled}
						aria-label="List cleanup"
					/>
				}
			>
				<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
					Checked each time you send an issue. Contacts who ignored the last {cleanup.issues || savedCleanup.issues}{" "}
					issues and showed no sign of life for {cleanup.days || savedCleanup.days} days get this email instead. A click
					on its button keeps them. Anyone who doesn&apos;t answer by a send{" "}
					{LAST_CHANCE_DAYS} days later becomes dormant: not unsubscribed, not deleted, and back if they sign up again.
				</p>
				<Field label="Ignored issues" hint="In a row, counting from the first issue Penny Post sent">
					<Input
						name="cleanupIssues"
						type="number"
						inputMode="numeric"
						min={CLEANUP_LIMITS.minIssues}
						max={CLEANUP_LIMITS.maxIssues}
						value={cleanup.issues}
						onChange={updateCleanup("issues")}
						className="w-28 tabular-nums"
					/>
				</Field>
				<Field label="Quiet for" hint="Days since the last open, click or signup">
					<span className="flex items-center gap-2">
						<Input
							name="cleanupDays"
							type="number"
							inputMode="numeric"
							min={CLEANUP_LIMITS.minDays}
							max={CLEANUP_LIMITS.maxDays}
							value={cleanup.days}
							onChange={updateCleanup("days")}
							className="w-28 tabular-nums"
						/>
						<span className="text-sm text-muted-foreground">days</span>
					</span>
				</Field>
				{cleanupTotals && <CleanupTotals totals={cleanupTotals} />}
				{isCleanupEnabled && (
					<div className="p-3">
						<PreviewEmail
							html={lastChance.html}
							sender={{ name, fromName, fromEmail, imageUrl: previewImageUrl }}
							subject={lastChance.subject}
							previewText={lastChance.previewText}
							fit="content"
						/>
					</div>
				)}
			</Section>

			<Section
				title="Public archive"
				stagger={5}
				action={
					<div className="flex items-center gap-3">
						{newsletter?.archiveEnabled && (
							<a
								href={`/archive/${newsletter.slug}`}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
							>
								View
								<ExternalLink className="size-3" />
							</a>
						)}
						<Switch
							name="archiveEnabled"
							checked={isArchiveEnabled}
							onCheckedChange={setIsArchiveEnabled}
							aria-label="Public archive"
						/>
					</div>
				}
			>
				<p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
					Sent issues get a page at /archive/{slug || "slug"}, with a signup form. To serve it on its own domain, add
					the domain to ARCHIVE_HOSTS.
				</p>
				{isArchiveEnabled && (
					<Field
						label="Homepage"
						hint={
							isHomepage && otherHomepageName
								? `Replaces ${otherHomepageName}: only one newsletter can be the homepage.`
								: "Visitors to / see this archive. You still get the dashboard there while logged in."
						}
						isWarning={isHomepage && Boolean(otherHomepageName)}
					>
						<Switch name="isHomepage" checked={isHomepage} onCheckedChange={setIsHomepage} aria-label="Homepage" />
					</Field>
				)}
				<Field label="Description" hint="One sentence under the name and in the subscribe popup">
					<Textarea
						name="description"
						defaultValue={newsletter?.description}
						rows={2}
						maxLength={MAX_DESCRIPTION_LENGTH}
						placeholder="One idea about building things, every Sunday."
					/>
				</Field>
				<Field label="Author bio" hint="Under your name on the author page">
					<Input
						name="authorBio"
						defaultValue={newsletter?.author?.bio}
						maxLength={MAX_AUTHOR_BIO_LENGTH}
						placeholder="I write about building small software companies."
					/>
				</Field>
				<Field label="Author photo" hint="Upload one, or paste an https:// link or a path like /authors/jane.jpg. The newsletter image otherwise.">
					<span className="flex items-center gap-2">
						{IMAGE_PREVIEW_PATTERN.test(authorImageUrl) && (
							// eslint-disable-next-line @next/next/no-img-element
							<img src={authorImageUrl} alt="" className="size-9 shrink-0 rounded-full object-cover shadow-border" />
						)}
						<Input
							name="authorImageUrl"
							value={authorImageUrl}
							onChange={(event) => setAuthorImageUrl(event.target.value)}
							placeholder="https://example.com/jane.jpg"
							className="font-mono"
						/>
						<input
							ref={authorInputRef}
							type="file"
							accept={IMAGE_TYPES.join(",")}
							hidden
							onChange={(event) => uploadAuthorPhoto(event.target.files?.[0])}
						/>
						<Button
							type="button"
							variant="outline"
							onClick={() => authorInputRef.current?.click()}
							disabled={isUploadingAuthor}
						>
							{isUploadingAuthor ? <Loader2 className="animate-spin" /> : <ImageUp />}
							Upload
						</Button>
						{authorImageUrl && (
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="Remove author photo"
								onClick={() => setAuthorImageUrl("")}
							>
								<X />
							</Button>
						)}
					</span>
				</Field>
				<Field label="Social links" hint="One link per line">
					<Textarea
						name="socialLinks"
						defaultValue={newsletter?.socialLinks?.join("\n")}
						rows={3}
						placeholder={"https://x.com/example\nhttps://youtube.com/@example"}
						className="font-mono text-[13px] leading-6"
					/>
				</Field>
			</Section>

			<div className="sticky bottom-0 -mx-4 mt-2 flex justify-end bg-background/80 px-4 py-3 backdrop-blur-md md:-mx-10 md:px-10">
				<Button type="submit" disabled={isPending} className="min-w-20">
					{isPending ? <Loader2 className="animate-spin" /> : newsletter ? "Save" : "Create"}
				</Button>
			</div>
		</form>
	);
}

// With a collapsedNote, the note stands in for the action and the fields, which aren't sent with the form.
function Section({ title, action, stagger, collapsedNote, children }) {
	return (
		<section style={{ "--stagger": stagger }} className="rounded-xl bg-card shadow-border animate-enter">
			<div className="flex h-12 items-center justify-between gap-3 px-4">
				<h2 className="text-sm font-medium">{title}</h2>
				{!collapsedNote && action}
			</div>
			{collapsedNote ? (
				<p className="border-t border-border/60 px-4 py-3 text-sm text-pretty text-muted-foreground">
					{collapsedNote}
				</p>
			) : (
				children && <div className="divide-y divide-border/60 border-t border-border/60">{children}</div>
			)}
		</section>
	);
}

function CleanupTotals({ totals }) {
	const stats = [
		{ label: "Waiting for an answer", value: totals.waiting },
		{ label: "Kept after the email", value: totals.kept },
		{ label: "Made dormant", value: totals.dormant },
	];
	return (
		<dl className="grid grid-cols-3 divide-x divide-border/60">
			{stats.map(({ label, value }) => (
				<div key={label} className="flex flex-col gap-1 px-4 py-3">
					<dt className="text-xs text-pretty text-muted-foreground">{label}</dt>
					<dd className="text-lg font-semibold tabular-nums">{formatNumber(value)}</dd>
				</div>
			))}
		</dl>
	);
}

function Field({ label, hint, isWarning, children }) {
	return (
		<label className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
			<span className="text-sm text-muted-foreground sm:pt-2">{label}</span>
			<span className="flex flex-col gap-1.5">
				{children}
				{hint && (
					<span
						className={cn(
							"text-xs",
							isWarning ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
						)}
					>
						{hint}
					</span>
				)}
			</span>
		</label>
	);
}
