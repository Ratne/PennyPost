"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revalidateArchive } from "@/lib/archive-data";
import { requireSession } from "@/lib/auth";
import { CLEANUP_LIMITS } from "@/lib/cleanup";
import { isSendingEnabled } from "@/lib/config";
import { getConfirmationProblem } from "@/lib/confirmation-content";
import { MAX_AUTHOR_BIO_LENGTH, MAX_DESCRIPTION_LENGTH, MAX_FOOTER_LENGTH } from "@/lib/newsletters";
import { LOGO_WIDTH_LIMITS } from "@/lib/render-email";
import { sendWelcomeTestEmail } from "@/lib/sending";
import { parseSocialLinks } from "@/lib/social";
import { isObjectIdString } from "@/lib/validation";
import { batch, newId, statement } from "@/server/db";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMAGE_URL_PATTERN = /^(https:\/\/[^\s"'<>]{4,490}|\/[\w\-./]{1,200})$/;
// Mail clients load the logo from anywhere, so it needs an absolute URL. Local uploads are served over http.
const LOGO_URL_PATTERN = /^(https:\/\/[^\s"'<>]{4,490}|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s"'<>]{1,490})$/;

function readText(formData, key) {
	return String(formData.get(key) ?? "").trim();
}

// Empty stays unset, so the newsletter's default applies.
function readNumber(formData, key) {
	const text = readText(formData, key);
	return text ? Number(text) : undefined;
}

function isWithin(value, min, max) {
	return value === undefined || (Number.isInteger(value) && value >= min && value <= max);
}

function readNewsletter(formData) {
	return {
		name: readText(formData, "name"),
		slug: readText(formData, "slug").toLowerCase(),
		imageUrl: readText(formData, "imageUrl"),
		emailLogoUrl: readText(formData, "emailLogoUrl"),
		emailLogoWidth: readNumber(formData, "emailLogoWidth"),
		fromName: readText(formData, "fromName"),
		fromEmail: readText(formData, "fromEmail").toLowerCase(),
		replyTo: readText(formData, "replyTo").toLowerCase(),
		footerMarkdown: readText(formData, "footerMarkdown"),
		archiveEnabled: formData.get("archiveEnabled") === "on",
		// The homepage shows the public archive, so it can't outlive it.
		isHomepage: formData.get("archiveEnabled") === "on" && formData.get("isHomepage") === "on",
		description: readText(formData, "description"),
		author: { bio: readText(formData, "authorBio"), imageUrl: readText(formData, "authorImageUrl") },
		socialLinks: parseSocialLinks(formData.get("socialLinks")),
		requireConfirmation: formData.get("requireConfirmation") === "on",
		cleanup: {
			enabled: formData.get("cleanupEnabled") === "on",
			issues: readNumber(formData, "cleanupIssues"),
			days: readNumber(formData, "cleanupDays"),
		},
		welcome: {
			enabled: formData.get("welcomeEnabled") === "on",
			subject: readText(formData, "welcomeSubject"),
			previewText: readText(formData, "welcomePreviewText"),
			markdown: String(formData.get("welcomeMarkdown") ?? ""),
		},
		confirmation: {
			subject: readText(formData, "confirmationSubject"),
			previewText: readText(formData, "confirmationPreviewText"),
			markdown: String(formData.get("confirmationMarkdown") ?? ""),
		},
	};
}

function validateNewsletter(values) {
	if (!values.name) return "Name is required";
	if (!SLUG_PATTERN.test(values.slug)) return "Slug can only use lowercase letters, numbers and dashes";
	if (values.imageUrl && !IMAGE_URL_PATTERN.test(values.imageUrl)) {
		return "Image must be an https:// link or a path like /logos/name.webp";
	}
	if (values.emailLogoUrl && !LOGO_URL_PATTERN.test(values.emailLogoUrl)) {
		return "Logo must be an https:// link";
	}
	if (!isWithin(values.emailLogoWidth, LOGO_WIDTH_LIMITS.min, LOGO_WIDTH_LIMITS.max)) {
		return `Logo width should be a whole number from ${LOGO_WIDTH_LIMITS.min} to ${LOGO_WIDTH_LIMITS.max}`;
	}
	if (values.footerMarkdown.length > MAX_FOOTER_LENGTH) {
		return `Keep the footer under ${MAX_FOOTER_LENGTH} characters`;
	}
	if (!EMAIL_PATTERN.test(values.fromEmail)) return "From email is invalid";
	if (values.replyTo && !EMAIL_PATTERN.test(values.replyTo)) return "Reply-to email is invalid";
	if (values.description.length > MAX_DESCRIPTION_LENGTH) {
		return `Keep the description under ${MAX_DESCRIPTION_LENGTH} characters`;
	}
	if (values.author.bio.length > MAX_AUTHOR_BIO_LENGTH) {
		return `Keep the author bio under ${MAX_AUTHOR_BIO_LENGTH} characters`;
	}
	if (values.author.imageUrl && !IMAGE_URL_PATTERN.test(values.author.imageUrl)) {
		return "Author photo must be an https:// link or a path like /authors/name.jpg";
	}
	if (values.socialLinks.error) return values.socialLinks.error;
	const { minIssues, maxIssues, minDays, maxDays } = CLEANUP_LIMITS;
	if (!isWithin(values.cleanup.issues, minIssues, maxIssues)) {
		return `Ignored issues should be a whole number from ${minIssues} to ${maxIssues}`;
	}
	if (!isWithin(values.cleanup.days, minDays, maxDays)) {
		return `Quiet days should be a whole number from ${minDays} to ${maxDays}`;
	}
	if (values.welcome.enabled && (!values.welcome.subject || !values.welcome.markdown.trim())) {
		return "Welcome email needs a subject and content";
	}
	return values.requireConfirmation ? getConfirmationProblem(values.confirmation) : null;
}

function orNull(value) {
	return value === "" || value === undefined ? null : value;
}

function toColumns(values, sections) {
	return {
		name: values.name,
		slug: values.slug,
		image_url: orNull(values.imageUrl),
		email_logo_url: orNull(values.emailLogoUrl),
		email_logo_width: orNull(values.emailLogoWidth),
		from_name: orNull(values.fromName),
		from_email: values.fromEmail,
		reply_to: orNull(values.replyTo),
		footer_markdown: orNull(values.footerMarkdown),
		archive_enabled: values.archiveEnabled,
		is_homepage: values.isHomepage,
		description: orNull(values.description),
		social_links: JSON.stringify(values.socialLinks.links),
		author_bio: orNull(values.author.bio),
		author_image_url: orNull(values.author.imageUrl),
		require_confirmation: values.requireConfirmation,
		cleanup_enabled: values.cleanup.enabled,
		cleanup_issues: orNull(values.cleanup.issues),
		cleanup_days: orNull(values.cleanup.days),
		...(sections.welcome && {
			welcome_enabled: values.welcome.enabled,
			welcome_subject: orNull(values.welcome.subject),
			welcome_preview_text: orNull(values.welcome.previewText),
			welcome_markdown: orNull(values.welcome.markdown),
		}),
		...(sections.confirmation && {
			confirmation_subject: orNull(values.confirmation.subject),
			confirmation_preview_text: orNull(values.confirmation.previewText),
			confirmation_markdown: orNull(values.confirmation.markdown),
		}),
	};
}

// Sending errors become toasts; a thrown error would replace the page with the error boundary.
export async function sendWelcomeTest(newsletterId) {
	const { email } = await requireSession();
	if (!isSendingEnabled()) return { error: "Sending is off" };
	try {
		await sendWelcomeTestEmail({ newsletterId, to: email });
		return { ok: true };
	} catch (error) {
		console.error("[newsletters] Welcome test failed:", error);
		return { error: error.message || "Sending failed" };
	}
}

export async function saveNewsletter(_state, formData) {
	await requireSession();
	const id = readText(formData, "id");
	if (id && !isObjectIdString(id)) return { error: "Newsletter not found" };

	const values = readNewsletter(formData);
	const error = validateNewsletter(values);
	if (error) return { error };
	const columns = toColumns(values, {
		// A collapsed email section sends no fields, and what it had saved stays as it is.
		welcome: formData.has("welcomeSubject"),
		confirmation: formData.has("confirmationSubject"),
	});

	const createdId = id ? null : newId();
	const now = Date.now();
	let save;
	if (id) {
		const names = Object.keys(columns);
		save = statement(`UPDATE newsletters SET ${names.map((name) => `${name} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [
			...Object.values(columns),
			now,
			id,
		]);
	} else {
		const all = { id: createdId, ...columns, created_at: now, updated_at: now };
		save = statement(
			`INSERT INTO newsletters (${Object.keys(all).join(", ")}) VALUES (${Object.keys(all).map(() => "?").join(", ")})`,
			Object.values(all)
		);
	}
	try {
		// One transaction: the previous homepage steps down in the same write that names the new one.
		await batch(
			values.isHomepage
				? [statement("UPDATE newsletters SET is_homepage = 0, updated_at = ? WHERE is_homepage = 1 AND id != ?", [now, id || createdId]), save]
				: [save]
		);
	} catch (error) {
		if (String(error?.message).includes("is_homepage")) return { error: "Another newsletter just became the homepage. Try again." };
		if (String(error?.message).includes("UNIQUE")) return { error: "This slug is already used" };
		throw error;
	}

	revalidatePath("/newsletters");
	revalidateArchive();
	if (createdId) redirect(`/newsletters/${createdId}`);
	return { ok: true, savedAt: Date.now() };
}
